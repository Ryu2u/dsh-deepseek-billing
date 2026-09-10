# dsh-deepseek-billing

DeepSeek 峰谷计费 / 余额 / 消费浮标，作为 **DeepSeek Harness (DSH) Web** 的插件运行：
在会话头部右侧工具区和输入框工具行各显示一枚胶囊，数据全部由宿主半边向官方接口取回。

```
[峰] 梁文锋  距谷时 1 小时 30 分 │ ¥12.48 │ 今日 ¥10.91 · 当月 ¥49.34 │ 今 136M · 月 395M tok
```

| 片段 | 含义 |
|---|---|
| `[峰] 梁文锋` / `[谷] 梁文谷` | 当前处于高峰 / 低谷时段（高峰 = 周一至周五 09:00-12:00、14:00-18:00 北京时间，其余含周末为低谷） |
| `距谷时 …` / `距峰时 …` | 距离下一次峰谷切换还有多久，每 30 秒重算 |
| `¥12.48` | 账户余额：≥10 元绿色、<10 元红色（字号不变，只改颜色与字重） |
| `今日 ¥10.91 · 当月 ¥49.34` | 当天 / 本月至今的消费，控制台口径（北京时间） |
| `今 136M · 月 395M tok` | 当天 / 当月 token 量（缓存命中 + 未命中 + 输出），以 M 为单位 |

悬停（title）里有完整明细：峰谷规则、当前时段、余额构成（充值/赠金）、今日与当月消费、
今日与当月 token、下次切换的具体时刻与倒计时、数据更新时间。

## 数据来源

| 数据 | 接口 | 鉴权 |
|---|---|---|
| 余额 | `https://api.deepseek.com/user/balance` | `DEEPSEEK_API_KEY`（凭据库） |
| 今日 / 当月消费与 token | `https://platform.deepseek.com/api/v0/usage/by_api_key/{cost,amount}` | 控制台登录态 token |

余额走官方开放接口；消费与token 只有控制台接口提供，因此需要一次控制台登录态。
插件只用**两个区间请求**（本月区间、按天分桶）就同时得出当天与当月：天桶求和 = 当月，今天那个桶 = 当天。
宿主侧结果缓存 2 分钟，浏览器每 60 秒轮询一次。

## 安装

```sh
# 1) 装进某个 profile（这里以 web 为例）
dsh plugin --profile web add git+ssh://git@github.com/Ryu2u/dsh_balance_plugin.git
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

## 目录结构

```
lib/index.js            宿主半边：余额、今日/当月用量、token 续期、账号设置路由
lib/usage.js            控制台用量读取（区间请求 → 当天/当月消费与 token）
lib/account-settings.js 设置命名空间 + 账号读写路由（密码为 secret 字段）
lib/client.js           浏览器半边：浮标（两处座位）+ 设置页卡片
scripts/*.ps1           可选的手动配置脚本
```

## 迭代约定

Loader 用 `import()` 装载模块，**同一 URL 的 ESM 会被进程缓存**：改完 `lib/*.js` 后，

1. 把实现复制成新文件名（例如 `lib/host-v2.js`），改 `cordis.patch.yml` 里那一行的 specifier；或
2. 直接重启 `dsh`

客户端半边（`lib/client.js`）随同一次 composition 重组生效，**刷新页面**即可看到。
本仓库使用规范文件名（`index.js` / `usage.js`），本地迭代时才用带版本号的文件名。

## 卸载

从 `cordis.patch.yml` 删掉那一行，然后：

```sh
dsh plugin --profile web remove dsh-deepseek-billing
```

## License

MIT
