/**
 * 离线用例：`lib/usage.js` 与 `lib/opencode-usage.js` 的解析与错误降级。
 * 全部用假 fetch，不联网、不需要凭据。
 *
 *   node --test test/
 */
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { fetchGoUsage, normalizeGoUsage } from '../lib/opencode-usage.js'

/** 用给定响应替换全局 fetch；返回被调用时的入参记录。 */
function stubFetch(handler) {
	const calls = []
	globalThis.fetch = async (url, init) => {
		calls.push({ url, init })
		return handler(url, init)
	}
	return calls
}

/** 造一个 JSON 响应。 */
function jsonResponse(body, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => 'application/json' },
		json: async () => body,
		text: async () => JSON.stringify(body),
	}
}

afterEach(() => {
	delete globalThis.fetch
})

test('normalizeGoUsage 读三个窗口', () => {
	const usage = normalizeGoUsage({
		usage: {
			rolling: { status: 'ok', percent: 6, resetsAt: '2026-09-12T11:18:53.500Z' },
			weekly: { status: 'ok', percent: 7, resetsAt: '2026-09-14T00:00:00.500Z' },
			monthly: { status: 'ok', percent: 3, resetsAt: '2026-10-11T06:20:44.500Z' },
		},
	})
	assert.equal(usage.rolling.percent, 6)
	assert.equal(usage.weekly.percent, 7)
	assert.equal(usage.monthly.percent, 3)
	assert.equal(usage.monthly.resetsAt, '2026-10-11T06:20:44.500Z')
})

test('normalizeGoUsage 对缺字段/脏数据只降级该字段', () => {
	const usage = normalizeGoUsage({
		usage: {
			rolling: { percent: 42 },
			weekly: 'nonsense',
			// monthly 缺失
		},
	})
	assert.equal(usage.rolling.percent, 42)
	assert.equal(usage.rolling.status, '')
	assert.equal(usage.rolling.resetsAt, '')
	assert.equal(usage.weekly, null)
	assert.equal(usage.monthly, null)
})

test('normalizeGoUsage 三个窗口都拿不到时返回 null', () => {
	assert.equal(normalizeGoUsage(null), null)
	assert.equal(normalizeGoUsage({}), null)
	assert.equal(normalizeGoUsage({ usage: {} }), null)
	assert.equal(normalizeGoUsage({ usage: { rolling: { percent: 'x' } } }), null)
})

test('normalizeGoUsage 把百分比夹在 0–100', () => {
	const usage = normalizeGoUsage({ usage: { rolling: { percent: 140 }, weekly: { percent: -3 } } })
	assert.equal(usage.rolling.percent, 100)
	assert.equal(usage.weekly.percent, 0)
})

test('fetchGoUsage 拼对 URL 并带 Bearer', async () => {
	const calls = stubFetch(() => jsonResponse({ usage: { rolling: { percent: 1 } } }))
	const result = await fetchGoUsage({ key: 'sk-test', baseUrl: 'https://opencode.ai/zen/go', timeoutMs: 5000 })
	assert.equal(result.error, undefined)
	assert.equal(result.usage.rolling.percent, 1)
	assert.equal(calls.length, 1)
	assert.equal(calls[0].url, 'https://opencode.ai/zen/go/v1/usage')
	assert.equal(calls[0].init.headers.authorization, 'Bearer sk-test')
})

test('fetchGoUsage 容忍 baseUrl 结尾斜杠', async () => {
	const calls = stubFetch(() => jsonResponse({ usage: { rolling: { percent: 1 } } }))
	await fetchGoUsage({ key: 'k', baseUrl: 'https://opencode.ai/zen/go/', timeoutMs: 5000 })
	assert.equal(calls[0].url, 'https://opencode.ai/zen/go/v1/usage')
})

test('fetchGoUsage 把 401/403 归一成 unauthorized', async () => {
	stubFetch(() => jsonResponse({ type: 'error' }, 401))
	assert.equal((await fetchGoUsage({ key: 'bad', baseUrl: 'https://x', timeoutMs: 1000 })).error, 'unauthorized')
	stubFetch(() => jsonResponse({}, 403))
	assert.equal((await fetchGoUsage({ key: 'bad', baseUrl: 'https://x', timeoutMs: 1000 })).error, 'unauthorized')
})

test('fetchGoUsage 其余 HTTP 错误带状态码', async () => {
	stubFetch(() => jsonResponse({}, 502))
	assert.equal((await fetchGoUsage({ key: 'k', baseUrl: 'https://x', timeoutMs: 1000 })).error, 'http-502')
})

test('fetchGoUsage 对非 JSON 与空结构都报 unexpected-response', async () => {
	stubFetch(() => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } }))
	assert.equal((await fetchGoUsage({ key: 'k', baseUrl: 'https://x', timeoutMs: 1000 })).error, 'unexpected-response')
	stubFetch(() => jsonResponse({ hello: 'world' }))
	assert.equal((await fetchGoUsage({ key: 'k', baseUrl: 'https://x', timeoutMs: 1000 })).error, 'unexpected-response')
})

test('fetchGoUsage 区分超时与网络错误，且不抛', async () => {
	stubFetch(() => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }) })
	assert.equal((await fetchGoUsage({ key: 'k', baseUrl: 'https://x', timeoutMs: 10 })).error, 'timeout')
	stubFetch(() => { throw new Error('getaddrinfo ENOTFOUND') })
	const network = await fetchGoUsage({ key: 'k', baseUrl: 'https://x', timeoutMs: 10 })
	assert.equal(network.error, 'network-error')
	assert.match(network.detail, /ENOTFOUND/)
})
