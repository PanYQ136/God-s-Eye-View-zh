# t_b8b0bed3 — 修真实点击展开：mini 卡内滚动 / 尺寸不展开 / 串状态

## 结论
根因不在展开逻辑，而在**渲染被节流时 WAAPI 动画永远停在首帧**。
Ego Lite 审计跑的时候浏览器窗口是 `minimized`（Chrome 把 rAF 节流到 ~1fps：
实测 `requestAnimationFrame` 600ms 只回调 1 次、`document.timeline` 只走 1s）。
FLIP morph = 「先把 inline 几何写成展开盒，再用 `transform: scale()` 把首帧倒推回折叠矩形」。
一帧都不产出时，`transform` 就永远停在首帧 = 折叠矩形：

* 逻辑已展开（inline `300×430`、`clientHeight 358`、`overflow-y:auto`），
  但 `getBoundingClientRect()` 读到的是 `176×50` → 审计判「点了没变」；
* 同一时刻滚轮作用在 358px 高的真实滚动盒上 → 「mini 卡里能滚 300px」；
* 所有拿 rect 做碰撞/让位的计算都读到折叠矩形 → cctv/global 被推到 y=461/519、
  data 收起后仍报 `320×380 @(-60,-93)` → 「状态串到别的卡」；
* 更隐蔽的一层：`el.getAnimations().length` 当「正在动画」的判据。冻结动画永不结束，
  于是 `natRect / refreshNats / normalizeRail` 永久跳过 → **同组兄弟不被推开**，
  兄弟 header 被展开卡盖住，点不到（同组切换直接失效）。

## 改动（只动 `src/gev-liquid-cards.js`，未提交 git，未改材质/圆角/颜色/其它 UI）
1. **帧健康度探针**（`FRAME`/`framesHealthy`）：rAF 帧间隔 EMA + 最近一帧年龄。
   不健康（<12.5fps）时 `runMorph()` 直接不做 FLIP —— 几何立即生效，任何测量都读到终态。
2. **动画保险丝**：morph 动画 64ms 内 `currentTime` 仍 ≈0（一帧没走）→ `cancel()` 并补一次
   `onfinish`，让落定逻辑（存盘/钳位）照常执行。
3. **`animBusy()` 取代 4 处 `getAnimations().length` 一票否决**（`natRect` / `refreshNats` /
   `rememberNat` / `railAnimating`）：只判死「本层创建 + 已存在 >120ms + 一帧没走」的动画
   （出生时间用 `performance.now()`，因为被节流时 timeline 本身不走）；CSS transition
   没有登记 → 仍按旧行为算 busy，绝不误杀 hover 阴影补间。
4. **`settleGuard` 增加视觉对账**：浮层卡的渲染矩形必须等于 `st.g`；偏差且动画冻结/已停 →
   `cancel()` + 清 `transform`。停靠/迷你态同样清理冻结动画残影（修掉 `data 320×380 @(-60,-93)`）。
5. **滚轮门控**：`wheel` 只在「视觉高度 > mini 高度 + 12」时滚内容；否则吞掉滚轮（不滚、不漏给地图）。
6. `setPush` 的让位补间同样遵守帧健康度（inline `translate` 已同步写入，动画只是装饰）。

`?lc-hb=off` 是给 A/B 用的调试开关（关掉帧探针）；`window.__gevLcFrozenSkip / __gevLcFrozenKill`
是跳过/判死计数，供审计取证。

## Ego Lite 真实鼠标复测（1536×730 CSS 视口，全部 `isTrusted:true`）

### A. 窗口最小化（= 审计失败时的同一环境，rAF 实测 1.5fps）
`audit-minimized-full.json`

| 卡 | 展开尺寸 | 耗时 | 目标 | 其它卡变动 | 收起 |
|---|---|---|---|---|---|
| data-panel | 320×380 @52,94 | 3–6 ms | 320×380 | 无 | 回 176×43 |
| scene-panel | 320×340 | 2 ms | 320×340 | 无 | 176×43 |
| pp-toggles | 300×354 | 2–4 ms | 300(×430 被同轨让位钳到 354) | 无 | 176×50 |
| cctv-panel | 340×354 | 1–2 ms | 340 | 无 | 176×50 |
| global-context-panel | 320×354 | 1–2 ms | 320 | 无 | 176×50 |
| location-bar | 380×240 | 2–3 ms | 380×240 | 无 | 168×86 |
| control-panel | 520×380 | 2 ms | 520×380 | 无 | 168×86 |

* 同组互斥切换 4/4 通过：data→scene、pp→cctv、cctv→global、location→control，
  旧卡回 mini、新卡展开、组内恰好 1 张。
* mini 态滚轮 `scrollTop 0→0`（无效）；展开态 pp 滚轮 `0→332`（正常）。
* 结束态 7 卡全 mini，`push={0,0}`；`✕` 按钮 0 个；`bg: rgba(0,0,0,0)`。
* trusted pointer：69/69 事件 trusted，30 次 pointerdown 全部 trusted，0 untrusted。
* `__gevLcFrozenSkip=34`（冻结时主动跳过 FLIP）。

### B. 窗口可见（rAF 27.6–28.2fps，动画正常跑）
`audit-visible-final.json` — 7/7 展开尺寸达标（2–80ms），`othersChanged` 全空，
同组切换 4/4，`data+pp` 同时开重叠 0px²，结束全 mini；trusted 81/81。

## FPS（要求 ≥30，未达标 —— 但与本补丁无关）
* 本机实测：空白页（同窗口同视口）165.8 fps；GEV 首页 27.6–28.2 fps；
  展开两张卡 27.3 fps。帧间隔中位数恒定 36ms，`longtask` 计数 **0**。
* 归因：隐藏 Cesium 容器 / world-overlay / 全部卡片与折射环，帧率仍 27.5–28.1，
  说明不是本交互层、也不是单张卡，而是整页合成开销（36ms 固定节拍）。
* 本补丁 A/B：带帧探针 27.6 vs `?lc-hb=off` 27.0/27.3；探针自身累计 0.7–3.4ms /
  约 40–50 帧（≈0.02–0.07ms/帧）→ **FPS 中性**。
* 结论：≥30/60 需要在「材质/合成」层面另开性能专项（本卡明确禁止改材质），
  已按看板协议另开子卡。

## 未做（按任务约束）
未改玻璃材质/圆角/颜色；未动其它 UI；未提交 git（`src/gev-liquid-cards.js` 本身在
仓库里是未跟踪文件 `??`）。
