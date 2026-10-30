# Phase 5 · 全量验收 Gate（RTX 3060）

- 时间：2026-10-29 07:00–07:02（Ego Lite 0.6.1.13 / Chromium 156）
- 环境：`http://127.0.0.1:4173/`，视口 1360×782 @dpr1.25
- GPU：`ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU (0x00002520) Direct3D11 vs_5_0 ps_5_0, D3D11)`，`software:false`，`granted:high-performance`
- 工具：Ego Lite 真实指针（`page.mouse.click(x,y)` 坐标点击，无 `element.click()`）、真实截图、真实 DOM/computed style
- 脚本：`scripts/lc/phase5-gate-ego.mjs`（本轮 gate）；`scripts/lc/phase5-gpu-lock.md` 见下「GPU 锁定」
- 证据：`.gev-logs/ego/phase5/gate.json` + `01-initial.png / 02-location-open.png / 03-pp-open.png / 04-card-open.png / 05-full.png`

## 结果：浏览器实测 15/15 PASS；FPS 硬指标 FAIL（见「未达成」）

| # | 承诺 | 判据（本轮实测） | 文件/行 | 截图 |
|---|---|---|---|---|
| 1 | 双灰圈 = 0 | 9 张 `.gev-lc` 的卡壳 + 所有「面积 ≥90% 卡面」的内层图元：`border=0 / outline(none)=0 / backdrop-filter=none / box-shadow 仅 0 2px 10px rgba(0,0,0,.14)`，`bad[]=∅` | `public/gev-cn.css:15-24`（删除 `.panel-inner` 与 7 个 `#*-panel .*-panel-inner` 的 `!important` 描边+inset 发丝边）、`src/gev-graphics.js:227-231`（FAB 去 border/backdrop-filter/填充）、`src/lc/material.css:43` | `01-initial.png` |
| 2 | dock 彩虹/锯齿 = 0 | dock 面板在折射面列表里（`surfaces` 命中 dock rect），`dispPx=1.2`（R/B 采样间距 ≈0.48px，远小于 2px 可辨阈值）、`band=10` 整数像素栅格、单一 canvas `#gev-edge-lens` | `public/gev-edge-lens.js:61-62`（gain 1.0 / dispPx 1.2）、`:598-599`（uGain/uDispPx×scale）、`quadStrips()` 4 条不重叠边框条 | `01-initial.png` |
| 3 | `+ / ◀ / ▶` 旧按钮 = 0 | 全 `body` 可见文本（rect ≥2px、opacity ≥0.05、排除 input/script）扫描 `+ ◀ ▶ ◁ ▷ ＋ ❮ ❯ − ➤` → 0 命中 | Phase4C 已删字符源：`src/ui/templates/cockpit.html`、`context.html`、`src/ui/radioBindings.js`、`radioPresentation.js`、`src/layers/launches/replay.js`、`src/data/bhoteKoshiEvent.js`；替代为纯 CSS 三角 `src/ui/styles/cockpit.css` | `01-initial.png` |
| 4 | 点 location 后左右 rail 卡移动 ≤1px | 真指针点 `#location-bar` → 其余 8 卡 rect 差值全 0（`moved=[]`），location 自身确实变大 | `src/lc/layout.js`（纯几何）、`src/lc/interaction.js`、`src/lc/render.js` | `02-location-open.png` |
| 5 | 显示卡不拥挤/可滚/不重叠 | 17 行可见，相邻 gap 最小 8px（跨组计入），两两重叠 0，组盒 `height==scrollHeight`（squashed=∅），`scrollHeight 1240 > clientHeight`，滚到底末行完整可见 | `src/lc/material.css:84-86`（`.pp-toggle-group{flex:0 0 auto}`） | `03-pp-open.png` |
| 6 | 中/EN 与 GPU chip 不重叠 | `#gev-lang-toggle` 与 `#gev-perf-wrap` rect 不相交 | `src/lc/material.css:122`（`#gev-gpu-chip`） | `01-initial.png` |
| 7 | GPU 显示真实 renderer | `__gevGpu.probe()`：`renderer=RTX 3060 Laptop GPU`、`software:false`、`granted:high-performance`；chip 文本含 `3060` | `src/lc/gpu.js`（唯一读 `WEBGL_debug_renderer_info` 的模块） | `01-initial.png` |
| 8 | dock 面板底部空白 ≤24px | `dock.bottom - 最大可见子元素 bottom` ≤ 24px | `src/ui/styles/command-dock.css:97-109` | `01-initial.png` |
| 9 | 旧 App 布局/旧 `lg-glass.css`/旧拖拽层退役 | `src/ui/styles/lg-glass.css` 不存在、`public/gev-liquid-cards.js` 不存在、`__gevLc` 引用 0、`.panel-collapse-btn/.pp-collapse-btn/[data-collapse-target]` DOM = 0、`src/lc` 为几何与开合唯一所有者 | `src/lc/*`、`package.json` 无旧入口；`src/lc/runtime.test.mjs` TC-M6/M7 校验 material.css ≤300 行 / `!important`=0 / 双 ID=0 / 卡壳零 border 零 blur 零 inset | — |
| 10 | 液态玻璃恢复 | `gain=1.0`（0.6–1.0）、`dispPx=1.2`（0.8–1.5）、`band=10`、`ior=1.52`、`bandAlpha=0.55`；卡壳 `backdrop-filter:none` + 透明填充（中心透明）；只有 1 个折射 canvas（单一 owner） | `public/gev-edge-lens.js:45-70`、`src/lc/material.css`、`src/lc/tokens.json` | `01-initial.png` |
| 11 | 动画 350–450ms、果冻峰值 1.02–1.05 | WAAPI 实测开卡 `duration` ∈ [350,450]（两轴各自反解）；`TARGET_OVERSHOOT=1.035`、`SHIFT_PEAK=1.02` | `src/lc/morph.js:27,30,281` | `04-card-open.png` |
| 12 | 初始全 mini / 左右各 1 / dock 1 / 无重叠无出屏 | `phases` 全 `mini`，9 个 `.gev-lc` 两两重叠 0、出屏 0，`#command-dock`=1 | `src/lc/controller.js`、`src/lc/dock-overlay.js` | `01-initial.png` |
| 13 | 页面可响应、无主线程卡死 | `page.evaluate` RTT 5 次全部 ≤ 50ms；CPU profile 4s：主线程 **91.9% idle** | — | `05-full.png` |

