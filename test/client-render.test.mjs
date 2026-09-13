/**
 * 客户端半边的冒烟测试：不联网、不需要浏览器。
 *
 * 做法：造一个最小 React 运行时（hooks 按组件隔离），按 bundle 的加载协议把
 * `lib/client.js` 装进来，跑一遍 `apply()`，再把注册进座位的每个组件**真的渲染**，
 * 首帧之后还会跑一次 effect、等数据回来、再渲染一遍。这样能抓住：
 *   - 未定义的标识符（例如把宿主半边的常量写到客户端半边用）；
 *   - 渲染路径上的取值/类型错误；
 *   - 座位注册被改坏、轮播页数不对、数据到手后渲染不出来；
 *   - effect 里发起的轮询拿到数据后写不回状态。
 *
 *   node --test
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '..', 'lib', 'client.js')

// ---------------------------------------------------------------- 最小 React

/**
 * 造一个最小 React 运行时。
 * hooks 按「组件 + 出现次序」隔离，effect 单独记在 effects 数组里，
 * 便于测试手动跑一遍挂载副作用、然后重新渲染。
 */
function makeRuntime() {
	const slots = new Map()
	const effects = []
	let order = 0
	let cursor = 0
	let current = null

	const slotOf = (component) => {
		const key = component.__testKey ?? (component.__testKey = `c${order++}`)
		if (!slots.has(key)) slots.set(key, { cursor: 0, states: [], refs: [] })
		return slots.get(key)
	}

	const React = {
		createElement(type, props, ...children) {
			return { type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } }
		},
		useState(initial) {
			const slot = slotOf(current)
			const at = slot.cursor
			slot.cursor += 1
			if (!(at in slot.states)) slot.states[at] = typeof initial === 'function' ? initial() : initial
			const set = (next) => {
				slot.states[at] = typeof next === 'function' ? next(slot.states[at]) : next
			}
			return [slot.states[at], set]
		},
		useRef(initial) {
			const slot = slotOf(current)
			const at = slot.cursor
			slot.cursor += 1
			if (!(at in slot.refs)) slot.refs[at] = { current: initial ?? null }
			return slot.refs[at]
		},
		useEffect(fn) {
			const slot = slotOf(current)
			const at = slot.cursor
			slot.cursor += 1
			effects[at] = effects[at] ?? []
			if (!effects[at].includes(fn)) effects[at].push(fn)
		},
	}

	/** 渲染一个元素树；函数组件会被真调用。 */
	const render = (element) => {
		if (element === null || element === undefined || typeof element !== 'object') return element
		if (typeof element.type === 'function') {
			const savedCursor = cursor
			const savedCurrent = current
			cursor = 0
			current = element.type
			slotOf(current).cursor = 0
			const out = render(element.type(element.props))
			cursor = savedCursor
			current = savedCurrent
			return out
		}
		return {
			type: element.type,
			props: element.props,
			children: (Array.isArray(element.props.children) ? element.props.children : [element.props.children])
				.filter((child) => child !== null && child !== undefined && child !== false)
				.map((child) => render(child)),
		}
	}

	/**
	 * 跑一遍「挂载副作用」。
	 * 注意不要执行 effect 返回的 cleanup —— 那等于立刻把轮询拆掉；
	 * React 只在卸载或重跑该 effect 前才执行 cleanup。
	 */
	const runEffects = () => {
		for (const group of effects) {
			for (const fn of group ?? []) fn()
		}
	}

	return { React, render, runEffects }
}

/** 元素树展平。 */
function flatten(node, out = []) {
	if (node === null || node === undefined || typeof node !== 'object') return out
	out.push(node)
	for (const child of node.children ?? []) flatten(child, out)
	return out
}

/** 展平后的类名列表。 */
function classesOf(tree) {
	return flatten(tree).map((n) => String(n.props?.className ?? ''))
}

/** 展平后的文本（只取字符串子节点）。 */
function textOf(tree) {
	return flatten(tree).map((n) => (typeof n.props?.children === 'string' ? n.props.children : '')).join('')
}

// ---------------------------------------------------------------- 环境桩

