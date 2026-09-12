# dsh-deepseek-billing

DeepSeek 峰谷计费 / 余额 / 消费浮标，作为 **DeepSeek Harness (DSH) Web** 的插件运行：
在会话头部右侧工具区和输入框工具行各有一个**轮播位** —— 同一个位置每 10 秒竖向翻页，
轮流显示 DeepSeek 侧（峰谷 + 余额 + 今日/当月消费 + token）与 OpenCode Go 侧（订阅配额）
两枚胶囊，像手机小卡片那样。数据全部由宿主半边向各自官方接口取回。

```
[峰] 梁文锋 距谷时 1 小时 30 分 │ ¥12.48 │ 今日 ¥10.91 · 当月 ¥49.34 │ 今 136M · 月 395M tok
[OC] Go 6% │ 周 7% · 月 3%
```

鼠标停在轮播位上会暂停翻页，方便看数字和悬停明细；轮播容器宽度跟着当前那枚走，
所以每枚都是自己的自然宽度，不会被另一枚挤窄。

| 片段 | 含义 |
|---|---|
| `[峰] 梁文锋` / `[谷] 梁文谷` | 当前处于高峰 / 低谷时段（高峰 = 周一至周五 09:00-12:00、14:00-18:00 北京时间，其余含周末为低谷） |
| `距谷时 …` / `距峰时 …` | 距离下一次峰谷切换还有多久，每 30 秒重算 |
| `¥12.48` | 账户余额：≥10 元绿色、<10 元红色（字号不变，只改颜色与字重） |
| `今日 ¥10.91 · 当月 ¥49.34` | 当天 / 本月至今的消费，控制台口径（北京时间） |
| `今 136M · 月 395M tok` | 当天 / 当月 token 量（缓存命中 + 未命中 + 输出），以 M 为单位 |
| `[OC] Go 6%` | OpenCode Go 的**滚动 5 小时**窗口已用配额：<60% 绿、60–85% 橙、≥85% 红 |
| `周 7% · 月 3%` | 本周 / 本月配额已用百分比（各自的重置时刻在悬停明细里） |

两枚胶囊都会随输入框工具行的宽度自动收放（用宿主给工具行声明的容器查询，
`container-type: inline-size`，所以拖窗口、开关侧栏都会即时生效）：

- DeepSeek 那枚按工具行宽度分四档，从宽到窄依次让位：

  | 工具行宽度 | 显示内容 |
  |---|---|
  | ≥900px | 整枚：`[峰] 梁文锋 距谷时 … │ ¥12.48 │ 今日 … · 当月 … │ 今 … · 月 … tok` |
  | <900px | 收起 token 段 |
  | <470px | 再收起「今日/当月消费」，剩 `[谷] 梁文谷 距峰时 … │ ¥2.70`（约 233px） |
  | <450px | **手机上只剩** `[谷] ¥2.70`（约 77px） |

  后两档是给手机竖屏的（可用宽度约 380px）：不收这些段，胶囊会顶出容器被裁掉。
  第四档保留峰谷汉字与余额 —— 这枚胶囊最核心的两个信息。另外 `max-width:100%` 兜底，
  极端窄的容器里也不会顶出去。

- OpenCode 那枚：工具行窄于 **1330px** 收起「周 · 月」，只剩滚动 5 小时主数字
  （按「整行会不会被挤到换行」实测：两枚都在位时单行需要 ≥1330px，收成主数字后 850px 都够）。
  但窄于 **450px**（手机档）反而把「周 · 月」放回来 —— 这一档 DeepSeek 那枚已只剩 `[谷] ¥2.70`，
  位置腾出来了，而 OpenCode 全量才约 183px，放得下。

阈值写在 `lib/client.js` 顶部（`COMPOSER_ROW_HIDE_TOKENS` / `COMPOSER_ROW_HIDE_STATS` /
`COMPOSER_ROW_HIDE_TEXT` / `OPENCODE_HIDE_DETAIL_BELOW` / `OPENCODE_RESTORE_DETAIL_BELOW`，
以及各自的视口回退阈值）。