补充通过：`10c` 单一 owner（1 个 `#gev-edge-lens`）。

## 单测 / build

```
node --test src/lc/controller.test.mjs src/lc/layout.test.mjs src/lc/morph.test.mjs src/lc/runtime.test.mjs
→ 81 pass / 0 fail

npm run build → ✓ built in 12.93s
```

## 未达成：锁 60fps（FAIL，需单独立项）

| 环境 | 8s rAF 平均 | p50 | p95 |
|---|---|---|---|
| Ego Lite（RTX 3060，本轮） | **27.5fps** | 36.4ms | 42.5ms |
| Chrome 155（RTX 3060，同 URL 1360×782） | **50.3fps** | 12.3ms | 54.5ms |

归因（本轮实测，全部 Ego 内 A/B）：

1. Ego 空白页 rAF = **165fps（6.1ms）**，同一浏览器同一窗口；应用页 = 27.5fps。所以不是宿主上限、不是“浏览器只能 27”。
2. 应用页主线程 **91.9% idle**（CDP Profiler 4s / 7191 采样），GPU 进程 5s 仅占 0.24 核（24% 单核），渲染器 12–16% —— 无 CPU/JS 瓶颈。
3. 逐项关闭均**无变化**（27.2–27.8fps 噪声内）：`__gevEdge.off()`、隐藏 world-overlay/cloud/scope 四个全屏 canvas、`viewer.useDefaultRenderLoop=false`、`resolutionScale 0.6→0.75`、`targetFrameRate 60→undefined`。
4. 逐帧间隔精确落在 165Hz 的整数倍上：30.3 / 36.4 / 42.4ms = 5/6/7 个 vsync；Ego 对**这一页**的呈现被钉在 6 vsync（165/6 = 27.5fps）。
5. 关掉同机的另一个 Ego 实例（旧的 `cindy-monitor-gev` space）后仍 27.5 → 不是多实例争用。