const head = { children: [], appendChild(el) { head.children.push(el) } }
const elementStub = () => ({
	id: '', className: '', textContent: '', title: '', style: {}, dataset: {}, children: [], parentElement: null,
	appendChild() {}, removeChild() {}, remove() {}, setAttribute() {},
	addEventListener() {}, removeEventListener() {},
	getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 }),
	querySelector: () => null, querySelectorAll: () => [],
})
const documentStub = {
	head,
	body: elementStub(),
	documentElement: elementStub(),
	getElementById: () => null,
	createElement: () => elementStub(),
	querySelector: () => null,
	querySelectorAll: () => [],
	addEventListener() {}, removeEventListener() {},
}

let captured = null
let runtime = null

/** 装 bundle 并跑 apply，返回注册进座位的组件。 */
function loadPlugin() {
	const source = readFileSync(bundlePath, 'utf8')
	new Function(source)()
	assert.ok(captured !== null, 'bundle 没有调用 window.__ModuleLoader__.load')
	assert.equal(typeof captured.factory, 'function', 'bundle 没有 factory')

	runtime = makeRuntime()
	const module = captured.factory((spec) => {
		if (spec === 'react') return runtime.React
		throw new Error(`客户端半边 require 了未预期的模块：${spec}`)
	})
	assert.equal(typeof module.apply, 'function', 'bundle 没有导出 apply')
	assert.ok(Array.isArray(module.inject), 'bundle 导出的 inject 应该是能力名数组')
	assert.ok(module.inject.includes('slots'), `inject 里应有 slots，实际 ${JSON.stringify(module.inject)}`)

	const registered = []
	module.apply({
		effect: (fn) => { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
		slots: {
			inject: (_name, register) => { register() },
			register: (options, component) => { registered.push({ options, component }); return () => {} },
		},
		logger: { info() {}, warn() {}, error() {} },
	})
	return registered
}

/** 两枚胶囊所在座位的组件（会话头部 / 输入框左组都指向同一个轮播组件）。 */
function rotorSeat(registered) {
	const seat = registered.find((r) => r.options.name === 'conversation.input.left')
	assert.ok(seat !== undefined, '没注册 conversation.input.left 座位')
	return seat
}

/** 装上路由桩：两个路由都返回成功数据。 */
function stubRoutes() {
	const original = globalThis.fetch
	const ok = (value) => ({ ok: true, status: 200, json: async () => value })
	globalThis.fetch = async (url) => {
		if (String(url).includes('/deepseek-billing/opencode')) {
			return ok({
				ok: true,
				baseUrl: 'https://opencode.ai/zen/go',
				at: Date.parse('2026-09-12T03:18:53.500Z'),
				usage: {
					rolling: { status: 'ok', percent: 6, resetsAt: '2026-09-12T11:18:53.500Z' },
					weekly: { status: 'ok', percent: 7, resetsAt: '2026-09-14T00:00:00.500Z' },
					monthly: { status: 'ok', percent: 3, resetsAt: '2026-10-11T06:20:44.500Z' },
				},
			})
		}
		return ok({
			ok: true,
			currency: 'CNY',
			total: '2.92',
			toppedUp: '2.92',
			granted: '0.00',
			at: Date.parse('2026-09-12T03:18:53.500Z'),
			today: { cost: 0.18, currency: 'CNY', day: '2026-09-12', tokens: 200000, source: 'console' },
			month: { cost: 68.9, currency: 'CNY', month: '2026-09', tokens: 915000000, source: 'console' },
			todayError: null,
			todayRenew: null,
		})
	}
	return () => { globalThis.fetch = original }
}

/** 首帧渲染 → 跑 effect → 等路由返回 → 再渲染一帧。 */
async function mountWithData(component) {
	const restoreFetch = stubRoutes()
	const originalSetInterval = globalThis.setInterval
	const originalClearInterval = globalThis.clearInterval
	const originalResizeObserver = globalThis.ResizeObserver
	globalThis.setInterval = () => 0
	globalThis.clearInterval = () => {}
	globalThis.ResizeObserver = class { observe() {} disconnect() {} }
	try {
		runtime.render({ type: component, props: { children: [] } })
		runtime.runEffects()
		await new Promise((r) => setTimeout(r, 30))
		return runtime.render({ type: component, props: { children: [] } })
	} finally {
		restoreFetch()
		globalThis.setInterval = originalSetInterval
		globalThis.clearInterval = originalClearInterval
		globalThis.ResizeObserver = originalResizeObserver
	}
}

before(() => {
	globalThis.window = { __ModuleLoader__: { load: (record) => { captured = record } } }
	globalThis.document = documentStub
})

after(() => {
	delete globalThis.window
	delete globalThis.document
})

// ---------------------------------------------------------------- 用例

test('apply 把组件注册进了会话头部与输入框左组', () => {
	const registered = loadPlugin()
	const names = registered.map((r) => r.options.name)
	assert.ok(names.includes('conversation.input.left'), '缺 conversation.input.left 座位')
	assert.ok(names.includes('conversation.session.header.utilities'), '缺 header 座位')
	for (const { options, component } of registered) {
		assert.equal(typeof component, 'function', `${options.name} 的座位没拿到组件`)
	}
})

test('每个座位的组件首帧都能渲染（未定义标识符会在这里炸）', () => {
	const registered = loadPlugin()
	assert.ok(registered.length > 0, '没有任何座位被注册')
	for (const { options, component } of registered) {
		let tree
		assert.doesNotThrow(() => { tree = runtime.render({ type: component, props: { children: [] } }) },
			`渲染 ${options.name}#${options.id ?? ''} 抛错`)
		assert.ok(flatten(tree).length > 1, `${options.name} 渲染出来是空的`)
	}
})

test('轮播位首帧渲染出两页：一页 on、一页 off，各带一枚胶囊', () => {
	const registered = loadPlugin()
	const tree = runtime.render({ type: rotorSeat(registered).component, props: { children: [] } })
	const nodes = flatten(tree)
	const rotor = nodes.find((n) => n.props?.className === 'dsb-rotor')
	assert.ok(rotor !== undefined, '没渲染出 .dsb-rotor')
	const items = nodes.filter((n) => String(n.props?.className ?? '').includes('dsb-rotor-item'))
	assert.equal(items.length, 2, `轮播页数应为 2，实际 ${items.length}`)
	assert.deepEqual(items.map((n) => n.props['data-slot']).sort(), ['off', 'on'], '两页的 data-slot 应为 on/off')
	const pills = nodes.filter((n) => String(n.props?.className ?? '').startsWith('dsb-pill'))
	assert.equal(pills.length, 2, `应有两枚胶囊，实际 ${pills.length}`)
	assert.ok(pills.some((p) => p.props.className.includes('dsb-oc')), '缺少 OpenCode 那枚胶囊')
})

test('DeepSeek 胶囊：路由返回后渲染出余额/消费/token 三段', async () => {
	const registered = loadPlugin()
	const tree = await mountWithData(rotorSeat(registered).component)
	const dsb = flatten(tree).find((n) => String(n.props?.className ?? '').startsWith('dsb-pill') && !n.props.className.includes('dsb-oc'))
	assert.ok(dsb !== undefined, '没有 DeepSeek 胶囊')
	const classes = classesOf(dsb)
	assert.ok(classes.includes('dsb-bal'), '缺余额段')
	assert.ok(classes.includes('dsb-today'), '缺今日/当月消费段')
	assert.ok(classes.includes('dsb-tok'), '缺 token 段')
	// token 段前的分隔线由样式表按容器宽度隐藏，标记类必须挂上，否则收起后会留一根孤立的竖线
	assert.ok(classes.some((c) => c.split(/\s+/).includes('dsb-tok-sep')), `缺 token 段前分隔线的标记类（实际：${JSON.stringify(classes.filter((c) => c.includes('sep')))}）`)
	const text = textOf(dsb)
	assert.match(text, /2\.92/, `余额没渲染出来：${text}`)
	assert.match(text, /68\.90/, `当月消费没渲染出来：${text}`)
	assert.match(text, /0\.2M/, `今日 token 没渲染出来：${text}`)
	assert.ok(!text.includes('读取中'), `还停在 loading：${text}`)
})

test('OpenCode 胶囊：路由返回后渲染出主数字与周/月段', async () => {
	const registered = loadPlugin()
	const tree = await mountWithData(rotorSeat(registered).component)
	const oc = flatten(tree).find((n) => String(n.props?.className ?? '').includes('dsb-oc'))
	assert.ok(oc !== undefined, '没有 OpenCode 胶囊')
	const classes = classesOf(oc)
	assert.ok(classes.includes('dsb-quota-head'), '缺主数字（滚动 5 小时窗口）')
	assert.ok(classes.includes('dsb-quota-rest'), '缺周/月段')
	const text = textOf(oc)
	assert.match(text, /6%/, `主数字没渲染出来：${text}`)
	assert.match(text, /7%/, `周配额没渲染出来：${text}`)
	assert.match(text, /3%/, `月配额没渲染出来：${text}`)
	assert.ok(!text.includes('读取中'), `还停在 loading：${text}`)
})

test('OpenCode 失败时渲染原因文案而不是崩掉', async () => {
	const registered = loadPlugin()
	const original = globalThis.fetch
	globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: false, reason: 'unauthorized', at: 1 }) })
	try {
		globalThis.setInterval = () => 0
		globalThis.clearInterval = () => {}
		globalThis.ResizeObserver = class { observe() {} disconnect() {} }
		runtime.render({ type: rotorSeat(registered).component, props: { children: [] } })
		runtime.runEffects()
		await new Promise((r) => setTimeout(r, 30))
		const tree = runtime.render({ type: rotorSeat(registered).component, props: { children: [] } })
		const oc = flatten(tree).find((n) => String(n.props?.className ?? '').includes('dsb-oc'))
		assert.match(textOf(oc), /API Key 无效/, `失败文案不对：${textOf(oc)}`)
	} finally {
		globalThis.fetch = original
	}
})