**收起来的明细都在悬停（title）里，一样都不少**：峰谷规则、当前时段、余额构成（充值/赠金）、
今日与当月消费、今日与当月 token、下次切换的具体时刻与倒计时、数据更新时间。
OpenCode 那枚的悬停里给出三个窗口的百分比、各自的重置时刻、数据更新时间与实际请求的接口地址。

## 数据来源

| 数据 | 接口 | 鉴权 |
|---|---|---|
| 余额 | `https://api.deepseek.com/user/balance` | `DEEPSEEK_API_KEY`（凭据库） |
| 今日 / 当月消费与 token | `https://platform.deepseek.com/api/v0/usage/by_api_key/{cost,amount}` | 控制台登录态 token |
| OpenCode Go 配额 | `https://opencode.ai/zen/go/v1/usage` | `OPENCODE_API_KEY`（凭据库，与平时调模型同一把） |

余额走官方开放接口；消费与token 只有控制台接口提供，因此需要一次控制台登录态。
插件只用**两个区间请求**（本月区间、按天分桶）就同时得出当天与当月：天桶求和 = 当月，今天那个桶 = 当天。
宿主侧结果缓存 2 分钟，浏览器每 60 秒轮询一次。

OpenCode Go 的配额接口返回三个窗口的已用百分比与重置时刻：

```json
{ "usage": {
    "rolling": { "status": "ok", "percent": 6, "resetsAt": "2026-09-12T11:18:53.500Z" },
    "weekly":  { "status": "ok", "percent": 7, "resetsAt": "2026-09-14T00:00:00.500Z" },
    "monthly": { "status": "ok", "percent": 3, "resetsAt": "2026-10-11T06:20:44.500Z" } } }
```

`rolling` 是滚动 5 小时窗口，`percent` 是 0–100 的**已用**百分比。鉴权只用
`Authorization: Bearer <key>`，不需要 workspace id、也不需要网页 cookie。
宿主侧缓存 5 分钟（失败 60 秒），浏览器每 60 秒轮询一次。

两个可调项（宿主进程的环境变量，可选）：

| 变量 | 默认 | 用途 |
|---|---|---|
| `OPENCODE_BILLING_KEY_REF` | `OPENCODE_API_KEY` | 换一把凭据名（要和 `settings.yaml` 里 `llm-pi-ai.providers.opencode-go*.apiKeyEnv` 一致） |
| `OPENCODE_BILLING_BASE_URL` | `https://opencode.ai/zen/go` | 走自建反代等场景 |

没有配 `OPENCODE_API_KEY` 时，这枚胶囊显示「未配置 OPENCODE_API_KEY」，不影响 DeepSeek 那枚。

## 安装

```sh
# 1) 装进某个 profile（这里以 web 为例）
dsh plugin --profile web add git+ssh://git@github.com/Ryu2u/dsh-deepseek-billing.git
#    或本地开发时直接指向目录：
dsh plugin --profile web add C:\path\to\dsh_balance_plugin

# 2) 在 profile 的 cordis.patch.yml（你的 patch 层）里加一行
- insert:
    - id: deepseek-billing
      name: 'dsh-deepseek-billing'

# 3) 重启 dsh，或按下面「迭代」一节换一个 specifier 让它热加载
```

> 行名也可以写成指向具体文件的相对路径（`./plugins/dsh-deepseek-billing/lib/index.js`），
> patch 会把它锚定成 file URL，方便本地热加载。

## 配置

**设置 → 插件 → 可配置 → `deepseek-billing`**：

| 字段 | 说明 |
|---|---|
| 手机号 | 控制台登录手机号 |
| 密码 | 标注为 `role('secret')`：DSH 的所有 wire 读取都会剥掉它，界面只显示"已设置/未设置"；留空表示不修改 |
| 自动登录续期 | 打开后，控制台 token 失效时代插件自动用账号密码换新 token |

账号存在宿主 `settings.yaml` 的 `deepseek-billing` 命名空间里（与本机绑定无关，
**换电脑只要重新填一次**）。不填也能用：此时只有余额与峰谷倒计时，消费/token 不显示。

两个命令行脚本（可选，脚本方式不经过设置页）：