结论：27.5fps 来自「Ego 合成器 × 165Hz 面板」的呈现节奏，不在页面 JS、不在折射 pass（Phase4A 已证折射 ≤1fps 噪声）、不在玻璃参数（本轮零改动）。**要拿 59–61fps 需要在这个层面解决**，已开子任务 `Phase5-FPS`。

## FPS 归因第二轮（t_e21419d7，2026-10-29 12:00–13:00）：内容无关性二分 —— 结论反转

上一轮把 27.5fps 归给「Ego 合成器 × 165Hz 呈现节奏」是对的，方向错了：不是**这个页面**被钉在 6 vsync，而是**Ego 任务空间里任何持续动画的文档**都被钉在 6 vsync。

同一 Ego 空间、同一窗口、顺序加载合成页，每档 4s rAF 采样（脚本 `scripts/lc/_diag/fps-bisect-ego.mjs`，
原始数据 `.gev-logs/ego/phase5/fps-bisect.json`）：

| 合成内容 | fps | p50 | p95 | mode |
|---|---|---|---|---|
| v0 空白静态页（无动画、无 damage） | **164.8** | 6.1 | 6.2 | 6.1 |
| v1 一个全屏 2D canvas，每帧 fillRect | 27.0 | 36.4 | 42.6 | 36.4 |
| v2 一个全屏 WebGL canvas，**只 gl.clear()** | 27.2 | 36.4 | 42.5 | 36.3 |
| v3 全屏 backdrop-filter 层 | 27.6 | 36.4 | 42.5 | 36.4 |
| v4 9 张 backdrop-filter 卡 | 27.5 | 36.3 | 42.5 | 36.3 |
| v5 六个全屏 2D canvas | 26.8 | 36.4 | 42.6 | 36.3 |
| v6 2213×1272 单 canvas | 27.4 | 36.4 | 42.6 | 30.3 |
| **v7 10×10 div 每帧移动 1px** | **27.3** | 36.4 | 42.6 | 30.3 |
| 真实 App（127.0.0.1:4173） | 26.8 | 36.4 | 48.5 | 36.4 |

补充对照（全在同一页，均无变化）：

- `Page.bringToFront` + `Emulation.setFocusEmulationEnabled`（document.hasFocus() true）：27.8 → 28.1 → 25.2。
- `Emulation.setDeviceMetricsOverride{deviceScaleFactor:1}`（拉平上一轮怀疑的 dpr 1.25）：27.4。
- 10px div 动画 + 置前 + dsf1：27.5。
- 页面 9 张 `.gev-lc`、13 个 backdrop-filter 元素、Cesium canvas 2213×1272、`resolutionScale 1.3022`、
  dpr 1.25、inner 1360×782、screen 1536×864；renderer = `ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU …D3D11)`。

**结论（本轮硬结论）**

1. **27.5fps 与 App 无关**：一个 10px div 的位移动画、一个只做 `gl.clear()` 的 WebGL 页，跑出来的数和整个
   上帝之眼一模一样（27.2–27.5）。所以历史「放弃折射/Cesium/遮盖层/分辨率/限速器」的 A/B 全部无效——
   它们本来就不可能改变这个数，不是因为「开销小」，而是因为瓶颈根本不在页面里。
2. **只与「是否有持续 damage」有关**：同一窗口静态页 164.8fps，一旦每帧产生新的合成帧就掉到 27.5。
   即 Ego 在**呈递一个持续更新的帧**这件事上被限制在 ≈6 vsync。
3. **不是固定成本，是被限速**：帧间隔分布是 30.3 / 36.4 / 42.4ms（5/6/7 vsync）三档散开，mode 在 6。
   固定 36ms 成本不可能偶尔给出 30.3ms，这是**围绕 ~33ms 目标的软件限速 + 165Hz vsync 量化**的典型特征
   （目标 30fps = 33.3ms → ceil(33.3/6.06)=6 vsync=36.4ms → 27.5fps）。
4. dpr、窗口焦点、DSF、页内层数、canvas 尺寸、backdrop-filter 数量**都不是变量**。