test('样式表随插件插入，且带上了分档规则与轮播规则', () => {
	loadPlugin()
	const style = head.children.find((el) => el.id === 'dsh-deepseek-billing-style')
	assert.ok(style !== undefined, '没插入样式表')
	const css = String(style.textContent)
	const rules = [
		['.dsb-pill .dsb-tok', 'DeepSeek 收 token 段'],
		['.dsb-pill .dsb-tok-sep', 'token 段前的分隔线'],
		['.dsb-pill .dsb-today', '收「今日/当月消费」'],
		['.dsb-pill .dsb-stats-sep', '消费段前的分隔线'],
		['.dsb-pill .dsb-mode', '收名字'],
		['.dsb-pill .dsb-note', '收峰谷倒计时'],
		['.dsb-pill .dsb-bal-sep', '余额前的分隔线'],
		['.dsb-oc .dsb-quota-rest', 'OpenCode 收周/月'],
	]
	for (const [selector, why] of rules) {
		assert.ok(css.includes(`{${selector}{display:none}}`), `缺分档规则：${why}（${selector}）`)
	}
	assert.ok(css.includes('@supports not (container-type: inline-size)'), '缺容器查询不可用时的回退')
	assert.ok(css.includes('.dsb-rotor-item[data-slot=off]'), '缺轮播离场页的规则')
	assert.ok(css.includes('.dsb-rotor-item[data-from=down]'), '缺轮播进入方向的规则')
})