- `scripts/set-token.ps1` —— 手动贴一个控制台 token（打开 platform.deepseek.com → F12 → Network → 任一 `/api/v0/...` 请求 → `authorization: Bearer …`）
- `scripts/set-account.ps1` —— 把账号用 **Windows DPAPI（CurrentUser）** 加密写到
  `%USERPROFILE%\.dsh\deepseek-billing\account.json`；这是设置页之外的本机回退方案，
  换电脑需要重跑（所以推荐用设置页）

续期凭据优先级：设置页账号 → 本机 DPAPI 账号文件 → 不续期（只在悬停里提示 token 失效）。

## 安全说明

- 仓库内**不含任何凭据**；API key / token / 账号都只存在运行机器上
- 密码字段是 schemastery 的 `secret` 角色，DSH 的设置 wire 层会把它从 `value`/`base`/`user` 里剥掉，
  只保留"是否已设置"；写入走插件自己的路由，用设置服务的路径式 `mutate`，不会误删未展示字段
- 控制台 token 比 API key 权限更大：请只在本机使用，并在必要时到控制台登出以作废它
- ⚠️ 平台是**单会话**：自动登录续期会把浏览器里已登录的控制台会话顶掉（反之亦然）。
  如果你常用浏览器控制台，建议关掉"自动登录续期"，token 失效时用 `set-token.ps1` 手动贴一次
- 控制台用量接口不是公开 API，其路径与响应结构可能变化；变化时插件会退化为"只显示余额"
- OpenCode 配额接口同样未写进公开文档，但用的是平时调模型那把 API Key，插件不额外存任何凭据；
  请求由宿主半边发出，key 不进浏览器

## 目录结构

```
lib/index.js            宿主半边：余额、今日/当月用量、token 续期、账号设置路由、OpenCode 配额路由
lib/usage.js            控制台用量读取（区间请求 → 当天/当月消费与 token）
lib/opencode-usage.js   OpenCode Go 配额读取（GET /v1/usage → 三个窗口的百分比与重置时刻）
lib/account-settings.js 设置命名空间 + 账号读写路由（密码为 secret 字段）
lib/client.js           浏览器半边：两枚浮标（各两处座位）+ 设置页卡片 + 窄屏收放样式
test/usage.test.mjs     离线用例：解析与错误降级（假 fetch，不联网）
scripts/*.ps1           可选的手动配置脚本
```

跑用例：

```sh
npm test        # 等价于 node --test
```

两组用例都不联网、不需要浏览器：

| 文件 | 覆盖 |
|---|---|
| `test/usage.test.mjs` | 宿主侧解析：三个窗口的归一化、百分比夹取、401/403、超时与网络错误降级 |
| `test/client-render.test.mjs` | 客户端半边：在最小 React 运行时里真跑一遍 `apply()` + 渲染，抓未定义标识符、座位注册、轮播页数、数据到手后的渲染、样式表阈值 |

改客户端半边时**先跑 `npm test`**：`lib/index.js` 里的常量（如 `BEIJING_OFFSET_MS`）
不会出现在浏览器里，若在 `lib/client.js` 里误用，只有真正渲染时才会炸，
而这类错误会被上面第二组用例在提交前抓住。

## 迭代约定

Loader 用 `import()` 装载模块，**同一 URL 的 ESM 会被进程缓存**：改完 `lib/*.js` 后，

1. 把实现复制成新文件名（例如 `lib/host-v2.js`），改 `cordis.patch.yml` 里那一行的 specifier；或
2. 直接重启 `dsh`

客户端半边（`lib/client.js`）随同一次 composition 重组生效，**刷新页面**即可看到。
本仓库使用规范文件名（`index.js` / `usage.js`），本地迭代时才用带版本号的文件名。

> 只改 `lib/client.js`（含样式）时：宿主把包里的这个文件按原样当客户端 bundle 发出去，
> 页面刷新即可；若刷新后仍旧是旧样子，说明按钮上的 bundle 版本号没重算（`pnpm run dev:web`
> 那类 watcher 不在跑），重启 `dsh` 让 composition 重新读一次文件即可 —— 宿主半边本来也要重启。

## 卸载

从 `cordis.patch.yml` 删掉那一行，然后：

```sh
dsh plugin --profile web remove dsh-deepseek-billing
```

## License

MIT
