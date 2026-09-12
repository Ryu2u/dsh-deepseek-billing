/**
 * DeepSeek 峰谷计费与余额浮标 —— host 半边。
 *
 * 职责：把「账户余额」与「今日消费」变成浏览器可读的事实。
 *   - 余额：用 `DEEPSEEK_API_KEY` 调官方 `GET /user/balance`；
 *   - 今日消费：用控制台 token 调 `GET /api/v0/usage/by_api_key/cost`，按北京时间当天求和；
 *   - token 续期：控制台 token 会过期（接口回 `code:40003`）。此时若存在账号文件
 *     `$DSH_HOME/deepseek-billing/account.json`，就用子进程经 Windows DPAPI
 *     （CurrentUser 作用域）解出密码 → 调 `POST /auth-api/v0/users/login` 换新 token
 *     → 写回凭据库 `DEEPSEEK_PLATFORM_TOKEN` 并立即重试一次。
 *     密码只存在于内存与管道中，磁盘上只有 DPAPI 密文。
 *   - 通过 composition 的 `webServer` 暴露只读路由，交给守卫（connection 的
 *     Host/Origin 栅栏 + 浏览器鉴权）拦下跨站调用；结果缓存 2 分钟（失败 20 秒）。
 *
 * 任何一步失败都只降级该字段（`today` 为 null + `todayError` 说明原因），
 * 余额与峰谷倒计时始终可用。密钥与密码都不离开 host。
 */

import { installAccount } from './account-settings.js'
import { fetchUsage } from './usage.js'
import { fetchGoUsage } from './opencode-usage.js'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Cordis 函数式插件名。 */
const name = 'deepseek-billing'

/** 需要的宿主能力：路由载体、请求栅栏、凭据存储。 */
const inject = ['webServer', 'connection', 'credentials']

/** 官方余额接口（API key 鉴权）。 */
const BALANCE_URL = 'https://api.deepseek.com/user/balance'

/** 控制台用量接口（控制台登录态鉴权）。 */
const USAGE_URL = 'https://platform.deepseek.com/api/v0/usage/by_api_key/cost'

/** 控制台密码登录接口（用于自动续期）。 */
const LOGIN_URL = 'https://platform.deepseek.com/auth-api/v0/users/login'

/** 控制台 token 的凭据名。 */
const PLATFORM_TOKEN_REF = 'DEEPSEEK_PLATFORM_TOKEN'

/** 浏览器轮询的只读路由。 */
const BALANCE_ROUTE = '/deepseek-billing/balance'

/** OpenCode Go 配额路由。 */
const OPENCODE_ROUTE = '/deepseek-billing/opencode'

/**
 * OpenCode Go 的 API Key 凭据名：与 `settings.yaml` 里
 * `llm-pi-ai.providers.opencode-go*.apiKeyEnv` 取同一把 key（平时调模型用的那把）。
 * 需要换名字时用 `OPENCODE_BILLING_KEY_REF` 覆盖。
 */
const OPENCODE_KEY_REF = process.env.OPENCODE_BILLING_KEY_REF ?? 'OPENCODE_API_KEY'

/** OpenCode Go 网关地址；可用 `OPENCODE_BILLING_BASE_URL` 覆盖（自建反代等场景）。 */
const OPENCODE_BASE_URL = process.env.OPENCODE_BILLING_BASE_URL ?? 'https://opencode.ai/zen/go'

/** 账号文件（DPAPI 密文 + 手机号 + device_id）。 */
const ACCOUNT_PATH = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'deepseek-billing', 'account.json')

/** 成功/失败结果的缓存时长。 */
const OK_TTL_MS = 120_000
const FAIL_TTL_MS = 20_000

/**
 * OpenCode 配额的缓存时长。配额百分比是分钟级变化，5 分钟足够；
 * 凭据缺失/鉴权失败这类「配好了才会变」的原因缓存久一点，免得每次轮询都白打一次上游。
 */
const OPENCODE_OK_TTL_MS = 300_000
const OPENCODE_FAIL_TTL_MS = 60_000

/** 单次上游请求超时。 */
const REQUEST_TIMEOUT_MS = 20_000

/** 北京时间相对 UTC 的偏移。 */
const BEIJING_OFFSET_MS = 28_800_000
const DAY_MS = 86_400_000

/**
 * 控制台接口要求的浏览器指纹头：缺了会被其 WAF 拦成 HTML 错误页。
 * token + user-agent 已足够（实测），其余保持与控制台一致以免口径漂移。
 */
const PLATFORM_HEADERS = {
  accept: '*/*',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'x-client-locale': 'zh_CN',
  'x-client-bundle-id': 'com.deepseek.chat',
  'x-client-platform': 'web',
  'x-client-version': '1.0.0',
  'x-client-timezone-offset': '28800',
  referer: 'https://platform.deepseek.com/usage',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0',
}