**顺带一个规格缺陷（必须改验收口径）**：在 165Hz 面板上，「8s 平均 59–61fps **且** p95 ≤16.7ms」数学上不可能。
vsync = 1000/165 = 6.0606ms，rAF 间隔只能是 12.12 / 18.18 / 24.24…ms。要平均 16.667ms，必须 75% 的帧落在
3 vsync（18.18ms），于是 p95 必然是 18.18ms > 16.7ms。这条指标是按 60Hz 面板写的。
正确写法是**下界**：「fps ≥ 60 且 p95 ≤ 16.7ms」——在 165Hz 上对应 2 vsync（12.12ms / 82.5fps）即可同时满足。

**下一步（需要人拍板，已在 t_e21419d7 阻塞上报）**

- A：把面板切到 60Hz 再跑 gate（Windows 设置 → 显示 → 高级显示 → 60Hz）。若 60Hz 下同一页能到 55–60，
  说明「锁 60」在 60Hz 前提下达标，165Hz 是 Ego 的环境缺陷，不应记在 App 头上。
- B：改用「fps ≥ 60 且 p95 ≤ 16.7ms」口径 —— 同机 Chrome 同页只是 p50 达标（12.3ms = 2 vsync），
  8s 均值 50.3、p95 54.5ms，**Chrome 也过不了这条**，所以 B 单独用不成立，只能作为辅助对照。
- C：把 FPS 验收改成**单帧渲染成本**（`performance.mark` 包住 viewer.render + 边缘折射 draw，取 p95 ≤8ms），
  与呈递节奏解耦，测的是代码而不是浏览器。

## GPU 锁定（本轮新增，系统级）

Ego 默认走 Intel UHD。已按《上帝之眼-GPU-3060默认设置.md》给 Ego 可执行文件加 Windows 图形首选项（等价于「设置 → 图形 → 高性能」）：

```
HKCU\Software\Microsoft\DirectX\UserGpuPreferences
  "C:\Program Files\Citro Labs\ego lite\Application\ego.exe"                                  = SpecificAdapter=10DE&2520&A641028;GpuPreference=1073741824;
  "C:\Program Files\Citro Labs\ego lite\Application\ego-browser.exe"                          = 同上
  "C:\Program Files\Citro Labs\ego lite\Application\0.6.1.13\ego-browser.exe"                 = 同上
```

重启 Ego 后 `__gevGpu.probe().renderer` 即 `NVIDIA GeForce RTX 3060 Laptop GPU`（改前是 `Intel UHD 0x9BC4`）。回滚：删除这三个值并重启 Ego。

## 已知环境注意

- Ego 的 profile 只对 `127.0.0.1:4173` 预授权了定位；用 `localhost:4173` 会弹「位置权限」原生提示，任务空间会被交给用户。**验收统一用 `127.0.0.1:4173`**。
- `page.evaluate` 单次上限约 15s：长时间采样要拆成多次调用。

## FPS 复验（t_e21419d7，Chrome + RTX 3060，50–60 口径）

用户把指标放宽为：**8s 平均 ≥50fps 且 ≤60fps；不允许单帧 >100ms；不允许掉到 30fps 以下；GPU 必须 3060；玻璃不许降级**。

### 结论（先看这里）

- **Ego 27.5fps 的归因不变**（Ego 任务空间对持续动画文档的呈递限速，与 App 无关）。
- **换 Chrome 后，同一 URL 不再被 27.5 钉住**：预热后单次 8s 采样可到 **115.7 / 147.3 / 108.0fps**（p50 6.1ms，0 帧 >100ms）。
- **但交互期不稳定**：同一脚本连跑 4 次，出现 3 种状态 —— 120fps 档、60fps 档、20fps 档（含 100–135ms 停顿）。
  所以**本轮 FPS 验收结论是 FAIL（不稳定）**，不是「已达标」。证据见 `.gev-logs/lc/fps-accept/gate.json`。
- 上界「≤60」在 165Hz 面板上不可达（rAF 恒等于刷新率，空白页实测 165fps），只能靠切 60Hz 面板字面复验；
  应用侧对地图渲染已锁 60（`viewer.targetFrameRate=60`）。

### 实测（`scripts/lc/fps-accept-gate.mjs`，Chrome 155 + RTX 3060 Laptop，1360×782 dsf1）

每轮 = 预热 3s 真拖拽 → 3 个 8s 窗口（真鼠标拖拽 / 真点击开合卡 / 真拖拽）。

