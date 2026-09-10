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
			".dsb-metric{display:inline-flex;align-items:baseline;gap:3px}",
			".dsb-metric-label{color:var(--dsw-alias-label-tertiary)}",
			".dsb-metric-value{color:var(--dsw-alias-label-primary);font-weight:600}",
			".dsb-metric-sep{color:var(--dsw-alias-separator-primary);margin:0 5px}",
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
				React.createElement("span", { className: "dsb-sep" }),
				balanceNode,
				statsNode === null ? null : React.createElement("span", { className: "dsb-sep" }),
				statsNode,
				tokensNode === null ? null : React.createElement("span", { className: "dsb-sep" }),
				tokensNode,
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
				label: "峰谷计费与余额",
			}, BillingPill));
			ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
				name: "conversation.input.left",
				id: "deepseek-billing",
				order: 100,
				label: "峰谷计费与余额",
			}, BillingPill));
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