/** 两位小数。 */
function round2(value) {
  return Math.round(value * 100) / 100
}

/** 今天（北京时间）00:00 的 Unix 秒。 */
function beijingDayStartSeconds(ms) {
  const shifted = ms + BEIJING_OFFSET_MS
  const startShifted = Math.floor(shifted / DAY_MS) * DAY_MS
  return Math.floor((startShifted - BEIJING_OFFSET_MS) / 1000)
}

/** JSON 响应（no-store：余额与消费都是活事实，不能被中间层缓存）。 */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** 405，并声明该路由唯一支持的方法。 */
function sendMethodNotAllowed(res, allow) {
  res.statusCode = 405
  res.setHeader('allow', allow)
  res.end()
}

/** 把上游余额归一化成只含标量的载荷；字段缺失或形状不对即视为不可用。 */
function normalizeBalance(payload) {
  const infos = payload !== null && typeof payload === 'object' ? payload.balance_infos : undefined
  const info = Array.isArray(infos) && infos.length > 0 ? infos[0] : undefined
  if (info === undefined || info === null || typeof info !== 'object') return null
  return {
    ok: true,
    available: payload.is_available === true,
    currency: typeof info.currency === 'string' ? info.currency : '',
    total: info.total_balance === undefined ? '' : String(info.total_balance),
    granted: info.granted_balance === undefined ? '' : String(info.granted_balance),
    toppedUp: info.topped_up_balance === undefined ? '' : String(info.topped_up_balance),
  }
}

/**
 * 把控制台用量响应按币种求和成一笔「当天消费」。
 * 结构：`data.biz_data.data[] { currency, series[] { buckets[] { time, cost } } }`。
 * @param payload - 控制台 `usage/by_api_key/cost` 的响应体。
 * @returns `{ cost, currency }`；没有可用数据时返回 null。
 */
function sumTodayCost(payload) {
  const groups = payload !== null && typeof payload === 'object' ? payload.data?.biz_data?.data : undefined
  if (!Array.isArray(groups)) return null
  const totals = new Map()
  for (const group of groups) {
    const currency = group !== null && typeof group === 'object' && typeof group.currency === 'string' ? group.currency : ''
    const series = group !== null && typeof group === 'object' && Array.isArray(group.series) ? group.series : []
    for (const entry of series) {
      const buckets = entry !== null && typeof entry === 'object' && Array.isArray(entry.buckets) ? entry.buckets : []
      for (const bucket of buckets) {
        const value = bucket !== null && typeof bucket === 'object' ? Number(bucket.cost) : Number.NaN
        if (!Number.isFinite(value)) continue
        totals.set(currency, (totals.get(currency) ?? 0) + value)
      }
    }
  }
  if (totals.size === 0) return null
  const currency = totals.has('CNY') ? 'CNY' : [...totals.keys()][0]
  return { cost: round2(totals.get(currency)), currency }
}

/**
 * 用 Windows DPAPI（CurrentUser）解出账号密码。先试 Windows PowerShell 5.1，
 * 失败再试 pwsh；密文走命令行参数（它本身是密文），明文只经 stdout 管道。
 * @param blob - base64 的 DPAPI 密文。
 * @returns `{ password }` 或 `{ error }`。
 */
function unprotectPassword(blob) {
  const script = `[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${blob}'), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser))`
  const run = (command) => new Promise((resolve) => {
    execFile(command, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20_000 }, (error, stdout) => {
      if (error !== null) {
        resolve({ error: 'unprotect-failed' })
        return
      }
      const text = String(stdout).trim()
      if (text.length === 0) {
        resolve({ error: 'unprotect-empty' })
        return
      }
      resolve({ password: Buffer.from(text, 'base64').toString('utf8') })
    })
  })
  return (async () => {
    const first = await run('powershell')
    if (first.password !== undefined) return first
    return await run('pwsh')
  })()
}

/**
 * 注册余额 + 今日消费路由（含控制台 token 自动续期）。
 * @param ctx - 宿主插件上下文（已注入 webServer / connection / credentials）。
 */