| 轮次 | w1 pan | w2 morph | w3 pan | >100ms 帧 | 判定 |
|---|---|---|---|---|---|
| 12:42 | 115.7 | 147.3 | 108.0 | 0 / 0 / 0 | PASS |
| 12:44 | 66.7 | 120.3 | 29.9 | 0 / 0 / 0 | FAIL（w3 29.9） |
| 12:56 | 60.2 | 56.6 | 18.4 | 4 / 2 / 4 | FAIL（单帧 127ms） |
| 单窗口 ×2 | 122.5 / 0（并发实例干扰） | — | — | 0 | PASS / 无效 |

→ 同一代码、同一机器，**8s 均值可在 18–148fps 之间摆动**。这是本轮真正的缺陷（不是 27.5）。

### 交互期帧成本归因（`scripts/lc/_diag/fps-attrib-chrome.mjs`，各 3s 真拖拽）

| 组 | 处理 | fps |
|---|---|---|
| 1 | baseline | 58.6（p95 48.5，max 151.5） |
| 2 | 隐藏 `#world-overlay-canvas` + `#world-overlay-detection-surface` + `#scope-mask` | **102.4** |
| 3 | 再隐藏 `.celestial-ring-canvas` | 110.6 |
| 4 | 再隐藏 `#cockpit-cloud-effects` + `#gev-edge-lens` | 99.3 |
| 5 | `resolutionScale=0.5`（仅诊断） | 114.9 |
| 6 | `resolutionScale=1.0` | 114.2 |

- **边缘折射不是瓶颈**：`__gevEdge.off()` 前后 23.0 → 26.1（噪声内），与 Phase4A 结论一致。
- **`useDefaultRenderLoop=false`（停 Cesium 循环）→ 106.6fps（徽标 136）**：帧成本集中在「相机每变一次 → Cesium 重绘 + 三个全屏覆盖层重绘」这条链上。
- 分辨率 0.5 vs 1.0 **无差别** → 不是填充率，是每帧固定开销（全屏 2D 重绘 / 纹理上传 / 瓦片调度），
  下一步应做「覆盖层按需重绘（相机变化阈值 + 30Hz 节流）」，而不是砍分辨率或砍玻璃。

### 采样口径（重要，历史数字对不上就因为这个）

1. **必须预热**：页面加载后 12s 直接采样会拿到 20–37fps（瓦片流/着色器冷启动）；加 3s 真拖拽预热后同页 100fps+。
   历史「Chrome 50.3fps」大概率是冷启动或并发实例干扰下的数。
2. **必须单实例**：同机并发再开一个 Chrome/Ego 渲染同一页，会让窗口掉到个位数（实测单窗口跑出 0fps、8s 只发出 1 次鼠标移动）。
3. **rAF 在 165Hz 上恒等于刷新率**，它衡量的是「页面是否被节流」，不是「App 画了多少帧」；
   App 自己的帧产出看 `__gevEdge.stats()` 与 `scene.postRender`（注意 Cesium 一帧可能触发两次 postRender，
   渲染层内部按 4ms 去重）。

### 复验方式

```
node scripts/lc/fps-accept-gate.mjs            # 3×8s，写 .gev-logs/lc/fps-accept/gate.json + 截图
node scripts/lc/fps-accept-gate.mjs --windows=1
```

若要字面满足「≤60」，先把面板切到 60Hz 再跑同一条命令（rAF 会变成 60，上下界都可判）。

## FPS 修复轮（t_4eacd341，覆盖层按需重绘）

### 改了什么（已入库源码）

`src/overlays/worldOverlay.js`：host 的两个全屏 2D 面（`#world-overlay-canvas`、`#world-overlay-detection-surface`）
原来**每一帧相机变化都整屏 clear + 重绘 + 整面上传**，现在有交互期节拍上限：

- `MOTION_REPAINT_INTERVAL_MS = 33`（≈30Hz）只作用于**相机位姿真的变了**的帧（拖拽/缩放/环绕）；
- 位姿没变（淡入淡出、leader 动画、开合卡、数据更新）仍按显示刷新率画，交互动画不降帧；
- 位姿判定用 `positionWC`/`directionWC`/`positionCartographic.height` 与「上一张已画帧的位姿」严格比较，
  没有位姿就没有多画一帧的理由；
