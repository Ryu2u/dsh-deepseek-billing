/**
 * 控制台用量读取：一次区间请求同时拿到「当天」与「当月」。
 *
 *   - `GET /api/v0/usage/by_api_key/cost`   → 按天分桶的消费（CNY）
 *   - `GET /api/v0/usage/by_api_key/amount` → 按天分桶的 token
 *     （`PROMPT_CACHE_HIT_TOKEN` / `PROMPT_CACHE_MISS_TOKEN` / `RESPONSE_TOKEN`）
 *
 * 区间取北京时间「本月 1 日 00:00 → 下月 1 日 00:00」，`tz=28800`，于是返回的
 * 天桶里既能求和得到当月值，也能直接取出今天的那个桶。token 一律以原始个数返回，
 * 单位换算（M）属于展示层的事。
 */

/** 消费接口。 */
const COST_URL = 'https://platform.deepseek.com/api/v0/usage/by_api_key/cost'

/** token 用量接口。 */
const AMOUNT_URL = 'https://platform.deepseek.com/api/v0/usage/by_api_key/amount'

/** 北京时间相对 UTC 的偏移。 */
const BEIJING_OFFSET_MS = 28_800_000

/** 北京时间「本月 1 日 00:00 / 下月 1 日 00:00 / 今天 00:00」的 Unix 秒。 */
function beijingMonthWindow(ms) {
  const shifted = new Date(ms + BEIJING_OFFSET_MS)
  const year = shifted.getUTCFullYear()
  const month = shifted.getUTCMonth()
  const monthStartMs = Date.UTC(year, month, 1)
  const nextMonthMs = Date.UTC(year, month + 1, 1)
  const dayStartMs = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`
  const dayKey = `${monthKey}-${String(shifted.getUTCDate()).padStart(2, '0')}`
  return {
    start: Math.floor((monthStartMs - BEIJING_OFFSET_MS) / 1000),
    end: Math.floor((nextMonthMs - BEIJING_OFFSET_MS) / 1000),
    todayStart: Math.floor((dayStartMs - BEIJING_OFFSET_MS) / 1000),
    monthKey,
    dayKey,
  }
}

/** 两位小数。 */
function round2(value) {
  return Math.round(value * 100) / 100
}

/** 把响应里的 `data.biz_data.data[]` 摊平成 `{ currency, series }`。 */
function groupsOf(payload) {
  const groups = payload !== null && typeof payload === 'object' ? payload.data?.biz_data?.data : undefined
  return Array.isArray(groups) ? groups : null
}

/** 消费：返回 `{ currency, total, today }`。 */
function sumCost(payload, todayStart) {
  const groups = groupsOf(payload)
  if (groups === null) return null
  const totals = new Map()
  const today = new Map()
  for (const group of groups) {
    const currency = group !== null && typeof group === 'object' && typeof group.currency === 'string' ? group.currency : ''
    const series = group !== null && typeof group === 'object' && Array.isArray(group.series) ? group.series : []
    for (const entry of series) {
      const buckets = entry !== null && typeof entry === 'object' && Array.isArray(entry.buckets) ? entry.buckets : []
      for (const bucket of buckets) {
        const value = bucket !== null && typeof bucket === 'object' ? Number(bucket.cost) : Number.NaN
        if (!Number.isFinite(value)) continue
        totals.set(currency, (totals.get(currency) ?? 0) + value)
        if (Number(bucket.time) === todayStart) today.set(currency, (today.get(currency) ?? 0) + value)
      }
    }
  }
  if (totals.size === 0) return null
  const currency = totals.has('CNY') ? 'CNY' : [...totals.keys()][0]
  return {
    currency,
    total: round2(totals.get(currency)),
    today: round2(today.get(currency) ?? 0),
  }
}

/** token：返回 `{ total, today }`（口径 = 缓存命中 + 缓存未命中 + 输出）。 */
function sumTokens(payload, todayStart) {
  // amount 接口的形状与 cost 不同：`biz_data.series` 是扁平列表（没有 currency 分组）。
  const series = payload !== null && typeof payload === 'object' && Array.isArray(payload.data?.biz_data?.series) ? payload.data.biz_data.series : null
  if (series === null) return null
  let total = 0
  let today = 0
  let seen = false
  {
    for (const entry of series) {
      const buckets = entry !== null && typeof entry === 'object' && Array.isArray(entry.buckets) ? entry.buckets : []
      for (const bucket of buckets) {
        const usage = bucket !== null && typeof bucket === 'object' ? bucket.usage : undefined
        if (usage === null || typeof usage !== 'object') continue
        const value = Number(usage.PROMPT_CACHE_HIT_TOKEN ?? 0) + Number(usage.PROMPT_CACHE_MISS_TOKEN ?? 0) + Number(usage.RESPONSE_TOKEN ?? 0)
        if (!Number.isFinite(value)) continue
        seen = true
        total += value
        if (Number(bucket.time) === todayStart) today += value
      }
    }
  }
  return seen ? { total, today } : null
}

/**
 * 读一次当月 + 当天用量。
 * @param args - `{ token, headers, timeoutMs, now }`。
 * @returns 成功时 `{ todayCost, todayTokens, monthCost, monthTokens, currency, todayDay, monthKey }`，
 *   失败时 `{ error, detail? }`（`token-expired` 由调用方决定是否续期重试）。
 */
async function fetchUsage(args) {
  const window = beijingMonthWindow(args.now)
  const query = `start=${window.start}&end=${window.end}&tz=28800`
  const call = async (url) => {
    const response = await fetch(`${url}?${query}`, {
      headers: { ...args.headers, authorization: `Bearer ${args.token}` },
      signal: AbortSignal.timeout(args.timeoutMs),
    })
    if (response.status === 401 || response.status === 403) return { error: 'token-expired' }
    if (!response.ok) return { error: `http-${response.status}` }
    const text = await response.text()
    let payload = null
    try {
      payload = JSON.parse(text)
    } catch {
      return { error: 'unexpected-response' }
    }
    if (payload !== null && typeof payload === 'object' && payload.code !== undefined && Number(payload.code) !== 0) {
      const code = Number(payload.code)
      const message = typeof payload.msg === 'string' ? payload.msg.slice(0, 120) : ''
      return { error: code === 40003 ? 'token-expired' : `api-${code}`, detail: message }
    }
    return { payload }
  }

  let cost = null
  let amount = null
  try {
    cost = await call(COST_URL)
    if (cost.error === undefined) amount = await call(AMOUNT_URL)
  } catch (error) {
    const timedOut = error !== null && typeof error === 'object' && error.name === 'TimeoutError'
    const detail = error instanceof Error ? error.message : String(error)
    return { error: timedOut ? 'timeout' : 'network-error', detail: detail.slice(0, 200) }
  }
  if (cost.error !== undefined) return cost
  if (amount.error !== undefined) return amount

  const costs = sumCost(cost.payload, window.todayStart)
  const tokens = sumTokens(amount.payload, window.todayStart)
  if (costs === null || tokens === null) return { error: 'unexpected-response' }
  return {
    currency: costs.currency,
    todayCost: costs.today,
    monthCost: costs.total,
    todayTokens: tokens.today,
    monthTokens: tokens.total,
    todayDay: window.dayKey,
    monthKey: window.monthKey,
  }
}

export { AMOUNT_URL, COST_URL, beijingMonthWindow, fetchUsage, sumCost, sumTokens }