function apply(ctx) {
  /** 最近一次合并结果：`{ at, value }`。 */
  let cache = null

  /** 最近一次 OpenCode 配额结果：`{ at, value }`。 */
  let opencodeCache = null

  /** 解析一个凭据；读取失败返回 `{ error }`，缺失返回空串。 */
  const credentialOf = async (ref) => {
    try {
      const resolved = await ctx.credentials.resolve(ref)
      if (resolved !== undefined && resolved !== null && typeof resolved.value === 'string') return resolved.value
    } catch {
      return { error: 'credential-error' }
    }
    return ''
  }

  /** 读一次余额；任何失败都解析成一个描述性结果，不抛。 */
  const readBalance = async () => {
    const key = await credentialOf('DEEPSEEK_API_KEY')
    if (typeof key !== 'string') return { ok: false, reason: key.error, at: Date.now() }
    if (key.length === 0) return { ok: false, reason: 'no-api-key', at: Date.now() }

    try {
      const response = await fetch(BALANCE_URL, {
        headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) return { ok: false, reason: `http-${response.status}`, at: Date.now() }
      const normalized = normalizeBalance(await response.json())
      if (normalized === null) return { ok: false, reason: 'balance-unavailable', at: Date.now() }
      return { ...normalized, at: Date.now() }
    } catch (error) {
      const timedOut = error !== null && typeof error === 'object' && error.name === 'TimeoutError'
      const detail = error instanceof Error ? error.message : String(error)
      return { ok: false, reason: timedOut ? 'timeout' : 'network-error', detail: detail.slice(0, 200), at: Date.now() }
    }
  }

  /** 用给定 token 请求一次当天用量；返回 `{ cost, currency, day }` 或 `{ error }`。 */
  const fetchTodayCost = async (token) => {
    const start = beijingDayStartSeconds(Date.now())
    const url = `${USAGE_URL}?start=${start}&end=${start + 86400}&tz=28800`
    try {
      const response = await fetch(url, {
        headers: { ...PLATFORM_HEADERS, authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
      // 控制台把鉴权失败也包在 HTTP 200 里（`code` 非 0，如 40003）。
      if (payload !== null && typeof payload === 'object' && payload.code !== undefined && Number(payload.code) !== 0) {
        const code = Number(payload.code)
        const message = typeof payload.msg === 'string' ? payload.msg.slice(0, 120) : ''
        return { error: code === 40003 ? 'token-expired' : `api-${code}`, detail: message }
      }
      const total = sumTodayCost(payload)
      if (total === null) return { error: 'unexpected-response' }
      return { ...total, day: new Date(start * 1000 + BEIJING_OFFSET_MS).toISOString().slice(0, 10) }
    } catch (error) {
      const timedOut = error !== null && typeof error === 'object' && error.name === 'TimeoutError'
      const detail = error instanceof Error ? error.message : String(error)
      return { error: timedOut ? 'timeout' : 'network-error', detail: detail.slice(0, 200) }
    }
  }

  /** 用账号文件里的 DPAPI 密文登录一次，换回新 token 并写回凭据库。 */
  const renewToken = async () => {
    // 优先用设置页里填的账号（跟机器无关）；没填才回退到本机 DPAPI 账号文件。
    let mobile = ''
    let password = ''
    let areaCode = '+86'
    let deviceId = ''
    const bridged = accountBridge.credentials()
    if (bridged !== null) {
      mobile = bridged.mobile
      password = bridged.password
      areaCode = bridged.areaCode
      deviceId = typeof bridged.deviceId === 'string' ? bridged.deviceId : ''
    } else {
      let file = null
      try {
        file = JSON.parse(await readFile(ACCOUNT_PATH, 'utf8'))
      } catch {
        return { error: 'no-account' }
      }
      if (file === null || typeof file !== 'object') return { error: 'no-account' }
      if (typeof file.mobile !== 'string' || typeof file.passwordProtected !== 'string') return { error: 'no-account' }
      const secret = await unprotectPassword(file.passwordProtected)
      if (secret.password === undefined) return { error: secret.error }
      mobile = file.mobile
      password = secret.password
      areaCode = typeof file.areaCode === 'string' ? file.areaCode : '+86'
      deviceId = typeof file.deviceId === 'string' ? file.deviceId : ''
    }

    try {
      const response = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: { ...PLATFORM_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({
          email: '',
          mobile,
          password,
          area_code: areaCode,
          device_id: deviceId,
          os: 'web',
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) return { error: `login-http-${response.status}` }
      const payload = await response.json()
      const biz = payload !== null && typeof payload === 'object' ? payload.data?.biz_data : undefined
      const token = biz !== null && typeof biz === 'object' ? biz.user?.token : undefined
      if (typeof token !== 'string' || token.length < 20) {
        const message = biz !== null && typeof biz === 'object' && typeof biz.biz_msg === 'string' ? biz.biz_msg.slice(0, 120) : ''
        return { error: 'login-rejected', detail: message }
      }
      try {
        await ctx.credentials.set(PLATFORM_TOKEN_REF, token)
      } catch {
        /* 写回失败不影响本次使用 */
      }
      console.log('deepseek-billing: 控制台 token 已自动续期')
      return { token }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return { error: 'login-network-error', detail: detail.slice(0, 160) }
    }
  }

  /** 当月 + 当天用量（消费与 token）：一次区间请求对覆盖两者。 */
  const fetchUsageAll = (token) => fetchUsage({
    token,
    headers: PLATFORM_HEADERS,
    timeoutMs: REQUEST_TIMEOUT_MS,
    now: Date.now(),
  })

  /** 读一次用量；token 失效时按开关自动续期并重试一次。 */
  const readTodayCost = async () => {
    const token = await credentialOf(PLATFORM_TOKEN_REF)
    if (typeof token !== 'string') return { error: token.error, renew: null }
    if (token.length === 0) return { error: 'no-token', renew: null }

    const first = await fetchUsageAll(token)
    if (first.error !== 'token-expired') return { ...first, renew: null }

    // 自动续期默认关闭：平台的密码登录会把浏览器里已登录的控制台会话顶掉
    // （实测单会话限制），所以只有显式把凭据 DEEPSEEK_PLATFORM_AUTORENEW 设为
    // on 时才登录续期。默认行为只是把失效如实报给界面。
    const switcher = await credentialOf('DEEPSEEK_PLATFORM_AUTORENEW')
    const autoRenew = accountBridge.autoRenew() || (typeof switcher === 'string' && switcher.trim().toLowerCase() === 'on')
    if (!autoRenew) return { error: 'token-expired', renew: null }

    const renewed = await renewToken()
    if (renewed.token === undefined) return { error: 'token-expired', renew: renewed.error }
    const second = await fetchUsageAll(renewed.token)
    return { ...second, renew: second.error === undefined ? 'renewed' : renewed.error }
  }

  /** 拉一次上游并合并；任何失败都降级成字段说明而不是抛错。 */
  const readMerged = async () => {
    const balance = await readBalance()
    const today = await readTodayCost()
    const ok = today.error === undefined
    return {
      ...balance,
      today: ok ? { cost: today.todayCost, currency: today.currency, day: today.todayDay, tokens: today.todayTokens, source: 'console' } : null,
      month: ok ? { cost: today.monthCost, currency: today.currency, month: today.monthKey, tokens: today.monthTokens, source: 'console' } : null,
      todayError: ok ? null : today.error,
      todayRenew: today.renew ?? null,
      at: Date.now(),
    }
  }

  /** 读一次 OpenCode Go 配额；没有 key 时如实说明，不当作错误上报。 */
  const readOpencode = async () => {
    const key = await credentialOf(OPENCODE_KEY_REF)
    if (typeof key !== 'string') return { ok: false, reason: key.error, at: Date.now() }
    if (key.length === 0) return { ok: false, reason: 'no-api-key', at: Date.now() }

    const result = await fetchGoUsage({ key, baseUrl: OPENCODE_BASE_URL, timeoutMs: REQUEST_TIMEOUT_MS })
    if (result.error !== undefined) {
      return { ok: false, reason: result.error, detail: result.detail ?? null, at: result.at }
    }
    return { ok: true, usage: result.usage, baseUrl: OPENCODE_BASE_URL, at: result.at }
  }

  /** 应答不可信/未鉴权的请求；被拒绝时返回 true。 */
  const rejected = (req, res) => {
    const rejection = ctx.connection.requestRejection(req)
    if (rejection === undefined) return false
    res.statusCode = rejection
    res.end()
    return true
  }

  // 账号设置（设置页插件卡片读写它；密码是 role('secret') 字段）。
  const accountBridge = installAccount(ctx, { sendJson, sendMethodNotAllowed, rejected })

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: BALANCE_ROUTE,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      if (req.method !== 'GET') {
        sendMethodNotAllowed(res, 'GET')
        return
      }
      const now = Date.now()
      if (cache !== null && now - cache.at < (cache.value.ok === true ? OK_TTL_MS : FAIL_TTL_MS)) {
        sendJson(res, 200, cache.value)
        return
      }
      const value = await readMerged()
      cache = { at: Date.now(), value }
      sendJson(res, 200, value)
    },
  }), `deepseek-billing: GET ${BALANCE_ROUTE}`)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: OPENCODE_ROUTE,
    handler: async (req, res) => {
      if (rejected(req, res)) return
      if (req.method !== 'GET') {
        sendMethodNotAllowed(res, 'GET')
        return
      }
      const now = Date.now()
      if (opencodeCache !== null && now - opencodeCache.at < (opencodeCache.value.ok === true ? OPENCODE_OK_TTL_MS : OPENCODE_FAIL_TTL_MS)) {
        sendJson(res, 200, opencodeCache.value)
        return
      }
      const value = await readOpencode()
      opencodeCache = { at: Date.now(), value }
      sendJson(res, 200, value)
    },
  }), `deepseek-billing: GET ${OPENCODE_ROUTE}`)
}

export { apply, inject, name }





