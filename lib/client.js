window.__ModuleLoader__.load({
	id: "dsh-deepseek-billing",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const React = require("react");

		/** host 半边暴露的只读余额路由。 */
		const BALANCE_ROUTE = "/deepseek-billing/balance";
		/** 余额低于该值显示红色，否则绿色。 */
		const LOW_BALANCE = 10;
		/** 本包独占的样式表 id。 */
		const STYLE_ID = "dsh-deepseek-billing-style";
		/**
		 * 分档阈值（px）—— 量的是**宿主工具行的宽度**（宿主给 .uV2eYG_row 声明了
		 * container-type: inline-size），从宽到窄依次让位：
		 *
		 *   ≥1000 整枚胶囊（峰谷 + 余额 + 今日/当月消费 + token）
		 *   <1000 收 token 段
		 *   <900  再收「今日/当月消费」
		 *   <820  再收名字与峰谷倒计时 —— 手机上只剩「谷 │ ¥2.70」
		 *
		 * 1000 是实测出来的：完整行（左右两组工具 + 整枚胶囊约 513px）在行宽 950px 仍单行，
		 * 900px 才换行；后两档按同一口径留余量。收起来的明细始终在悬停 title 里。
		 *
		 * 不要再改成「按胶囊自身宽度查询」：把 container-type 挂在胶囊或页壳上会让规范
		 * 清零该元素的尺寸贡献，轮播容器直接塌成 0 宽；而「宽度反过来依赖查询结果」
		 * 在 CSS 里是死结（两条路都实测过）。宿主行容器是唯一稳定、与胶囊宽度无关的依据。
		 */
		const ROW_HIDE_TOKENS_BELOW = 1000;
		const ROW_HIDE_STATS_BELOW = 900;
		const ROW_HIDE_TEXT_BELOW = 820;
		/**
		 * OpenCode 收起「周 · 月」的阈值：轮播两页里 DeepSeek 那页更宽，
		 * 整行按「较宽那页 + 左右工具」算，所以它比 token 档更早收起（收起后行宽需求降下来）。
		 */
		const OPENCODE_HIDE_DETAIL_BELOW = 1020;
		/** 容器查询不可用时的视口回退阈值：工具行 ≈ 视口 − 左右留白。 */
		const VIEWPORT_HIDE_TOKENS = 1020;
		const VIEWPORT_HIDE_STATS = 920;
		const VIEWPORT_HIDE_TEXT = 840;

		const CSS = [
			".dsb-pill{display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 10px 0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1;white-space:nowrap;user-select:none;cursor:default}",
			".dsb-tag{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:5px;font-size:10px;font-weight:700}",
			'.dsb-tag[data-mode="peak"]{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 18%,transparent)}',
			'.dsb-tag[data-mode="offpeak"]{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 18%,transparent)}',
			".dsb-mode{font-weight:600}",
			'.dsb-mode[data-mode="peak"]{color:var(--dsw-alias-state-warn-primary)}',
			'.dsb-mode[data-mode="offpeak"]{color:var(--dsw-alias-state-success-primary)}',
			".dsb-note{font-size:11px;font-variant-numeric:tabular-nums}",
			'.dsb-note[data-mode="peak"]{color:var(--dsw-alias-state-warn-primary);opacity:.75}',
			'.dsb-note[data-mode="offpeak"]{color:var(--dsw-alias-state-success-primary);opacity:.85}',
			".dsb-sep{width:1px;height:12px;background:var(--dsw-alias-border-l1)}",
			".dsb-bal{display:inline-flex;align-items:baseline;gap:1px;font-weight:700;font-variant-numeric:tabular-nums}",
			'.dsb-bal[data-level="ok"]{color:var(--dsw-alias-state-success-primary)}',
			'.dsb-bal[data-level="low"]{color:var(--dsw-alias-state-error-primary)}',
			'.dsb-bal[data-state="error"]{color:var(--dsw-alias-state-error-primary);font-weight:400}',
			'.dsb-bal[data-state="loading"]{color:var(--dsw-alias-label-tertiary);font-weight:400}',
			".dsb-cur{opacity:.65}",
			".dsb-today{font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}",
			".dsb-tok{font-size:11px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}",
			// 分档：按**这页壳的宽度**（= 胶囊自然宽度）判定，逐档让位（明细始终在悬停 title 里）。
			// 具名查询 `dsb-pill`，命中 .dsb-rotor-item 上声明的那个容器，不猜宿主的层次。
			`@container (width < ${ROW_HIDE_TOKENS_BELOW}px){.dsb-pill .dsb-tok{display:none}}`,
			`@container (width < ${ROW_HIDE_TOKENS_BELOW}px){.dsb-pill .dsb-tok-sep{display:none}}`,
			// 窄一档：连「今日/当月消费」一起收起。
			`@container (width < ${ROW_HIDE_STATS_BELOW}px){.dsb-pill .dsb-today{display:none}}`,
			`@container (width < ${ROW_HIDE_STATS_BELOW}px){.dsb-pill .dsb-stats-sep{display:none}}`,
			// 最窄一档：只留峰谷标记与余额 —— 名字、倒计时、以及余额前那根分隔线都收起。
			`@container (width < ${ROW_HIDE_TEXT_BELOW}px){.dsb-pill .dsb-mode{display:none}}`,
			`@container (width < ${ROW_HIDE_TEXT_BELOW}px){.dsb-pill .dsb-note{display:none}}`,
			`@container (width < ${ROW_HIDE_TEXT_BELOW}px){.dsb-pill .dsb-bal-sep{display:none}}`,
			// 兜底：极端窄的容器里不让胶囊顶出容器。
			// 注意：轮播里的胶囊要豁免（见 .dsb-rotor-item > .dsb-pill）—— 它一旦被设了
			// max-width，就会按「当前容器宽度」而不是自然宽度上报尺寸，把轮播宽度带偏。
			".dsb-pill{max-width:100%}",
			// 回退：引擎不支持容器查询时按视口宽度近似（工具行 ≈ 视口 − 左右留白）。
			`@supports not (container-type: inline-size){@media (max-width:${VIEWPORT_HIDE_TOKENS}px){.dsb-pill .dsb-tok{display:none}}}`,
			`@supports not (container-type: inline-size){@media (max-width:${VIEWPORT_HIDE_TOKENS}px){.dsb-pill .dsb-tok-sep{display:none}}}`,
			`@supports not (container-type: inline-size){@media (max-width:${VIEWPORT_HIDE_STATS}px){.dsb-pill .dsb-today{display:none}}}`,
			`@supports not (container-type: inline-size){@media (max-width:${VIEWPORT_HIDE_STATS}px){.dsb-pill .dsb-stats-sep{display:none}}}`,
			`@supports not (container-type: inline-size){@media (max-width:${VIEWPORT_HIDE_TEXT}px){.dsb-pill .dsb-mode{display:none}}}`,
			`@supports not (container-type: inline-size){@media (max-width:${VIEWPORT_HIDE_TEXT}px){.dsb-pill .dsb-note{display:none}}}`,
			`@supports not (container-type: inline-size){@media (max-width:${VIEWPORT_HIDE_TEXT}px){.dsb-pill .dsb-bal-sep{display:none}}}`,
			".dsb-metric{display:inline-flex;align-items:baseline;gap:3px}",
			".dsb-metric-label{color:var(--dsw-alias-label-tertiary)}",
			".dsb-metric-value{color:var(--dsw-alias-label-primary);font-weight:600}",
			".dsb-metric-sep{color:var(--dsw-alias-separator-primary);margin:0 5px}",
			// 竖向轮播：两页叠在同一个网格单元里，**宽度交给 CSS**（cell 取两页较宽的那页），
			// 宽度由脚本跟着「当前那页」写回（见 RotatingPill）：网格/绝对定位只负责叠放与动画。
			// 试过把宽度完全交给 CSS（grid max-content）或把一个具名尺寸容器挂在页壳上，
			// 都不行：container-type 会把该元素的尺寸贡献清零，rotor 直接塌成 0 宽；
			// 而「按自身宽度查询、宽度又依赖查询结果」在 CSS 里是死结。
			// 脚本写回是稳定的 —— 前提是别把非当前页被压缩后的宽度也写回去，
			// 所以测量与写回都只针对当前页（见 useTrackWidth）。
			".dsb-rotor{position:relative;display:inline-block;height:26px;box-sizing:border-box;min-width:0}",
			".dsb-rotor-item{position:absolute;left:0;top:0;display:inline-flex;min-width:0;transition:transform 260ms ease,opacity 260ms ease}",
			// 轮播里的胶囊不设 max-width：让它始终按自然宽度上报（否则会测到被压窄的值）。
			".dsb-rotor-item>.dsb-pill{flex:none;max-width:none}",
			".dsb-rotor-item[data-slot=off]{opacity:0;pointer-events:none;visibility:hidden}",
			".dsb-rotor-item[data-from=down]{transform:translateY(120%)}",
			".dsb-rotor-item[data-from=up]{transform:translateY(-120%)}",
			// OpenCode Go 配额胶囊：主数字是滚动 5 小时窗口，周/月跟在后面。
			".dsb-oc-name{font-weight:600;color:var(--dsw-alias-label-secondary)}",
			'.dsb-tag[data-kind="opencode"]{width:auto;padding:0 4px;letter-spacing:.2px;color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary,#165dff));background:color-mix(in srgb,var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary,#165dff)) 16%,transparent)}',
			".dsb-quota-head{display:inline-flex;align-items:baseline;font-weight:700;font-variant-numeric:tabular-nums}",
			'.dsb-quota-head[data-level="ok"]{color:var(--dsw-alias-state-success-primary)}',
			'.dsb-quota-head[data-level="warn"]{color:var(--dsw-alias-state-warn-primary)}',
			'.dsb-quota-head[data-level="high"]{color:var(--dsw-alias-state-error-primary)}',
			'.dsb-quota-head[data-state="error"]{color:var(--dsw-alias-state-error-primary);font-weight:400}',
			'.dsb-quota-head[data-state="loading"]{color:var(--dsw-alias-label-tertiary);font-weight:400}',
			".dsb-quota-rest{display:inline-flex;align-items:baseline;font-size:11px;font-variant-numeric:tabular-nums}",
			".dsb-quota{display:inline-flex;align-items:baseline;gap:3px}",
			".dsb-quota-label{color:var(--dsw-alias-label-tertiary)}",
			".dsb-quota-value{color:var(--dsw-alias-label-primary);font-weight:600}",
			'.dsb-quota-value[data-level="warn"]{color:var(--dsw-alias-state-warn-primary)}',
			'.dsb-quota-value[data-level="high"]{color:var(--dsw-alias-state-error-primary)}',
			// OpenCode 胶囊收放：这一页壳窄于阈值就丢周/月，只留滚动 5 小时主数字。
			// 分隔线在周/月「之前」，所以用 :has(+ …) 选它——否则收起后会剩一根孤零零的竖线。
			// 同样用具名容器判定（量的是这一页自己的宽度），不受宿主层次影响。
			`@container (width < ${OPENCODE_HIDE_DETAIL_BELOW}px){.dsb-oc .dsb-quota-rest{display:none}}`,
			`@container (width < ${OPENCODE_HIDE_DETAIL_BELOW}px){.dsb-oc .dsb-sep:has(+ .dsb-quota-rest){display:none}}`,
			`@supports not (container-type: inline-size){@media (max-width:${VIEWPORT_HIDE_TOKENS}px){.dsb-oc .dsb-quota-rest{display:none}}}`,
			`@supports not (container-type: inline-size){@media (max-width:${VIEWPORT_HIDE_TOKENS}px){.dsb-oc .dsb-sep:has(+ .dsb-quota-rest){display:none}}}`,
			".dsb-card{display:flex;flex-direction:column;gap:10px}",
			".dsb-row{display:flex;flex-direction:column;gap:4px}",
			".dsb-label{font-size:12px;color:var(--dsw-alias-label-secondary)}",
			".dsb-input{box-sizing:border-box;width:100%;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:13px;outline:none}",
			".dsb-input:focus{border-color:var(--dsw-alias-brand-primary)}",
			".dsb-check{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--dsw-alias-label-primary)}",
			".dsb-actions{display:flex;align-items:center;gap:10px}",
			".dsb-btn{height:28px;padding:0 14px;border:none;border-radius:8px;background:var(--dsw-alias-button-info-fill);color:#fff;font-size:13px;cursor:pointer}",
			".dsb-btn:disabled{opacity:.5;cursor:default}",
			".dsb-msg{font-size:12px;color:var(--dsw-alias-label-tertiary)}",
			".dsb-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
		].join("\n");

		// DeepSeek 官方口径：高峰 = 周一至周五 01:00-04:00、06:00-10:00 UTC，
		// 即北京时间 09:00-12:00、14:00-18:00；其余时段（含整个周末）为低谷。
		const PEAK_WINDOWS = [[60, 240], [360, 600]];
		const DAY_MS = 86400000;
		/** 北京时间相对 UTC 的偏移（毫秒）：clock() 与 resetText() 都靠它换算。 */
		const BEIJING_OFFSET = 28800000;

		/** 该时刻是否处于高峰时段（按 UTC 判定，与本机时区无关）。 */
		function isPeak(ms) {
			const at = new Date(ms);
			const day = at.getUTCDay();
			if (day === 0 || day === 6) return false;
			const minute = at.getUTCHours() * 60 + at.getUTCMinutes();
			for (let i = 0; i < PEAK_WINDOWS.length; i += 1) {
				if (minute >= PEAK_WINDOWS[i][0] && minute < PEAK_WINDOWS[i][1]) return true;
			}
			return false;
		}

		/** 下一个峰谷状态发生变化的时刻（毫秒），找不到时返回 0。 */
		function nextSwitch(ms) {
			const at = new Date(ms);
			const start = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
			const current = isPeak(ms);
			for (let offset = 0; offset <= 8; offset += 1) {
				const base = start + offset * DAY_MS;
				const marks = [base + 3600000, base + 14400000, base + 21600000, base + 36000000, base + DAY_MS];
				for (let i = 0; i < marks.length; i += 1) {
					if (marks[i] > ms && isPeak(marks[i]) !== current) return marks[i];
				}
			}
			return 0;
		}

		/** 北京时间 HH:mm。 */
		function clock(ms) {
			const at = new Date(ms + BEIJING_OFFSET);
			const hour = String(at.getUTCHours());
			const minute = String(at.getUTCMinutes());
			return (hour.length < 2 ? "0" + hour : hour) + ":" + (minute.length < 2 ? "0" + minute : minute);
		}

		/** 剩余时长的中文写法：分钟 / 小时+分 / 天+小时。 */
		function untilText(ms) {
			const total = Math.max(0, Math.round(ms / 60000));
			if (total < 60) return total + " 分钟";
			const hours = Math.floor(total / 60);
			if (hours < 24) return hours + " 小时 " + (total % 60) + " 分";
			return Math.floor(hours / 24) + " 天 " + (hours % 24) + " 小时";
		}

		/** 币种符号。 */
		function sign(currency) {
			if (currency === "CNY") return "¥";
			if (currency === "USD") return "$";
			return "";
		}

		/** 余额不可用时的中文原因。 */
		function reasonText(value) {
			const reason = value !== null && typeof value === "object" ? value.reason : undefined;
			if (reason === "no-api-key") return "未配置 DEEPSEEK_API_KEY";
			if (reason === "credential-error") return "凭据读取失败";
			if (reason === "timeout") return "余额请求超时";
			if (reason === "network-error") return "余额网络异常";
			if (reason === "balance-unavailable") return "余额响应异常";
			if (typeof reason === "string" && reason.startsWith("http-")) return "余额接口 " + reason.slice(5);
			if (reason === "host-call-failed") return "宿主调用失败";
			return "余额不可用";
		}

		/** 今日消费不可用时的中文原因。 */
		function todayReason(error) {
			if (error === "no-token") return "未配置控制台 token";
			if (error === "token-expired") return "控制台 token 已失效（跑 set-token.ps1 更新）";
			if (error === "credential-error") return "凭据读取失败";
			if (error === "timeout") return "请求超时";
			if (error === "network-error") return "网络异常";
			if (error === "unexpected-response") return "返回异常";
			if (typeof error === "string" && error.startsWith("http-")) return "接口 " + error.slice(5);
			return "不可用";
		}

		/** token 数以 M 为单位：≥100M 不留小数，否则保留一位。 */
		function tokensM(value) {
			const millions = value / 1e6;
			return (millions >= 100 ? millions.toFixed(0) : millions.toFixed(1)) + "M";
		}

		/** 一个「弱色标签 + 亮色加粗数值」小段；字号沿用容器，只动颜色与字重。 */
		function metricPart(key, label, value, suffix) {
			return React.createElement("span", { key, className: "dsb-metric" },
				React.createElement("span", { className: "dsb-metric-label" }, label),
				React.createElement("span", { className: "dsb-metric-value" }, value),
				suffix === undefined || suffix === null ? null : React.createElement("span", { className: "dsb-metric-label" }, suffix),
			);
		}

		/** 用弱色中点连接若干小段。 */
		function joinParts(parts) {
			const out = [];
			for (let i = 0; i < parts.length; i += 1) {
				if (i > 0) out.push(React.createElement("span", { key: "sep" + i, className: "dsb-metric-sep" }, "·"));
				out.push(parts[i]);
			}
			return out;
		}

		/** 峰谷 + 余额 + 今日消费胶囊；两个槽位各实例化一份，各自轮询（host 侧有缓存）。 */
		function BillingPill() {
			const [balance, setBalance] = React.useState({ status: "loading" });
			const [, setTick] = React.useState(0);

			React.useEffect(() => {
				let alive = true;
				const load = () => {
					fetch(BALANCE_ROUTE, { headers: { accept: "application/json" } }).then((response) => {
						if (!response.ok) throw new Error("http-" + response.status);
						return response.json();
					}).then((value) => {
						if (!alive) return;
						const ok = value !== null && typeof value === "object" && value.ok === true;
						setBalance(ok ? { status: "ok", value: value } : { status: "error", value: value });
					}, (error) => {
						if (!alive) return;
						const message = error !== null && error !== undefined && error.message !== undefined ? String(error.message) : String(error);
						setBalance({ status: "error", value: { reason: "host-call-failed", detail: message } });
					});
				};
				load();
				const balanceTimer = setInterval(load, 60000);
				const tickTimer = setInterval(() => {
					if (alive) setTick((n) => n + 1);
				}, 30000);
				return () => {
					alive = false;
					clearInterval(balanceTimer);
					clearInterval(tickTimer);
				};
			}, []);

			const now = Date.now();
			const peak = isPeak(now);
			const nextAt = nextSwitch(now);
			const mode = peak ? "peak" : "offpeak";
			const name = peak ? "梁文锋" : "梁文谷";
			const mark = peak ? "峰" : "谷";

			let note = "";
			if (nextAt > 0) {
				const remain = nextAt - now;
				note = remain <= 60000 ? "即将切换" : (peak ? "距谷时 " : "距峰时 ") + untilText(remain);
			}

			let balanceNode = null;
			let balanceLine = "正在读取账户余额…";
			let unit = "";
			if (balance.status === "ok") {
				const value = balance.value;
				unit = sign(value.currency);
				const amount = Number(value.total);
				const low = amount === amount ? amount < LOW_BALANCE : false;
				balanceNode = React.createElement("span", { className: "dsb-bal", "data-level": low ? "low" : "ok" },
					React.createElement("span", { className: "dsb-cur" }, unit),
					React.createElement("span", { className: "dsb-num" }, value.total),
				);
				balanceLine = "账户余额 " + unit + value.total + "（充值 " + unit + value.toppedUp + " · 赠金 " + unit + value.granted + "）"
					+ (low ? "\n提醒：余额低于 " + LOW_BALANCE + " 元，建议充值" : "");
			} else if (balance.status === "error") {
				balanceNode = React.createElement("span", { className: "dsb-bal", "data-state": "error" }, reasonText(balance.value));
				balanceLine = "余额不可用：" + reasonText(balance.value);
			} else {
				balanceNode = React.createElement("span", { className: "dsb-bal", "data-state": "loading" }, "读取中…");
			}

			// 今日/当月消费与 token：host 半边按控制台口径（北京时间）统计。
			const today = balance.status === "ok" && balance.value.today !== null && typeof balance.value.today === "object" ? balance.value.today : null;
			const month = balance.status === "ok" && balance.value.month !== null && typeof balance.value.month === "object" ? balance.value.month : null;
			const statUnit = today !== null && typeof today.currency === "string" && today.currency.length > 0 ? sign(today.currency) : unit;
			const todayCost = today !== null && typeof today.cost === "number" ? today.cost : null;
			const monthCost = month !== null && typeof month.cost === "number" ? month.cost : null;
			const todayTokens = today !== null && typeof today.tokens === "number" ? today.tokens : null;
			const monthTokens = month !== null && typeof month.tokens === "number" ? month.tokens : null;

			const statParts = [];
			if (todayCost !== null) statParts.push(metricPart("today", "今日 ", statUnit + todayCost.toFixed(2)));
			if (monthCost !== null) statParts.push(metricPart("month", "当月 ", statUnit + monthCost.toFixed(2)));
			const statsNode = statParts.length === 0 ? null : React.createElement("span", { className: "dsb-today" }, joinParts(statParts));

			const tokenParts = [];
			if (todayTokens !== null) tokenParts.push(metricPart("todayTok", "今 ", tokensM(todayTokens), " tok"));
			if (monthTokens !== null) tokenParts.push(metricPart("monthTok", "月 ", tokensM(monthTokens), " tok"));
			const tokensNode = tokenParts.length === 0 ? null : React.createElement("span", { className: "dsb-tok" }, joinParts(tokenParts));

			const tip = [
				"DeepSeek 峰谷计费：高峰为周一至周五 09:00-12:00、14:00-18:00（北京时间），其余时段为低谷。",
				peak ? "当前：高峰时段 · " + name : "当前：低谷时段 · " + name,
				balanceLine,
				todayCost !== null
					? "今日消费：" + statUnit + todayCost.toFixed(2) + "（控制台口径 · 北京时间当天）"
					: balance.status === "ok" ? "今日消费：" + todayReason(balance.value.todayError) : "",
				monthCost !== null ? "当月消费：" + statUnit + monthCost.toFixed(2) + "（" + (typeof month.month === "string" ? month.month : "本月") + " 至今）" : "",
				todayTokens !== null ? "今日 token：" + tokensM(todayTokens) + "（缓存命中+未命中+输出）" : "",
				monthTokens !== null ? "当月 token：" + tokensM(monthTokens) : "",
				nextAt > 0 ? (peak ? "转低谷：" : "转高峰：") + clock(nextAt) + "（北京时间，" + (peak ? "距谷时 " : "距峰时 ") + untilText(nextAt - now) + "）" : "",
				"数据更新：" + clock(now) + "（北京时间）",
			].filter((line) => line.length > 0).join("\n");

			return React.createElement("div", { className: "dsb-pill", title: tip },
				React.createElement("span", { className: "dsb-tag", "data-mode": mode }, mark),
				React.createElement("span", { className: "dsb-mode", "data-mode": mode }, name),
				React.createElement("span", { className: "dsb-note", "data-mode": mode }, note),
				React.createElement("span", { className: "dsb-sep dsb-bal-sep" }),
				balanceNode,
				statsNode === null ? null : React.createElement("span", { className: "dsb-sep dsb-stats-sep" }),
				statsNode,
				tokensNode === null ? null : React.createElement("span", { className: "dsb-sep dsb-tok-sep" }),
				tokensNode,
			);
		}

		/** OpenCode 配额路由（host 半边提供）。 */
		const OPENCODE_ROUTE = "/deepseek-billing/opencode";

		/**
		 * 按固定间隔轮询一个只读路由；host 侧有缓存，浏览器这层不必自己节流。
		 * @param route - 路由路径，如 `/deepseek-billing/opencode`。
		 * @param intervalMs - 轮询间隔（毫秒）。
		 * @returns `{ status, value }`；status 为 loading / ok / error。
		 */
		function useEndpoint(route, intervalMs) {
			const [state, setState] = React.useState({ status: "loading", value: null });
			React.useEffect(() => {
				let alive = true;
				const load = () => {
					fetch(route, { headers: { accept: "application/json" } }).then((response) => {
						if (!response.ok) throw new Error("http-" + response.status);
						return response.json();
					}).then((value) => {
						if (!alive) return;
						const ok = value !== null && typeof value === "object" && value.ok === true;
						setState({ status: ok ? "ok" : "error", value: value });
					}, (error) => {
						if (!alive) return;
						const message = error !== null && error !== undefined && error.message !== undefined ? String(error.message) : String(error);
						setState({ status: "error", value: { reason: "host-call-failed", detail: message } });
					});
				};
				load();
				const timer = setInterval(load, intervalMs);
				return () => {
					alive = false;
					clearInterval(timer);
				};
			}, [route, intervalMs]);
			return state;
		}

		/** OpenCode 配额不可用时的中文原因。 */
		function opencodeReason(value) {
			const reason = value !== null && typeof value === "object" ? value.reason : undefined;
			if (reason === "no-api-key") return "未配置 OPENCODE_API_KEY";
			if (reason === "credential-error") return "凭据读取失败";
			if (reason === "unauthorized") return "API Key 无效";
			if (reason === "timeout") return "请求超时";
			if (reason === "network-error") return "网络异常";
			if (reason === "unexpected-response") return "接口返回异常";
			if (typeof reason === "string" && reason.startsWith("http-")) return "接口 " + reason.slice(5);
			if (reason === "host-call-failed") return "宿主调用失败";
			return "配额不可用";
		}

		/** 用量档位：<60% 正常、<85% 偏高、否则吃紧（只影响颜色）。 */
		function usageLevel(percent) {
			if (!(percent >= 60)) return "ok";
			return percent < 85 ? "warn" : "high";
		}

		/** 上游基地址文案；拿不到就用默认网关。 */
		function opencodeBase(value) {
			const base = value !== null && typeof value === "object" ? value.baseUrl : undefined;
			return typeof base === "string" && base.length > 0 ? base : "https://opencode.ai/zen/go";
		}

		/** ISO 时间 → 北京时间 `MM-DD HH:mm`；解析不出来返回空串。 */
		function resetText(iso) {
			if (typeof iso !== "string" || iso.length === 0) return "";
			const at = Date.parse(iso);
			if (!Number.isFinite(at)) return "";
			// 上游给的是 UTC ISO 串；同样用 clock() 那套「先加偏移再读 UTC 字段」的算法换算北京时间。
			const beijing = new Date(at + BEIJING_OFFSET);
			const month = String(beijing.getUTCMonth() + 1);
			const day = String(beijing.getUTCDate());
			return (month.length < 2 ? "0" + month : month) + "-" + (day.length < 2 ? "0" + day : day) + " " + clock(at);
		}

		/** 「周 7%」这类小段；重置时刻只在悬停明细里给，免得把胶囊撑长。 */
		function quotaPart(key, label, percent) {
			return React.createElement("span", { key, className: "dsb-quota" },
				React.createElement("span", { className: "dsb-quota-label" }, label + " "),
				React.createElement("span", { className: "dsb-quota-value", "data-level": usageLevel(percent) }, percent + "%"),
			);
		}

		/**
		 * OpenCode Go 配额胶囊：滚动 5 小时窗口当主数字，本周/本月跟在后面。
		 * 与 DeepSeek 那枚分开坐同一批座位（order 靠后），两种配额的语义不混在一起。
		 */
		function OpencodePill() {
			const state = useEndpoint(OPENCODE_ROUTE, 60000);
			const usage = state.status === "ok" && state.value.usage !== null && typeof state.value.usage === "object" ? state.value.usage : null;

			const rolling = usage !== null && usage.rolling !== null && typeof usage.rolling === "object" ? usage.rolling : null;
			const weekly = usage !== null && usage.weekly !== null && typeof usage.weekly === "object" ? usage.weekly : null;
			const monthly = usage !== null && usage.monthly !== null && typeof usage.monthly === "object" ? usage.monthly : null;

			let headNode = null;
			let headLine = "正在读取 OpenCode Go 配额…";
			if (state.status === "ok" && rolling !== null) {
				headNode = React.createElement("span", { className: "dsb-quota-head", "data-level": usageLevel(rolling.percent) }, rolling.percent + "%");
				headLine = "5 小时窗口已用 " + rolling.percent + "%"
					+ (resetText(rolling.resetsAt).length > 0 ? "（重置 " + resetText(rolling.resetsAt) + " 北京时间）" : "");
			} else if (state.status === "error") {
				headNode = React.createElement("span", { className: "dsb-quota-head", "data-state": "error" }, opencodeReason(state.value));
				headLine = "配额不可用：" + opencodeReason(state.value);
			} else {
				headNode = React.createElement("span", { className: "dsb-quota-head", "data-state": "loading" }, "读取中…");
			}

			const parts = [];
			if (weekly !== null) parts.push(quotaPart("weekly", "周", weekly.percent));
			if (monthly !== null) parts.push(quotaPart("monthly", "月", monthly.percent));
			const detailNode = parts.length === 0 ? null : React.createElement("span", { className: "dsb-quota-rest" }, joinParts(parts));

			const tip = [
				"OpenCode Go 订阅配额（与 DeepSeek 余额各自独立）。",
				"接口：GET " + opencodeBase(state.value) + "/v1/usage（Anthropic 兼容 API Key，Bearer 鉴权）。",
				headLine,
				weekly !== null ? "本周配额：" + weekly.percent + "%" + (resetText(weekly.resetsAt).length > 0 ? "（重置 " + resetText(weekly.resetsAt) + "）" : "") : "",
				monthly !== null ? "本月配额：" + monthly.percent + "%" + (resetText(monthly.resetsAt).length > 0 ? "（重置 " + resetText(monthly.resetsAt) + "）" : "") : "",
				state.status === "ok" ? "数据更新：" + clock(state.value.at ?? Date.now()) + "（北京时间）" : "",
			].filter((line) => line.length > 0).join("\n");

			return React.createElement("div", { className: "dsb-pill dsb-oc", title: tip },
				React.createElement("span", { className: "dsb-tag", "data-kind": "opencode" }, "OC"),
				React.createElement("span", { className: "dsb-oc-name" }, "Go"),
				headNode,
				detailNode === null ? null : React.createElement("span", { className: "dsb-sep" }),
				detailNode,
			);
		}

		/** 两枚胶囊的轮换节奏：每枚停留多久（5 秒）。过渡时长写在样式表里（260ms）。 */
		const ROTATE_HOLD_MS = 5000;

		/**
		 * 竖向轮播座位：同一个位置轮流显示 DeepSeek 与 OpenCode Go 两枚胶囊。
		 *
		 * 两页常驻渲染（各自独立轮询自己的路由），当前那页居中，另一页推到视野外并淡出。
		 * 容器宽度跟着「当前那页」的实测宽度走，所以每页都是自己的自然宽度、不会被另一页挤窄。
		 * 鼠标停在上面时暂停轮换，方便看数字和悬停明细。
		 */
		function RotatingPill() {
			const [index, setIndex] = React.useState(0);
			const [paused, setPaused] = React.useState(false);
			// 宽度回调在观察器里异步触发，用 ref 读当前是哪一页，避免闭包读到旧值。
			const indexRef = React.useRef(0);
			indexRef.current = index;

			React.useEffect(() => {
				if (paused) return undefined;
				const timer = setInterval(() => {
					setIndex((current) => (current === 0 ? 1 : 0));
				}, ROTATE_HOLD_MS);
				return () => clearInterval(timer);
			}, [paused]);

			const [width, setWidth] = React.useState(0);
			// 两个 ref 回调只建一次：每次渲染都新建会把观察器反复拆装。
			const refs = React.useRef(null);
			if (refs.current === null) {
				refs.current = [0, 1].map((position) => (node) => {
					if (node === null) return;
					const apply = () => {
						// 只有「当前页」才写回宽度：非当前页会被压窄，把它的宽度写回去会把容器带偏。
						if (position !== indexRef.current) return;
						const measured = Math.ceil(node.getBoundingClientRect().width);
						if (measured > 0) setWidth(measured);
					};
					apply();
					if (typeof ResizeObserver !== "function") return;
					const observer = new ResizeObserver(apply);
					observer.observe(node);
				});
			}

			const item = (key, position, child) => React.createElement("span", {
				key,
				ref: refs.current[position],
				className: "dsb-rotor-item",
				"data-slot": position === index ? "on" : "off",
				"data-from": position === index ? "none" : index === 0 ? "down" : "up",
				"aria-hidden": position === index ? undefined : "true",
			}, child);

			return React.createElement("div", {
				className: "dsb-rotor",
				style: width > 0 ? { width: width + "px" } : undefined,
				// 不挂 title：轮播容器本身没有信息量，挂上去只会在鼠标扫过时弹出一个
				// 遮挡版面的原生提示框；有用的是每枚胶囊自己的 title（明细在那边）。
				onMouseEnter: () => setPaused(true),
				onMouseLeave: () => setPaused(false),
			},
				item("dsb", 0, React.createElement(BillingPill)),
				item("oc", 1, React.createElement(OpencodePill)),
			);
		}

		/** 账号读写路由（host 半边提供，密码只回 passwordSet 布尔）。 */
		const ACCOUNT_ROUTE = "/deepseek-billing/account";
		/**
		 * 设置页卡片（设置 → 插件 → 可配置）：填手机号/密码、开关自动续期。
		 * 值存在 host 的 settings.yaml 里（跟机器无关），密码字段是 secret，
		 * 读取只回「是否已设置」，写走插件自己的路由。
		 */
		function SettingsCard() {
			const [account, setAccount] = React.useState(null);
			const [mobile, setMobile] = React.useState("");
			const [password, setPassword] = React.useState("");
			const [autoRenew, setAutoRenew] = React.useState(false);
			const [message, setMessage] = React.useState("");
			const [busy, setBusy] = React.useState(false);

			const absorb = (value) => {
				const next = value !== null && typeof value === "object" && value.account !== null && typeof value.account === "object" ? value.account : null;
				if (next === null) return false;
				setAccount(next);
				setMobile(typeof next.mobile === "string" ? next.mobile : "");
				setAutoRenew(next.autoRenew === true);
				return true;
			};

			React.useEffect(() => {
				let alive = true;
				fetch(ACCOUNT_ROUTE, { headers: { accept: "application/json" } }).then((response) => {
					if (!response.ok) throw new Error("http-" + response.status);
					return response.json();
				}).then((value) => {
					if (alive && !absorb(value)) setMessage("读取失败：返回异常");
				}, (error) => {
					if (alive) setMessage("读取失败：" + String(error && error.message ? error.message : error));
				});
				return () => {
					alive = false;
				};
			}, []);

			const save = () => {
				setBusy(true);
				setMessage("保存中…");
				fetch(ACCOUNT_ROUTE, {
					method: "POST",
					headers: { "content-type": "application/json", accept: "application/json" },
					body: JSON.stringify({ mobile: mobile.trim(), autoRenew, password }),
				}).then((response) => {
					if (!response.ok) throw new Error("http-" + response.status);
					return response.json();
				}).then((value) => {
					setBusy(false);
					if (value !== null && typeof value === "object" && value.ok === true) {
						absorb(value);
						setPassword("");
						setMessage("已保存" + (value.account && value.account.passwordSet === true ? "（密码已设置）" : "（未设置密码，自动续期不可用）"));
					} else {
						setMessage("保存失败：" + String((value && value.error) || "unknown"));
					}
				}, (error) => {
					setBusy(false);
					setMessage("保存失败：" + String(error && error.message ? error.message : error));
				});
			};

			const available = account === null || account.available !== false;
			return React.createElement("div", { className: "dsb-card" },
				React.createElement("div", { className: "dsb-row" },
					React.createElement("span", { className: "dsb-label" }, "手机号"),
					React.createElement("input", {
						className: "dsb-input",
						type: "text",
						value: mobile,
						placeholder: "控制台登录手机号，如 13800000000",
						onChange: (event) => setMobile(event.target.value),
					}),
				),
				React.createElement("div", { className: "dsb-row" },
					React.createElement("span", { className: "dsb-label" }, account !== null && account.passwordSet === true ? "密码（已设置，留空表示不修改）" : "密码"),
					React.createElement("input", {
						className: "dsb-input",
						type: "password",
						value: password,
						placeholder: account !== null && account.passwordSet === true ? "留空 = 保持现有密码" : "控制台登录密码",
						onChange: (event) => setPassword(event.target.value),
					}),
				),
				React.createElement("label", { className: "dsb-check" },
					React.createElement("input", {
						type: "checkbox",
						checked: autoRenew,
						onChange: (event) => setAutoRenew(event.target.checked),
					}),
					"控制台 token 失效时自动登录续期",
				),
				React.createElement("div", { className: "dsb-actions" },
					React.createElement("button", { className: "dsb-btn", type: "button", disabled: busy, onClick: save }, "保存"),
					message.length > 0 ? React.createElement("span", { className: "dsb-msg" }, message) : null,
				),
				React.createElement("div", { className: "dsb-hint" },
					"「今日消费」需要控制台登录态：这里填一次账号，插件在 token 失效时会用它换新 token；账号存在本机 settings.yaml 里，换电脑重填一次即可（不依赖 DPAPI）。密码字段标记为 secret，不会随设置接口回传。",
					available ? null : "（当前部署未挂载 settings 服务，账号功能不可用）",
				),
			);
		}

		/** 需要的浏览器能力：槽位注册表。 */
		const inject = ["slots"];

		/**
		 * 把胶囊注册到两个座位：会话头部右侧工具区、输入框工具行左组末尾。
		 * 样式表随本插件生命周期插入与移除。
		 * @param ctx - 浏览器插件上下文。
		 */
		function apply(ctx) {
			ctx.effect(() => {
				if (document.getElementById(STYLE_ID) === null) {
					const element = document.createElement("style");
					element.id = STYLE_ID;
					element.textContent = CSS;
					document.head.appendChild(element);
				}
				return () => {
					const element = document.getElementById(STYLE_ID);
					if (element !== null) element.remove();
				};
			});
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "deepseek-billing",
				order: 100,
				label: "DeepSeek 余额 / OpenCode Go 配额",
			}, RotatingPill));
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "deepseek-billing",
				order: 100,
				label: "DeepSeek 余额 / OpenCode Go 配额",
			}, RotatingPill));
			// 设置 → 插件 → 可配置：卡片按命名空间派发，键必须等于 host 注册的命名空间。
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: "deepseek-billing",
			}, SettingsCard));
		}

		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