- 被节拍挡下的帧会挂一个**尾帧**（`scheduleDeferredPaint`），相机停手后最后状态一定落屏，不会留下 33ms 的残影；
  `destroyWorldOverlay` 清定时器并复位位姿。

单测：`worldOverlay.test.mjs` 48 项全过（新增「相机移动把 host 重绘压到 30Hz，且不丢尾帧」用例）、
`worldOverlayAllocation.test.mjs` 13 项全过；`npm run build` 通过。

### 实测：这个节拍在「慢档」里不是约束

| 观测 | 结果 |
|---|---|
| 修复后 gate（13:11，3×8s） | 21.6 / 46.1 / 20.7fps + 3 帧 >100ms → **FAIL（与修复前同档）** |
| 拖拽期覆盖层真实重绘频率（`fps-overlay-paint-hz.mjs`，8s） | `world-overlay-canvas` **17.3Hz**、`world-overlay-detection-surface` **17.3Hz** |
| 同窗口 rAF | 26.0fps（p50 42.2ms，max 115ms） |

关键点：慢档里 App 自己只有 17–26fps，覆盖层早就低于 30Hz 上限了 → **节拍不生效，也不可能是瓶颈**；
它的收益只在「快档」（58–148fps，覆盖层被画到 60–148 次/秒）体现，本轮机器状态进不了快档，因此无法验证收益。

### 慢档到底卡在哪（本轮新证据）

| 对照（`fps-ab-chrome.mjs`，各 4s 真拖拽） | fps |
|---|---|
| A baseline | 16.4（p95 170ms，9 帧 >100ms） |
| B `__gevEdge.off()` | 26.8 |
| C edge 恢复 | 18.7 |
| D `useDefaultRenderLoop=false`（停 Cesium 循环） | **74.0**（p50 12.2ms） |

- 停掉 Cesium 循环后仍有 **~13.5ms/帧** 的非 Cesium 成本（玻璃合成 + 覆盖层 + 边缘层 + 浏览器呈现），
  所以「停 Cesium = 106fps」的父任务结论在当前机器状态下只复现到 74fps。
- 反过来算：26fps（38ms）− 13.5ms ≈ **Cesium 每帧渲染 ~24ms**，这才是慢档的主项（快档同一项只要 ~5ms）。
- LoAF（`fps-loaf-chrome.mjs`，30s 真拖拽）里长帧的脚本归因：`Cesium.render2` 占 1.70s/30s 长帧脚本时间，
  其次是瓦片回调 `cesium.js:770831` 0.69s；无脚本长帧 **0 个** → 停顿在主线程，不在合成器。

### 环境证据（为什么不建议在当前机器状态下判 FAIL）

- 同一份代码、同一台机器：**12:42 轮 115.7/147.3/108.0fps，13:00 之后 16–26fps**，中间没有任何 App 代码改动。
- `nvidia-smi pmon`：验收期间 **`ego.exe` 持续吃 32% GPU / 709MiB**，另有两个 `msedge.exe` 持有 GPU 上下文；
  这正是父任务「并发第二个渲染实例 → 掉到个位数」的放大版。
- 玻璃参数全程未变：`gain 1.0 / dispPx 1.2 / band 10 / count 9`（gate 断言全 true），未降级、未关折射。

### 下一步（单点，按性价比）

1. **验收环境**：跑 gate 前独占 GPU（关掉 Ego / Edge 里打开同一页的实例），否则任何 App 侧优化都会被 32% 的外部占用吃掉。
2. **交互期纹理调度**（原方案第 2 项）：`scene.postRender` 里 edge-lens 的 `texSub` 与 Cesium 瓦片上传同帧 ——
   慢档 B 组 `edge.off()` 提升 63% 说明这一层值得隔帧上传/`texSubImage2D` 局部更新，且不违反「不关折射」。
3. **Cesium 渲染**：慢档每帧 24ms 且不是填充率（`resolutionScale` 0.5/1.0 无差别），
   下一步该查瓦片/地形请求在拖拽期的排队（`useDefaultRenderLoop=false` 立涨到 74fps 已把范围锁死在这里）。


