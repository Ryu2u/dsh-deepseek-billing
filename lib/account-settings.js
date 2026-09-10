/**
 * 账号设置的宿主侧桥接：把「手机号 / 密码 / 自动续期」放进 DSH 设置页。
 *
 *   - 用 composition 的 `settings` 服务注册命名空间 `deepseek-billing`：设置页的
 *     「Plugins」标签会按命名空间派发卡片，密码字段声明为 `role('secret')`，
 *     因此任何 wire 读取都拿不到它；
 *   - 暴露 `GET/POST /deepseek-billing/account` 给自己的设置卡片用：读回
 *     （脱敏后的）当前值，写入走 settings 的路径式 mutate，不会碰到没展示的字段；
 *   - 账号存在 settings.yaml 里 → 换电脑/重装系统后只要重新填一次，不依赖 DPAPI。
 *
 * 旧的 DPAPI 账号文件仍作为回退：设置里没填时才会去解它。
 */

import Schema from '@deepseek-ai/schemastery'

/** 设置命名空间（同时也是设置页卡片的 key）。 */
const SETTINGS_NS = 'deepseek-billing'

/** 账号读写路由。 */
const ACCOUNT_ROUTE = '/deepseek-billing/account'

/** 命名空间 schema：密码是 secret，wire 上永远只回 `set: true/false`。 */
const ACCOUNT_SCHEMA = Schema.object({
  mobile: Schema.string().default(''),
  areaCode: Schema.string().default('+86'),
  password: Schema.string().role('secret').default(''),
  autoRenew: Schema.boolean().default(false),
})

/** 只保留标量，避免把设置对象原样抛回去。 */
function plainAccount(value) {
  const source = value !== null && typeof value === 'object' ? value : {}
  return {
    mobile: typeof source.mobile === 'string' ? source.mobile : '',
    areaCode: typeof source.areaCode === 'string' ? source.areaCode : '+86',
    autoRenew: source.autoRenew === true,
    password: typeof source.password === 'string' ? source.password : '',
  }
}

/**
 * 注册命名空间 + 账号路由。
 * @param ctx - 宿主插件上下文（需要 settings / credentials）。
 * @param helpers - 与余额路由共用的响应助手。
 * @returns 读账号凭据、读开关、读当前脱敏值的方法集合。
 */
export function installAccount(ctx, helpers) {
  const { sendJson, sendMethodNotAllowed, rejected } = helpers

  /** 设置服务与命名空间是否就绪。 */
  let settings = null
  try {
    const service = ctx.get('settings')
    if (service !== undefined) {
      service.register(SETTINGS_NS, ACCOUNT_SCHEMA, { applies: 'live' })
      settings = service
    }
  } catch {
    settings = null
  }

  /** 当前解析值（含密码，仅在进程内使用）。 */
  const resolved = () => {
    if (settings === null) return plainAccount(null)
    try {
      return plainAccount(settings.get(SETTINGS_NS))
    } catch {
      return plainAccount(null)
    }
  }

  /** 设置页表单需要的脱敏值。 */
  const view = () => {
    const value = resolved()
    return {
      mobile: value.mobile,
      areaCode: value.areaCode,
      autoRenew: value.autoRenew,
      passwordSet: value.password.length > 0,
      available: settings !== null,
    }
  }

  if (settings !== null) {
    ctx.effect(() => ctx.webServer.register({
      kind: 'exact',
      path: ACCOUNT_ROUTE,
      handler: async (req, res) => {
        if (rejected(req, res)) return
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, account: view() })
          return
        }
        if (req.method !== 'POST') {
          sendMethodNotAllowed(res, 'GET, POST')
          return
        }
        // 收集一个很小的 JSON 体
        const chunks = []
        let size = 0
        for await (const chunk of req) {
          size += chunk.byteLength
          if (size > 16 * 1024) {
            req.resume()
            sendJson(res, 413, { ok: false, error: 'body-too-large' })
            return
          }
          chunks.push(chunk)
        }
        let body = null
        try {
          body = JSON.parse(Buffer.concat(chunks, size).toString('utf8'))
        } catch {
          sendJson(res, 400, { ok: false, error: 'invalid-json' })
          return
        }
        if (body === null || typeof body !== 'object') {
          sendJson(res, 400, { ok: false, error: 'invalid-body' })
          return
        }

        const ops = []
        if (typeof body.mobile === 'string') ops.push({ op: 'set', path: ['mobile'], value: body.mobile.trim() })
        if (typeof body.areaCode === 'string' && body.areaCode.trim().length > 0) ops.push({ op: 'set', path: ['areaCode'], value: body.areaCode.trim() })
        if (typeof body.autoRenew === 'boolean') ops.push({ op: 'set', path: ['autoRenew'], value: body.autoRenew })
        // 密码留空表示「不修改」，只有明确给了新值才写
        if (typeof body.password === 'string' && body.password.length > 0) ops.push({ op: 'set', path: ['password'], value: body.password })
        if (body.clearPassword === true) ops.push({ op: 'unset', path: ['password'] })

        if (ops.length === 0) {
          sendJson(res, 200, { ok: true, account: view() })
          return
        }
        try {
          await settings.mutate(SETTINGS_NS, ops, undefined)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendJson(res, 400, { ok: false, error: 'settings-rejected', detail: message.slice(0, 200) })
          return
        }
        sendJson(res, 200, { ok: true, account: view() })
      },
    }), `deepseek-billing: GET/POST ${ACCOUNT_ROUTE}`)
  }

  return {
    /** 是否具备可用的设置命名空间。 */
    available: () => settings !== null,
    /** 脱敏视图（给设置卡片）。 */
    view,
    /** 续期用凭据；未配置全时返回 null。 */
    credentials: () => {
      const value = resolved()
      if (value.mobile.length === 0 || value.password.length === 0) return null
      return { mobile: value.mobile, password: value.password, areaCode: value.areaCode, deviceId: null }
    },
    /** 设置页里的自动续期开关。 */
    autoRenew: () => resolved().autoRenew,
  }
}

export { ACCOUNT_ROUTE, ACCOUNT_SCHEMA, SETTINGS_NS }