test('分档按宿主行宽判定，插件不自建尺寸容器', () => {
	loadPlugin()
	const style = head.children.find((el) => el.id === 'dsh-deepseek-billing-style')
	const css = String(style.textContent)
	// 两条实测踩过的死路，写进断言防回归：
	//  1) 把 container-type 挂在胶囊或页壳上：规范会清零该元素的尺寸贡献，轮播容器塌成 0 宽；
	//  2) 具名查询 + 自建容器：同样绕不开「宽度依赖查询结果」这个死结。
	// 结论：容器一律用宿主行（.uV2eYG_row 上的 container-type），插件自己不声明尺寸容器。
	// 断言「没有任何一条规则真的声明了 container-type」，而不是「文本里没出现过这个词」——
	// 回退规则本来就写成 @supports not (container-type: inline-size)，那是能力探测、不是声明。
	const declarations = [...css.matchAll(/[{;]\s*container-type\s*:/g)]
	assert.equal(declarations.length, 0, '插件不该自建尺寸容器（会让轮播容器塌成 0 宽）')
	assert.equal(css.split('container-name:').length - 1, 0, '插件不该自建具名容器')
	assert.ok(css.includes('@container (width <'), '分档规则应使用宿主行容器（无名 @container）')
})

/** 把样式表解析成「选择器 → 声明」的映射；复合选择器（含空格）保持原样，便于精确查。 */
function rulesOf(css) {
	const map = new Map()
	for (const chunk of css.split('}')) {
		const at = chunk.indexOf('{')
		if (at < 0) continue
		map.set(chunk.slice(0, at).trim(), chunk.slice(at + 1).trim())
	}
	return map
}

test('轮播两页叠放，且不设 max-width（保证测到自然宽度）', () => {
	loadPlugin()
	const style = head.children.find((el) => el.id === 'dsh-deepseek-billing-style')
	const rules = rulesOf(String(style.textContent))
	const rotor = rules.get('.dsb-rotor')
	const item = rules.get('.dsb-rotor-item')
	assert.ok(rotor !== undefined && item !== undefined, '解析不出轮播规则')
	assert.ok(rotor.includes('position:relative'), '轮播容器应作为叠放参照系')
	assert.ok(item.includes('position:absolute'), '两页应绝对定位叠在同一处')
	assert.ok(rules.get('.dsb-rotor-item>.dsb-pill').includes('max-width:none'), '轮播里的胶囊不能设 max-width（否则测到被压窄的值）')
})

test('拖拽手感：可抓取光标、禁用触摸默认手势、拖拽中停过渡', () => {
	loadPlugin()
	const style = head.children.find((el) => el.id === 'dsh-deepseek-billing-style')
	const rules = rulesOf(String(style.textContent))
	const rotor = rules.get('.dsb-rotor')
	assert.ok(rotor.includes('cursor:grab'), '轮播容器应显示可抓取光标')
	assert.ok(rotor.includes('touch-action:none'), '轮播容器应禁用触摸默认手势（否则手机上拖不动）')
	assert.ok(rotor.includes('user-select:none'), '轮播容器应禁止选中文字（否则拖动会变成选字）')
	assert.ok((rules.get('.dsb-rotor-dragging') ?? '').includes('cursor:grabbing'), '拖拽中光标应变成抓手')
	assert.ok((rules.get('.dsb-rotor-dragging .dsb-rotor-item') ?? '').includes('transition:none'), '拖拽中应停掉过渡，否则手感发飘')
})

test('分档阈值从宽到窄依次让位，且与实测边界一致', () => {
	loadPlugin()
	const style = head.children.find((el) => el.id === 'dsh-deepseek-billing-style')
	const css = String(style.textContent)
	const thresholdOf = (selector) => {
		const marker = `{${selector}`
		const at = css.indexOf(marker)
		if (at < 0) return null
		const head = css.slice(0, at)
		const last = head.lastIndexOf('@container (width < ')
		if (last < 0) return null
		const number = /^(\d+)px/.exec(head.slice(last + '@container (width < '.length))
		return number === null ? null : Number(number[1])
	}
	const hideTokens = thresholdOf('.dsb-pill .dsb-tok')
	const hideStats = thresholdOf('.dsb-pill .dsb-today')
	const hideText = thresholdOf('.dsb-pill .dsb-mode')
	const hideQuota = thresholdOf('.dsb-oc .dsb-quota-rest')
	for (const [name, value] of [['token 档', hideTokens], ['消费段档', hideStats], ['手机档', hideText], ['OpenCode 档', hideQuota]]) {
		assert.ok(Number.isInteger(value) && value > 0, `${name}阈值应是正整数，实际 ${value}`)
	}
	// 让位顺序：token → 消费 → 名字/倒计时。反序会让窄屏先丢更重要的信息。
	assert.ok(hideStats < hideTokens, `消费段阈值(${hideStats})应小于 token 段阈值(${hideTokens})`)
	assert.ok(hideText < hideStats, `手机档阈值(${hideText})应小于消费段阈值(${hideStats})`)
	// OpenCode 的周/月要最早收：轮播两页同时在位时，整行最需要它让位。
	assert.ok(hideQuota >= hideTokens, `OpenCode 阈值(${hideQuota})应不小于 token 档(${hideTokens})`)
	// 边界锚点：实测完整行（左右两组工具 + 整枚胶囊约 513px）在行宽 950px 仍单行、900px 换行。
	assert.ok(hideTokens >= 900 && hideTokens <= 1100, `token 档阈值(${hideTokens})应落在实测边界 900~1100 之间`)
})

test('按住卡片上下拖动可以翻页（竖向阈值 + 忽略左右拖）', () => {
	const registered = loadPlugin()
	const component = rotorSeat(registered).component
	const rotorOf = (tree) => flatten(tree).find((n) => n.props?.className === 'dsb-rotor' || String(n.props?.className ?? '').startsWith('dsb-rotor '))
	const itemsOf = (tree) => flatten(tree).filter((n) => String(n.props?.className ?? '').includes('dsb-rotor-item'))
	/** 不变量：恰好一页是当前页（data-from=none），其余页共用同一个方向值（整叠同向位移）。 */
	const assertDirection = (tree, expected, label) => {
		const items = itemsOf(tree)
		const active = items.filter((n) => n.props['data-slot'] === 'on')
		assert.equal(active.length, 1, `${label}：应恰好一页为当前页`)
		assert.equal(active[0].props['data-from'], 'none', `${label}：当前页不该带入场方向`)
		for (const item of items.filter((n) => n.props['data-slot'] === 'off')) {
			assert.equal(item.props['data-from'], expected, `${label}：离场页方向应为 ${expected}`)
		}
	}
	/** 一次完整的按下 → 拖动 → 抬起。 */
	const drag = (tree, dy, dx = 0) => {
		const rotor = rotorOf(tree)
		rotor.props.onPointerDown({ button: 0, clientX: 100, clientY: 100, pointerId: 1, preventDefault() {} })
		rotor.props.onPointerMove({ clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 })
		rotor.props.onPointerUp({ pointerId: 1 })
	}

	const first = rotorOf(runtime.render({ type: component, props: { children: [] } }))
	for (const [name, handler] of [['onPointerDown', '按下'], ['onPointerMove', '拖动'], ['onPointerUp', '抬起']]) {
		assert.equal(typeof first.props[name], 'function', `轮播容器没有绑定 ${handler}（${name}）`)
	}

	// 向上拖：下一张从下方滑入
	drag(first, -30)
	const afterUp = runtime.render({ type: component, props: { children: [] } })
	assertDirection(afterUp, 'down', '向上拖')

	// 向下拖：上一张从上方滑入
	drag(afterUp, 30)
	assertDirection(runtime.render({ type: component, props: { children: [] } }), 'up', '向下拖')

	// 位移小于阈值：不该翻页
	const beforeTiny = itemsOf(runtime.render({ type: component, props: { children: [] } })).map((n) => n.props['data-slot']).join()
	drag(rotorOf(runtime.render({ type: component, props: { children: [] } })), -5)
	const afterTiny = itemsOf(runtime.render({ type: component, props: { children: [] } })).map((n) => n.props['data-slot']).join()
	assert.equal(afterTiny, beforeTiny, '拖动距离小于阈值时不该翻页')

	// 在卡片上左右拖（例如想选文字）：不该翻页
	drag(rotorOf(runtime.render({ type: component, props: { children: [] } })), -4, -60)
	const afterSideways = itemsOf(runtime.render({ type: component, props: { children: [] } })).map((n) => n.props['data-slot']).join()
	assert.equal(afterSideways, beforeTiny, '以水平为主的拖动不该翻页')

	// 没按下就移动：不该翻页（避免鼠标扫过时误翻）
	const rotor = rotorOf(runtime.render({ type: component, props: { children: [] } }))
	rotor.props.onPointerMove({ clientX: 100, clientY: 40, pointerId: 1 })
	const afterHover = itemsOf(runtime.render({ type: component, props: { children: [] } })).map((n) => n.props['data-slot']).join()
	assert.equal(afterHover, beforeTiny, '未按下时移动鼠标不该翻页')
})

test('挂载 effect 会去请求两个路由（fetch 被桩住）', async () => {
	const requested = []
	const originalFetch = globalThis.fetch
	const originalSetInterval = globalThis.setInterval
	const originalClearInterval = globalThis.clearInterval
	const originalResizeObserver = globalThis.ResizeObserver
	globalThis.fetch = async (url) => {
		requested.push(String(url))
		return { ok: true, status: 200, json: async () => ({ ok: false, reason: 'no-api-key' }) }
	}
	globalThis.setInterval = () => 0
	globalThis.clearInterval = () => {}
	globalThis.ResizeObserver = class { observe() {} disconnect() {} }
	try {
		const registered = loadPlugin()
		runtime.render({ type: rotorSeat(registered).component, props: { children: [] } })
		assert.doesNotThrow(() => { runtime.runEffects() }, 'effect 执行抛错')
		await new Promise((r) => setTimeout(r, 20))
		assert.ok(requested.some((url) => url.includes('/deepseek-billing/balance')), `没请求余额路由：${JSON.stringify(requested)}`)
		assert.ok(requested.some((url) => url.includes('/deepseek-billing/opencode')), `没请求 OpenCode 路由：${JSON.stringify(requested)}`)
	} finally {
		globalThis.fetch = originalFetch
		globalThis.setInterval = originalSetInterval
		globalThis.clearInterval = originalClearInterval
		globalThis.ResizeObserver = originalResizeObserver
	}
})
