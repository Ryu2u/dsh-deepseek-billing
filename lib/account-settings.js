/**
 * 账号设置的宿主侧桥接：把「手机号 / 密码 / 自动续期」变成插件自己的 entry config。
 *
 *   - 账号值就是本插件那一行的 `config`（写在 profile 的 `cordis.patch.yml` 里）。
 *     DSH 0.2 的「设置」就是这个文档：`settings.mutate()` 写的也是它，写完触发一次
 *     composition 重载，值经由 `Config` 回到宿主；
 *   - 字段声明为 `volatile`：这样 `config.mobile.get()` 是活单元格，设置页写入后
 *     不必重新挂载就能读到新值；密码另外是 `role('secret')`，wire 上只回「已设置」；
 *   - 暴露 `GET/POST /deepseek-billing/account` 给设置卡片用：读回脱敏值，
 *     写入走 settings 的路径式 mutate（服务不在时如实报错，不改半截）。
 *
 * 这套取代了 0.2 之前「settings 服务注册命名空间 + settings.yaml」的老写法：
 * 新版服务没有 `register`/`get`，老写法会静默降级成「设置不可用」，续期也就读不到账号。
 *
 * 旧的 DPAPI 账号文件仍作为回退：上面没填时才会去解它。
 */

import Schema from '@deepseek-ai/schemastery'

/** 设置命名空间（entry id，同时也是设置页卡片的 key）。 */
const SETTINGS_NS = 'deepseek-billing'

/** 账号读写路由。 */
const ACCOUNT_ROUTE = '/deepseek-billing/account'

/**
 * 本插件的 entry config：账号字段。
 * `volatile` 让每个字段成为活单元格（`config.x.get()`），密码额外声明 secret。
 */
const Config = Schema.object({
  mobile: Schema.string().default('').volatile(),
  areaCode: Schema.string().default('+86').volatile(),
  password: Schema.string().role('secret').default('').volatile(),
  autoRenew: Schema.boolean().default(false).volatile(),
})

/**
 * 读一个配置字段：volatile 字段是活单元格（有 `.get()`），普通字段是裸值。
 * @param cell - entry config 上的字段。
 * @param fallback - 取不到时的回退值。
 * @returns 当前值。
 */
function readCell(cell, fallback) {
  if (cell !== null && typeof cell === 'object' && typeof cell.get === 'function') {
    try {
      const value = cell.get()
      return value === undefined || value === null ? fallback : value
    } catch {
      return fallback
    }
  }
  return cell === undefined || cell === null ? fallback : cell
}

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
 * 装好账号路由，并把 entry config 当作账号来源。
 * @param ctx - 宿主插件上下文（需要 webServer / connection）。
 * @param helpers - 与余额路由共用的响应助手。
 * @param cells - 本插件 entry config 上的四个字段（volatile ⇒ 活单元格）。
 * @returns 读账号凭据、读开关、读当前脱敏值的方法集合。
 */
export function installAccount(ctx, helpers, cells) {
  const { sendJson, sendMethodNotAllowed, rejected } = helpers

  /**
   * 写入通道：设置服务是否存在，按请求现查 —— 它不在 inject 里，
   * 挂载顺序不保证，而且没有它插件也要照常出浮标。
   */
  const writable = () => {
    try {
      const service = ctx.get('settings')
      return service !== undefined && typeof service.mutate === 'function' ? service : null
    } catch {
      return null
    }
  }

  /** 当前解析值（含密码，仅在进程内使用）。 */
  const resolved = () => plainAccount({
    mobile: readCell(cells?.mobile, ''),
    areaCode: readCell(cells?.areaCode, '+86'),
    password: readCell(cells?.password, ''),
    autoRenew: readCell(cells?.autoRenew, false) === true,
  })

  /** 设置页表单需要的脱敏值。 */
  const view = () => {
    const value = resolved()
    return {
      mobile: value.mobile,
      areaCode: value.areaCode,
      autoRenew: value.autoRenew,
      passwordSet: value.password.length > 0,
      available: writable() !== null,
    }
  }

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
      const settings = writable()
      if (settings === null) {
        // 没有设置服务就没有写入通道；如实说明，并指向唯一的数据源。
        sendJson(res, 400, {
          ok: false,
          error: 'settings-unavailable',
          detail: `账号值存在 profile 的 cordis.patch.yml 里：给 id "${SETTINGS_NS}" 的行写 config（mobile / password / autoRenew）`,
        })
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

  return {
    /** 是否有写入通道（设置服务在）。 */
    available: () => writable() !== null,
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

export { ACCOUNT_ROUTE, Config, SETTINGS_NS, readCell }
