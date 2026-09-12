/**
 * OpenCode Go 配额读取。
 *
 * Go 订阅的用量走 `GET {baseURL}/v1/usage`，鉴权用平时调模型的同一把
 * Anthropic 兼容 API Key（`Authorization: Bearer`），不需要 workspace id，
 * 也不需要网页登录 cookie。响应形状：
 *
 * ```json
 * { "usage": {
 *     "rolling": { "status": "ok", "percent": 6, "resetsAt": "2026-09-12T11:18:53.500Z" },
 *     "weekly":  { "status": "ok", "percent": 7, "resetsAt": "2026-09-14T00:00:00.500Z" },
 *     "monthly": { "status": "ok", "percent": 3, "resetsAt": "2026-10-11T06:20:44.500Z" } } }
 * ```
 *
 * `percent` 是 0–100 的已用百分比（`6` 就是 6%）；`rolling` 是滚动 5 小时窗口，
 * 另外两个是本周、本月配额。任何字段缺失或形状不对都只降级该字段，不抛错。
 */

/** 上游路径（挂在 baseURL 之后）。 */
const USAGE_PATH = '/v1/usage'

/**
 * 把一个窗口对象归一化成标量；形状不对返回 null。
 * @param value - 上游 `usage.<window>`。
 * @returns `{ status, percent, resetsAt }` 或 null。
 */
function normalizeWindow(value) {
	if (value === null || typeof value !== 'object') return null
	const percent = Number(value.percent)
	if (!Number.isFinite(percent)) return null
	return {
		status: typeof value.status === 'string' ? value.status : '',
		// 官方口径就是 0–100 的已用百分比，只做防御性夹取。
		percent: Math.min(100, Math.max(0, percent)),
		resetsAt: typeof value.resetsAt === 'string' ? value.resetsAt : '',
	}
}

/**
 * 归一化整个用量响应。
 * @param payload - 上游 JSON。
 * @returns `{ rolling, weekly, monthly }`；三个窗口都拿不到时返回 null。
 */
export function normalizeGoUsage(payload) {
	const usage = payload !== null && typeof payload === 'object' ? payload.usage : undefined
	if (usage === null || typeof usage !== 'object') return null
	const rolling = normalizeWindow(usage.rolling)
	const weekly = normalizeWindow(usage.weekly)
	const monthly = normalizeWindow(usage.monthly)
	if (rolling === null && weekly === null && monthly === null) return null
	return { rolling, weekly, monthly }
}

/**
 * 读一次 OpenCode Go 用量。
 * @param options - `{ key, baseUrl, timeoutMs }`。
 * @returns 成功 `{ usage, at }`；失败 `{ error, detail?, at }`，描述性原因不抛错。
 */
export async function fetchGoUsage({ key, baseUrl, timeoutMs }) {
	const url = `${String(baseUrl).replace(/\/+$/, '')}${USAGE_PATH}`
	const at = Date.now()
	try {
		const response = await fetch(url, {
			headers: {
				authorization: `Bearer ${key}`,
				accept: 'application/json',
			},
			signal: AbortSignal.timeout(timeoutMs),
		})
		if (response.status === 401 || response.status === 403) return { error: 'unauthorized', at }
		if (!response.ok) return { error: `http-${response.status}`, at }
		let payload = null
		try {
			payload = await response.json()
		} catch {
			return { error: 'unexpected-response', at }
		}
		const usage = normalizeGoUsage(payload)
		if (usage === null) return { error: 'unexpected-response', at }
		return { usage, at }
	} catch (error) {
		const timedOut = error !== null && typeof error === 'object' && error.name === 'TimeoutError'
		const detail = error instanceof Error ? error.message : String(error)
		return { error: timedOut ? 'timeout' : 'network-error', detail: detail.slice(0, 200), at }
	}
}
