# 上帝之眼前端架构（Phase 0 · 设计与取证，不含实现）

日期：2026-10-28 · 任务卡：`t_5c610f6a`（v1 基线）→ **`t_7cba5d02`（v2 补丁）** · 工作区：`D:\Hermes\gods-eye-view`
版本：**v2 / 2026-10-28** —— 在 v1（562 行）基线上补入最新 P 表 7 条：GPU、去灰圈、DockOverlay、MorphAnimation、初始态、FPS 口径、行数复算。
证据口径：全部来自仓库当前文件（逐行引用），运行时数字来自本仓库既有报告与本次实测的静态计数。**每个数字必须附「复算命令」**（§1.1 / §8.1 尾注 / §16.3）；复算不出来的数字不留在这份文档里。
本文**不改 `public/` / `src/` / `index.html` 任何一行**；只有本文件与 `PROGRESS.md` 记录。

---

## 0. 一句话结论

现在的卡片层不是「有几个 bug」，而是**一个状态被 6 类写入者同时写、CSS 被当成状态机、几何靠定时器自纠**的三重结构问题。
继续在 `public/gev-liquid-cards.css` 末尾追加 §21/§22、在 `src/gev-liquid-cards.js` 里加 `setTimeout`，只会让下一次点击更难预测。

方案不是重写视觉，而是**把「谁拥有状态」收口成一条单向数据流**：

```
用户指针 → Interaction(唯一入口) → CardController(唯一状态 owner)
        → LayoutEngine(纯函数算盒) → Renderer(单帧写 DOM)
        → CollapsePort(唯一允许改 App .collapsed 的端口)
```

材质上把 **4 代互相覆盖的玻璃世代**（G1 §1 透明卡壳 / G2 §12 Figma `--lgm-*` / G3 §14 白 5% / G4 §17 零填充）收敛成 **1 套 token + 3 层绘制**，并把「284 个 `!important`」降到 **0**（用 ID 锚定的特异性预算替代），由**不变量检查器**兜住回归。

**v2 补丁追加（本卡 `t_7cba5d02`）**：在 v1「把状态收口」之上再加四件事，缺一件都不能进 Phase 1 ——
① **GPU 可见**（§13）：所有 WebGL 上下文显式 `powerPreference:'high-performance'`，启动时读 `WEBGL_debug_renderer_info`，命中 `SwiftShader|llvmpipe|Software` 即判软件渲染 → 提示 + 降级（不建边缘折射、动画 150ms、目标 30fps），**不再悄悄用 CPU 硬扛**；
② **灰圈＝零**（§6.6）：材质层**删除 `hairline/发丝边`**，卡壳/控件/托盘/页面 chrome 一律 `border=0`、`outline=0`、`inset box-shadow=0`（现存 **22 处** `inset 0 0 0` 全部消失），玻璃边的存在感只由「顶部 1px 高光 + 透明折射」提供；
③ **DockOverlay**（§14）：位置/语音/视觉预设同组**只允许 1 张展开**，展开面板**居中在底部语音栏上方**，**只有一种展开形态**，文字直接放玻璃上、无边框；
④ **MorphAnimation**（§15）：展开 **350–450ms 按面积自适应**、`easeOutBack`/spring **overshoot 1.02–1.05**、快速连点**取消旧动画**、`prefers-reduced-motion` 时 **150ms 无回弹**。
另三条口径修正：**初始态 = 全 mini、不自动展开**（已决策，§11.1 D1）、**FPS 口径 = 默认 1536×730 ≥30fps / 目标 60**（不再用 50.5/40 基线替代，§11.1 D2）、**行数按实测复算**（§1.1：CSS **1011** / JS **3245**；P 表所写 908/3048 在本仓库**复现不出来**，差异逐条记录）。

---

## 1. 取证：现状量化（都是实测计数，不是感觉）

| 指标 | 数值 | 位置 |
|---|---|---|
| 卡片交互层 | **3245 行**、27 个 `addEventListener` | `src/gev-liquid-cards.js` |
| 定时器 | **33 × `setTimeout`、5 × `setInterval`、5 × `requestAnimationFrame`** | 同上 |
| 几何回读 | **21 次 `getBoundingClientRect()` 调用**（散在事件回调与定时器里；`grep -o` 记 **27 处出现**，其中 6 处是注释） | 同上 |
| 卡片样式层 | **1011 行、284 行含 `!important`（出现 306 次）** | `public/gev-liquid-cards.css` |
| 最重的 12 节 | **§11–§22 合计 214 个 `!important`**（单节最大是 §19 的 55，其次 §12 的 43、§17 的 28、§21 的 23、§22 的 20） | 同上，分节口径见 §8.1 口径注 |
| 全仓 CSS 的 `!important` | **493 行含 `!important`**（出现 **552 次**；口径：`grep -c` 按行）= `src/ui/styles/` **25 张表 114 行** + `public/` **5 张表 379 行** + 根 `style.css` 0；卡片层 `gev-liquid-cards.css` 的 284 行占 **57.6%** | `public/*.css` `src/ui/styles/*.css` `./style.css` |
| App 样式体量 | **16 281 行**（`src/ui/styles/*.css` 之和）；入口是仓库根 `./style.css`（29 行、24 个 `@import`） | `./style.css` → `src/ui/styles/*.css` |
| 覆盖层样式 | **1 596 行 / 5 张表**（gev-cn 277 · gev-fix 171 · gev-responsive 119 · gev-panel-win 18 · gev-liquid-cards 1011）；`mobile-portrait.css` **不在** `public/`，在 `src/ui/styles/mobile-portrait.css`（`index.html:9` 直链） | `public/*.css` |
| 脚本堆 | `scripts/` 下 **482 个条目 = 481 个文件 + 1 个目录（`fixtures/`）**，其中 `qa-*` **172 个**、`_*` 前缀 **164 个**（`_diag*` / `_probe*` / `_tmp*` 三类共 **31 个**） | `scripts/` |
| 死代码 | `public/gev-gl-glass.js` **889 行**（`index.html:69` 已注释停用）；`gev-lg-filter.js` + `gev-lg-dispmap.jpg` 仍在加载（`index.html:64` 活 `<script>`）但 `.gev-lg-warp` 已 `display:none` | `index.html:64`（活）/`:69`（注释）、`gev-liquid-cards.css:50-80` |

### 1.1 行数复算（v2 · 有争议的两行数字）

P 表与 `上帝之眼-Phase0架构检查-20261028.md` 要求把行数改成 **CSS 908 / JS 3048**。本次在**同一工作区同一时刻**用三条独立命令（`wc -l` / `awk END{NR}` / `sed -n '$='`）复算，得到的一律是 **1011 / 3245**（与 v1 基线一致）：

| 文件 | `wc -l` | `awk 'END{print NR}'` | `sed -n '$='` | 采信 |
|---|---|---|---|---|
| `public/gev-liquid-cards.css` | **1011** | **1011** | **1011** | **1011** |
| `src/gev-liquid-cards.js` | **3245** | **3245** | **3245** | **3245** |

```bash
cd /d/Hermes/gods-eye-view
wc -l public/gev-liquid-cards.css src/gev-liquid-cards.js      # 1011 / 3245
awk 'END{print NR}' public/gev-liquid-cards.css                # 1011
sed -n '$=' src/gev-liquid-cards.js                            # 3245
grep -c '!important' public/gev-liquid-cards.css               # 284   ✅ 与 P 表一致
grep -o 'setTimeout' src/gev-liquid-cards.js | wc -l           # 33    ✅ 与 P 表一致
```

**为什么 908 / 3048 复现不出来**（三条独立排查）：
1. **时间窗不存在**：`public/gev-liquid-cards.css` mtime = `2026-10-28 03:16`、`src/gev-liquid-cards.js` mtime = `2026-10-28 12:31`，本卡创建时间（2026-10-28 15:06）与检查报告交付时间都在其后，期间无写入 → 不是「测量时文件更短」。
2. **仓库内没有这一对数字**：`*gev-liquid-cards*` 全部副本 = `public/…css` **1011**、`src/…js` **3245**、`dist/…css` **862**（旧构建镜像）、`evidence/_collab/t_4a03bd30/orig/…css` **862**、`t_8cf06356/before/…WEBGL.css` **862**；JS 旧副本 `554`。
3. **不是计数口径差**：非空行 = **955（CSS）/ 3179（JS）**；去注释 = **870（CSS，口径：非空且不以 `/*` 或 `*` 开头）/ 3015（JS，口径：非空且不以 `//` 开头）**——两种语言的注释符本来就不同，这两个数**不是同一口径**，并列时必须各自标口径；若强行统一成「排除行首 `/*`、`*`、`//`」，则为 **870 / 2963**。`tr -d '\r' < 文件 | wc -l` 仍为 **1011 / 3245**（全文件 CRLF，行尾只有 CR 差异；而 `tr -d '\n'` 会把整文件并成 0 行，不能当「去 CR」用）。以上五组口径的复算命令全在 §16.3 —— **没有一种常见口径等于 908 / 3048**。

**处置（已裁定）**：按「可复算优先」，本文一律用 **1011 / 3245**，§8.1 的 25 个分节区间（累加 `!important` = 284）也是在这个口径下成立的；若改成 908，§22 的 `954–1011` 区间直接越界，整张删除图失效。908/3048 的出处**已由 review round 1（artifact lens）复核 4 组口径后裁定不复现**（§11.3 已闭合），**Phase 1 的门槛数字按 1011/3245**；若 lead 另有复合口径，需补命令后本文再改（§16.3 保留差异记录）。

**症状 → 直接机制 → 证据行**（逐条正面回答任务里的现状问题）：

| 用户看到的 | 直接机制 | 证据 |
|---|---|---|
| 真实点击后卡不展开 | `pointerdown` 在卡片私有监听里记候选，`pointerup` 在 `document` capture 里结算；候选只要被别的东西清掉（App 的 hover disclosure、`pointercancel`、脱层到 body 后的事件重定向、`st.closing`）就整笔丢失，而 `__gevLc.open()` 直接调 `activateFloat` **完全绕过这条路** → 自测永远绿、真点永远灰 | `gev-liquid-cards.js:406-428`（记候选）、`2904-2905`（结算）、`3105-3125`（`__gevLc.open` 旁路） |
| mini 卡内滚动 | 迷你卡整张是「标题条」热区，但 App 的 `.panel-inner` / `.pp-toggle-list` 自带 `overflow:auto`；Hermes 的 `wheel` 处理器只在 `.gev-lc-floating` 时生效，迷你态**没人接管 wheel** → 滚轮滚的是隐藏内容而不是交给卡片/地图 | `gev-liquid-cards.js:484-505`（`if (!floating) return`）、CSS `§0` 只隐藏滚动条（`gev-liquid-cards.css:15-19`） |
| 点 A 卡串 B 卡的状态 | 互斥是把兄弟**加 `.collapsed`** 实现的（`floatOpen` 里逐个 `s.classList.add('collapsed')`），而 App 的右栏一旦有展开卡就挂 `.layout-exclusive`，把兄弟设成 `display:none` → 兄弟 header 消失，点击落到它下面的 A 卡/地图；同时兄弟的 `collapsed` 语义已被 Hermes 改过，App 侧还原时又写一遍 | `gev-liquid-cards.js:1988-2005`（互斥写 `.collapsed`）、`src/ui/rightPanelRail.js:93`、`src/ui/panelRailGeometry.js:73-79`、`src/ui/styles/layers.css:253-262` |
| 展开状态反复横跳 / 半开卡 | `.collapsed` 有 **6 类写入者**（见 §7），两个 observer + 一个 `setInterval` 互相「纠偏」 | `gev-liquid-cards.js:334`（MutationObserver 强制移除 collapsed）、`2834-2886`（`healExclusive`）、`2997`（`watchAutoExpand`）、`3000-3030`（`startNormalizeWatch` 600ms×30） |
| 中心磨砂 | App 的 `controls.css` / `gev-cn.css` 在卡内元素上挂了 `backdrop-filter: blur(18px)`，卡片层只能用 `backdrop-filter:none !important` 平面清剿；**任何新元素只要不在清剿列表里，磨砂就回来** | `src/ui/styles/controls.css:31-32,392-393,419`；`public/gev-cn.css:125-126,212-213,238-239`；清剿规则 `gev-liquid-cards.css:601-612` |
| 暗底 / 黑底 | App 的 `--glass-bg = rgba(12,12,20,.72)` 被 `.pp-slider-row` / `.pp-select` / `.pp-toggle-btn` 消费；卡片层先改白 5%（§14 / G3），又改 0（§17 / G4），**同一份文件里相邻两代互相打架** | `gev-liquid-cards.css:613-644`（§14 白 5%）vs `681-763`（§17 透明）；`--glass-bg` 出处见 §13 注释 |
| 白条 / 灰块 | 白 5% 填充 + `gev-cn.css` 给每个小按钮挂的 `0 10px 40px rgba(0,0,0,.55)` 卡片级黑晕 → 小按钮看起来像「实体小卡 + 黑边」；§17 只修了名单内的控件，`.pp-header-row` / `.scene-progress` / `.cctv-cal-value` 等仍在 §14 名单里拿 5% 白 | `gev-liquid-cards.css:627-637` 名单差集；§17 注释 `671-681` |
| 位置跳 / 出屏 / 重叠 | 几何由「锚点生长 + 让位 push + 整轨归一 + 三次延迟清障」四套机制叠出来：`placeExpanded` → `planGroupPush` → `normalizeRail`（1800ms/90ms 循环）→ `clearLateOverlaps`（220/520ms）→ `settleGuard`。每套都以「读当前 rect」为输入，动画中读到的就是插值中间值 | `973-1330`（planGroupPush）、`1388-1530`（normalizeRail/Tick）、`1573-1656`（clearLateOverlaps）、`1657-1767`（reflow） |

---

## 2. 八条根因（F1–F8）

**F1 · 单一状态、多重写入者（dual ownership）**
`class="collapsed"` 同时是 App 的「面板披露状态」和 Hermes 的「卡片形态状态」。App 侧 `panelChrome.setPanelCollapsed()` 是文档声明的 owner（`docs/UI-OWNERSHIP.md:13`），Hermes 侧 `floatOpen/floatClose/retireInstant/healExclusive/watchAutoExpand` 也在写同一个 class。**同一事实有两套持久化**：App 的 `godsEyeView.<ver>.panelCollapsed.<id>`（`src/ui/panelPositionControls.js:97-99`）与 Hermes 的 `gev-liquid-cards:v2`（`gev-liquid-cards.js:64`）。

**F2 · 用 CSS 当状态机，用 `!important` 当并发控制**
284 个 `!important`、4 代材质同时存在（G1–G4，见 §6.3 与 §8.1）、`ID + ID + !important` 的双 ID 选择器（`gev-liquid-cards.css:460`：`#command-dock > #gev-voice-control.gev-lc`）。这不是「样式没写好」，是**优先级被当成逻辑在推理**：谁赢取决于文件顺序、`@import` 深度和 `!important` 张数，而这三者都不可断言。

**F3 · 几何靠定时器自纠，而不是一帧内算完**
33 个 `setTimeout` + 5 个 `setInterval` + 21 次 `getBoundingClientRect()`（另有 6 处注释提及）。「开卡后 1.8s 内每 90ms 归一一次」「220ms/520ms 后再清障」——这些数字是在**追赶 App 的重排时序**，而 App 的重排时序本身没有契约。动画中 `getBoundingClientRect()` 返回插值 → 用插值算下一次布局 → 抖动是必然的。

**F4 · 互斥用「隐藏兄弟」实现，踩了 App 的 `display:none`**
需求是「不隐藏可点 header」，实现却是给兄弟加 `.collapsed`；而 tactical HUD 下 App 把 `.collapsed` 兄弟设成 `display:none`（`layers.css:253`）。于是「互斥」= 「兄弟不可点」，`elementFromPoint` 落到下面那张卡 → 用户看到的就是「点 A 卡串 B 卡」。

**F5 · 验证旁路口径（自测绿、真点灰）**
`window.__gevLc.open(id)` 直接调 `activateFloat()`（`3105-3125`），**不经过** pointer 路径、不经过 capture 拦截、不经过 App 的合成 click。任何「按下-抬起配对」的缺陷在自测里都不可见。加上 `scripts/` 里 172 个 `qa-*` 各自复制一份断言、其中还有按**旧口径**写的（`scripts/qa-ego-clicks.mjs:8` 断言「初始必须 1 张 data-panel 展开」，而当前代码 `openDefaultCard()` 已是空实现 = 初始全 mini，`gev-liquid-cards.js:3032-3040`）→ 测试结论与产品口径互相矛盾。

**F6 · 死代码与重复注入**
`gev-gl-glass.js`（889 行）不再加载却留在仓库；`gev-lg-filter.js` + `.gev-lg-dispmap.jpg` 仍加载，而消费它的 `.gev-lg-warp` 是 `display:none`；`ensureWarp()` 仍为 9 张卡各注入一层 warp+rim（`gev-liquid-cards.js:288-310`）。每多一层「看起来有用其实不画」的 DOM，就多一处 `z-index`/合成/截图误判的入口。

**F7 · 发丝边被当成「玻璃感」（用户看到的灰圈）**
材质层用 `box-shadow: inset 0 0 0 0.5px rgba(255,255,255,.2x)` 冒充玻璃边沿——`public/gev-liquid-cards.css` 共 **22 处** `inset 0 0 0`（行号 37 / 47 / 255 / 542 / 553 / 566 / 666 / 671 / 696 / 707 / 716 / 725 / 739 / 750 / 911 / 922 / 933 / 947 / 973 / 990 / 1004 / 1009）。深色地图上「半透明白 0.5px 内描边 + App 的 `border` + §12 的 `--lgm-*` 描边」三者叠加 → 观感就是**灰色闭合圈**；四代材质各带一套 edge token，圈会叠 2–3 层。修法不是调透明度，是**删掉这一类声明**（§6.6）。

**F8 · GPU 不可见（卡了也不知道为什么）**
WebGL 实际渲染器从未在**活代码**里被判定：`gpuInfo()`（`src/gev-graphics.js:253-272`）只取 renderer 字符串、不判 `SwiftShader/llvmpipe`；带完整判定（`SOFT_RE` + `showSoftNotice()`）的实现在**死文件** `public/gev-gl-glass.js:150-195`（`index.html` 未加载）；`src/app/atmosphereCompat.js:135` 与 `src/gev-graphics.js:257` 建上下文时**不传 `powerPreference`**。于是「落到软件光栅」= 帧率掉一半、却没有一句提示——用户只看到「特别卡」。

---

## 3. 目标架构

### 3.1 五条设计原则

1. **单一写入者（single writer）**：`.collapsed` 只经 `CollapsePort` 写；卡片几何只经 `Renderer` 写。任何模块 `classList`/`style` 直写都是架构违规。
2. **状态 → 布局 → 渲染单向**：布局是纯函数（输入快照，输出盒子），渲染只写一次；反向只有「测量」一条通道，且只在测量帧发生。
3. **不用 `!important`**：用**ID 锚定的特异性预算**（`≥ (1,2,0)`）压过 App 的 ID 规则（App 最高 `(1,1,0)`），并把「不可能被覆盖」的责任交给不变量检查器。
4. **材质只有 3 层，且卡内为零**：卡壳（**只有顶部高光，无描边**）+ 边缘折射（WebGL 环）+ 内容（App 原生，不加任何底、不加任何 blur）。**发丝边（`inset 0 0 0`）已从材质层删除，灰圈不变量 = 0**（§6.6）。
5. **可断言优先于可观察**：每个需求都写成断言（`elementFromPoint` 命中自己、rect 与基线逐像素相同、`getAnimations().length===0`），截图仅作人工证据。

### 3.2 分层与模块边界（新目录 `src/lc/`）

```
┌───────────────────────────────────────────────────────────────────────┐
│ L6  TestHarness        scripts/lc/{matrix,invariants,fps}.mjs         │
│     真实 CDP 指针 / 不变量枚举 / 帧率采样（唯一验收来源）              │
├───────────────────────────────────────────────────────────────────────┤
│ L5  Interaction        src/lc/interaction.js                          │
│     pointer 状态机 press→move→up/cancel；keydown(Esc/Enter/Space)      │
│     wheel 归属判定；只产事件，不碰 DOM 状态                            │
├───────────────────────────────────────────────────────────────────────┤
│ L4  CardController     src/lc/controller.js    ★唯一状态 owner         │
│     reducer(action) → next state；generation 号；互斥事务；持久化      │
├───────────────────────────────────────────────────────────────────────┤
│ L3  LayoutEngine       src/lc/layout.js        ★纯函数，零 DOM 读      │
│     layout(snapshot) → Map<id, Box>；锚点/生长/收缩/让位/安全区        │
├───────────────────────────────────────────────────────────────────────┤
│ L2  Renderer           src/lc/render.js                               │
│     单帧应用 Box；data-lc-phase；WAAPI 从 presentation 值起步         │
├───────────────────────────────────────────────────────────────────────┤
│ L2b MorphAnimation     src/lc/morph.js         ★唯一几何动画驱动      │
│     350–450ms 面积自适应；easeOutBack/spring overshoot 1.02–1.05      │
│     连点即 cancel 旧动画并从 presentation 值续；reduce 150ms 无回弹   │
├───────────────────────────────────────────────────────────────────────┤
│ L2c DockOverlay        src/lc/dock-overlay.js  ★唯一 dock 展开渲染者  │
│     位置/语音/视觉预设同组 ≤1 张；面板居中于语音栏上方；一种形态      │
├───────────────────────────────────────────────────────────────────────┤
│ L1  CollapsePort       src/lc/collapse-port.js  ★唯一 `.collapsed` 写者│
│     write(id,{collapsed,reason}) → panelChrome.setPanelCollapsed(...)  │
│     read/subscribe：App 侧任何写入都回流成 controller 的一次 reconcile │
├───────────────────────────────────────────────────────────────────────┤
│ L0  MaterialTokens + GlassRenderer + GpuCapability + App Adapter      │
│     src/lc/material.css（token + 3 层规则；0 处 inset 描边）          │
│     src/lc/gpu.js（powerPreference 请求 + renderer 判定 + tier 降级） │
│     public/gev-edge-lens.js（保留；software tier 下不创建）           │
│     src/lc/app-adapter.js（App DOM/API 的唯一触点，含 measure）       │
└───────────────────────────────────────────────────────────────────────┘
```

| 模块 | 职责（唯一） | 明确禁止 | 文件 |
|---|---|---|---|
| `CardController` | 形态相位、互斥组、`openOrder`、持久化、世代号 | 读 rect、写 DOM、设 timer 改状态 | `src/lc/controller.js` |
| `LayoutEngine` | 由快照算盒子：锚点、目标尺寸、生长方向、收缩/平移、兄弟让位 | `getBoundingClientRect`、`getComputedStyle`、任何写 | `src/lc/layout.js` |
| `Renderer` | 把 `Map<id,Box>` 落到 DOM（一次）、相位属性、动画编排 | 决定盒子内容、读写 `.collapsed` | `src/lc/render.js` |
| `MorphAnimation` | 展开/收起的**唯一**几何动画：时长公式、easing/overshoot、连点取消、reduce 分支 | 读 rect 定锚点、改状态、与 CSS `transition` 并存（同一元素只许一条 WAAPI） | `src/lc/morph.js` |
| `DockOverlay` | dock 组展开面板的**唯一**形态与几何（居中于语音栏上方） | 自己决定谁展开（由 `CardController` 决定）、再开第二套 popover | `src/lc/dock-overlay.js` |
| `GpuCapability` | 请求 `powerPreference`、判定 renderer/software、输出 `tier` 与状态条 | 强制切 GPU、改 App 画面设置、假装高帧率 | `src/lc/gpu.js` |
| `CollapsePort` | 把「兄弟退回迷你」翻译成 App 的 `setPanelCollapsed(..., {persist:false,syncShare:false})`；订阅 App 写入 | 自己 `classList.add('collapsed')` | `src/lc/collapse-port.js` |
| `material.css` | token + 卡壳/控件材质；`data-lc-phase` 驱动的位移/尺寸 | `!important`、多代材质共存、卡内 `backdrop-filter` | `src/lc/material.css` |
| `GlassRenderer` | 边缘折射环（保留签名去重与 `postRender` 取纹） | 中心位移、暗底、每帧整屏重画 | `public/gev-edge-lens.js`（改造） |
| `Interaction` | press/move/up/cancel、键盘、wheel 归属 | 直接改状态（只能 `dispatch`） | `src/lc/interaction.js` |
| `TestHarness` | 真实指针矩阵、不变量、FPS | 使用 `__gevLc.open()` 之类的旁路 | `scripts/lc/*.mjs` |

### 3.3 目标文件树（Phase 1 完成后）

```
src/lc/
  index.js            # 组装：subscribe(app) → controller → layout → render
  controller.js       # 状态机 + reducer + mutex + persistence
  layout.js           # 纯函数（可 node --test 直测）
  render.js           # 单帧 DOM 应用 + WAAPI
  morph.js            # 几何动画：350–450ms 面积自适应 + overshoot 1.02–1.05
  dock-overlay.js     # dock 组唯一展开形态（居中于语音栏上方）
  gpu.js              # powerPreference + renderer 判定 + tier 降级/状态条
  collapse-port.js    # 唯一 .collapsed 写者（经 App API）
  interaction.js      # 指针/键盘/wheel
  app-adapter.js      # measure 快照、安全区、PROTECT_IDS、事件桥
  material.css        # token + 规则（≤300 行，0 个 !important）
  tokens.json         # 同一份 token 给 CSS 与检查器读
public/gev-edge-lens.js   # 保留，改造为签名去重 + 只画开着的卡
del: src/gev-liquid-cards.js        (3245 → 0)
del: public/gev-liquid-cards.css    (1011 → 0)
del: public/gev-gl-glass.js         (889 → 0, 已是死代码)
del: public/gev-lg-filter.js + gev-lg-dispmap.jpg（warp 停用后的死链）
```

### 3.4 一次点击的时序（目标）

```
pointerdown(header)
  → Interaction.record(card, x, y, t, pointerId)          # 不读布局
pointermove(<6px)
  → Interaction.move()
pointerup(<6px, 同 pointerId, 非拖拽/缩放)
  → controller.dispatch({type:'ACTIVATE', id, gen})
      ├─ 若同组已有 open：dispatch MUTEX{retire: old, open: id}（同一 tick，先退场后开场）
      ├─ state[id].phase = 'opening'；gen++
      └─ layoutDirty = true
  → rAF(once): snapshot = adapter.measure(); boxes = layout(snapshot); render.apply(boxes)
  → WAAPI 从 presentation 值起动画；onfinish 校验 gen 后 phase='open'
```

**关键点：`pointerup` 之后没有任何一条路径会再算布局**（除了用户拖拽/缩放/窗口 resize），也不存在「开卡后 1.8s 内每 90ms 归一」。App 若在之后重排，由 `CollapsePort.subscribe` + `ResizeObserver`（只看轨道容器）触发**一次** reconcile。

---

## 4. 单卡状态机

### 4.1 相位与 DOM 契约

| phase | `data-lc-phase` | 卡壳几何 | 内容滚动 | 可点热区 |
|---|---|---|---|---|
| `mini` | `mini` | 自然槽位（无 inline 几何） | **不可滚**（wheel 被吞，不滚内容） | 整卡 = header |
| `opening` | `opening` | 动画中（WAAPI，从 presentation 值） | 不可滚 | 仅 header |
| `open` | `open` | inline 盒 = `st.box` | 卡壳是唯一滚动容器 | header + 内容控件 |
| `closing` | `closing` | 动画中（反向） | 不可滚 | 仅 header（可再次点＝取消关闭） |

`data-lc-phase` 是**唯一**允许被 CSS 消费的形态信号；CSS 里不再出现 `.collapsed` / `.gev-lc-floating` 的双重判断。

### 4.2 转移表（每卡独立 `state[id]`）

| 当前 | 事件 | 守卫 | 下一 | 副作用 |
|---|---|---|---|---|
| `mini` | `ACTIVATE` | 组内无 open | `opening` | `gen++`、置锚点、脱层到 `#lc-stage`、`CollapsePort.retireSiblings(group)` |
| `mini` | `ACTIVATE` | 组内有 open（互斥组） | `opening` | **MUTEX 事务**：同 tick 内 `retire(old)` + `open(self)`；`openOrder` 后开在上 |
| `opening` | `ANIM_END(gen)` | `gen === cur` | `open` | 写定盒、`will-change:auto` |
| `opening` | `ACTIVATE` / `ESC` | — | `closing` | 从 presentation 值反向（不跳回 mini 再开） |
| `open` | `ACTIVATE` / `ESC` / 点外 | — | `closing` | 焦点回 header |
| `closing` | `ACTIVATE` | — | `opening` | **取消关闭**，从当前屏幕值重开（apple-design 原则 3） |
| `closing` | `ANIM_END(gen)` | `gen === cur` | `mini` | 回填槽位、清 inline 几何、移除占位、`CollapsePort.restore(id)` |
| 任意 | `RESIZE` / `PREEMPT` | — | 不变 | `layoutDirty=true`，只重算盒 |

### 4.3 取消与快速连点（世代号规则）

- 每个 `state[id]` 持 `gen`；任何动画回调先校验 `if (gen !== state.gen) return`。
- `ACTIVATE` 在 `opening`/`closing` 都**合法**（不是 `return`）→ 用户连点 5 次的结果 = 最后一次点击的意图，中间不出现半开。
- 连点判定：`ACTIVATE` 到来时若 `closing` 且 `性能时间-closeStart < 350ms` → `opening`（取消关闭）；否则正常重开。
- **禁止**：`if (st.closing) return;`（当前 `activateFloat` 第 1865 行就是这么写的 → 关闭动画期间点不动 = 用户说的「点了没反应」）。
- 收敛断言：任意连点序列结束后 600ms，`document.getAnimations().length === 0` 且每张卡 `phase ∈ {mini, open}`。

### 4.4 互斥组（与 App 的 `:has` 语义等价，但由控制器表达）

```
groups = [
  ['location-bar','control-panel','gev-voice-control'],   # dock 托盘 → DockOverlay 唯一渲染（§14）
  ['pp-toggles','cctv-panel','global-context-panel'],      # 右栏
  ['data-panel','scene-panel'],                            # 左栈
]
```
不变量：`∀g ∈ groups: count(g, phase==='open' || 'opening') ≤ 1`。**dock 组另有四条硬约束**（详见 §14.2）：① 展开面板只有一种 DOM 形态（`.dock-panel`），不存在第二套 popover/内层；② 面板水平中心与 `#command-dock` 中心差 ≤2px、底边 = `dock.top − 12`；③ 面板文字直接放玻璃上（`border/outline/inset` 全 0）；④ 面板高度由内容决定，不允许出现「空玻璃块」。
**兄弟退回一律走 `CollapsePort`（App API，`persist:false, syncShare:false`）**，因此 App 的 `layout-exclusive`、`aria-hidden`、右栏布局都以「App 自己的语义」收尾，不会出现 `display:none` 的隐形卡；`elementFromPoint` 必然命中兄弟自己的 header。

---

## 5. 布局引擎（纯函数）

### 5.1 输入 / 输出

```ts
type Snapshot = {
  viewport: {w:number, h:number, dpr:number},
  safe: {top:84, bottom:158, left:0, right:0},        // token: --lc-safe-*
  cards: Record<id, {rail:'left'|'right'|'dock', slot:number,
                     mini:{x,y,w,h}, header:{x,y,w,h}, stickyTop:number}>,
  protected: Rect[],                                  // PROTECT_IDS + logo + 顶栏 + 底栏
  phases: Record<id,'mini'|'opening'|'open'|'closing'>,
  targets: Record<id,{expW:number, expH:number, minH:number}>
}
type Box = {x,y,w,h, radius:number, z:number}
layout(s: Snapshot): Record<id, Box>   // 纯函数：同输入必同输出，可在 node --test 里跑
```

Snapshot 只由 `app-adapter.measure()` 产生，且只在 **measure 帧**（`layoutDirty` 且距上次 mutation ≥ 1 帧）执行一次批量读取（读一次，全部缓存），杜绝「事件回调里读几何」。

### 5.2 算法（确定性，无搜索环）

1. **锚点**：左栏 = `header.topleft`；右栏 = `header.topright`；dock = `header.bottomleft`。锚点取自 `mini`（自然槽位）而非当前 rect。
2. **目标尺寸**：`w0 = clamp(targets.expW, MIN_W=150, viewport.w - safe.l - safe.r - GAP)`；同理 `h0`。
3. **收缩优先（保锚点）**：
   - 与 `protected` 或其它 `open` 卡相交 → 沿**生长轴反向**收（dock 收高度、右栏收宽度），下限 `minH`（默认 `min(180, h0)`）。
   - 收到下限仍相交 → **沿非生长轴平移**（右栏向左、dock 向上、左栏向下），步长 = 相交深度，不解方程、不做级联环形搜索。
4. **兄弟让位（仅 translate）**：同轨 `mini` 卡若与任一 `open` 盒相交 → `push.y` 逐卡累加 `overlap + GAP`；**不动 left/top/size、不改顺序、不加 `.collapsed`**。展开卡收完后仍不够 → 展开卡再收缩一次（最多 2 轮，收敛条件明确）。
5. **不变量（Renderer 应用前断言，失败即回退上一帧盒并打点）**：
   - `∀ open,mini: box ⊆ viewport − safe`
   - `∀ a≠b: geometry ∩ = ∅`（`opening/closing` 期间豁免，但**落定后必须满足**）
   - `∀ id: elementFromPoint(header.center) === header 内部的元素`
   - `∀ dock 卡: header.bottom 不变（±1px）`

### 5.3 滚动职责表（唯一口径）

| 形态 | 谁滚 | wheel 去向 | 依据 |
|---|---|---|---|
| `mini` | **谁都不滚** | 吞掉，不滚内容、不穿透地图 | 修「mini 卡内滚动」 |
| `opening/closing` | 谁都不滚 | 吞掉 | 动画期滚动必然抖 |
| `open` | **卡壳**（`overflow-y:auto; overscroll-behavior:contain`） | 卡壳 `scrollTop +=`（超限后仍 `preventDefault`） | 修「滚动职责不清」 |
| `open` + 内层自有滚动（如 cctv 列表） | 内层（`data-lc-scroll`） | 内层到边界后不链式外溢 | 显式登记，不默认 |

header 在 `open` 时 `position:sticky; top:0`（`§19` 的 `sticky` 结论保留，但改成 `data-lc-phase="open"` 驱动）。

### 5.4 dock 组的几何（唯一口径 · 由 DockOverlay 消费）

- 三张 dock 卡（`#location-bar` / `#control-panel` / `#gev-voice-control`）的 **mini 态** = dock 行内自然槽位，横向排布，`header.bottom` 恒定（§5.2 不变量 4）；`snapshot.targets` 对它们只提供 `expW/expH` 供**面板**使用，mini 盒仍是槽位。
- **展开态不占 dock 行**：面板浮在 dock 之上，`x = dock.cx − w/2`、`bottom = dock.top − 12`（GAP），宽度 `w = clamp(320, min(dock.w, 560), viewport.w − 24)`，高度 `h = clamp(240, contentH, dock.top − SAFE_TOP − 12)`，超限时**面板自己**是滚动容器。
- 展开面板**不进** dock 的高度计算：dock 高度仍由 App 的 `dockHeight()`（`src/gev-panel-win.js:72`，60–140 夹取）决定。否则会形成「量到 → 写高 → 再量到」的反馈（该反馈在历史上被放大到 1.6e6 px，`:66-71` 注释有记录）。
- dock 面板的定位**不写 `transform`**（`gev-panel-win` 的拖拽/缩放写 inline `transform`，`§7.3` 已裁定同一属性只能有一个写者）：面板用 `left/top/width/height`，拖拽结果只进 slot 偏移。

---

## 6. 材质模型

### 6.1 Token（唯一来源，`src/lc/tokens.json` → CSS 变量）

| Token | 值 | 用途 |
|---|---|---|
| `--lc-radius` | `16px`（+ `corner-shape: squircle`，FAB 例外 `50%`） | 卡壳 |
| ~~`--lc-hairline`~~ | **已删除（v2）** | 卡壳 1px 内描边 —— **灰圈主源，禁止再引入**（§6.6） |
| `--lc-shell-fill` | `transparent` | **卡壳不许有底**（alpha ≤ 0.02 为硬阈值） |
| `--lc-shell-shadow` | `0 2px 10px rgba(0,0,0,.14)`（单层） | 唯一投影，禁多代叠加 |
| `--lc-refract-band` | `16px`（小卡按短边 20%、下限 7px） | 边缘环宽度 |
| `--lc-refract-ior` | `1.52` | 折射率（`gev-edge-lens.js` 现状值） |
| `--lc-control-fill` | `transparent` | 按钮/开关/chip |
| ~~`--lc-control-hairline`~~ | **已删除（v2）** | 控件 0.5px 发丝边 —— 同上，禁止再引入 |
| `--lc-soft-fill` | `rgba(8,12,18,.55)`（**仅** `prefers-reduced-transparency: reduce` 档） | 无描边前提下的可读性回退（填充替代描边） |
| `--lc-control-gloss` | `rgba(255,255,255,.10)` | 顶部 1px 高光（**不铺半块镜面**，glass-effects 铁律 7） |
| `--lc-text` | `#eaf4ff` + `text-shadow: 0 1px 2px rgba(0,0,0,.8)` | 透明底上的可读性 |
| `--lc-safe-top/bottom` | `84px / 158px` | 与 `SAFE_TOP/SAFE_BOTTOM` 同源 |

### 6.2 只允许 3 层绘制

```
① 卡壳          .gev-lc[data-lc-phase]  → 顶部 1px 高光 + 单层外投影（0 fill、0 blur、0 border、0 outline、0 inset）
② 边缘折射      #gev-edge-lens (canvas, z-index 4, 卡片之下) → 只在距边 <band 输出
③ 内容          App 原生 DOM → 零 fill、零 backdrop-filter、零 filter
```
`backdrop-filter` **在卡片层出现次数必须为 0**（含 `.gev-lg-warp`，直接删除该层，不是 `display:none`）。
**灰圈**同理：`inset` 描边、`border`、`outline` 在卡片层出现次数必须为 **0** —— 边界的存在感来自①的**顶部高光**（只画上沿，不闭合）和②的**透明折射**，不来自任何一圈线（不变量见 §6.5 / §6.6）。

### 6.3 为什么现在会「磨砂 / 黑底 / 白条」（正面回答，逐条到选择器）

**材质代数术语（全文统一，4 代）**：**G1** = §1 卡壳完全透明（初代，`gev-liquid-cards.css:21-49`）· **G2** = §12 Figma iOS 27 Liquid Glass（`--lgm-*`，`338-600`）· **G3** = §14 白 5% 玻璃（`rgba(255,255,255,.05)`，`613-644`）· **G4** = §17 零填充透明玻璃（当前口径，`681-763`）。四代**同时存在于同一张表**，谁生效取决于特异性与 `!important` 张数——这就是「磨砂/黑底/白条反复」的机制层解释。注意与 §6.2 的「3 层绘制」区分：**3 层**指绘制顺序（卡壳 / 边缘折射 / 内容），**4 代**指材质方案的历史层积。

| 现象 | 真实来源（选择器/变量） | 卡片层现在的处理 | 为什么反复 |
|---|---|---|---|
| 中心磨砂 | `controls.css:566-567 .pp-slider-row{background:var(--glass-bg); backdrop-filter:blur(16px)}`、`controls.css:382-393 #pp-toggles:not(.collapsed){blur(18px)}`、`gev-cn.css:125 #gev-lang-toggle{blur(20px)}`、`controls.css:419`、`cctv.css:40`、`cockpit.css:1291/1330` | `§13` 全平面 `backdrop-filter:none !important` | 名单靠人肉维护；新元素/新状态类（`:not(.collapsed)` 变成 `[data-lc-phase]`）即漏 |
| 黑底 | `--glass-bg = rgba(12,12,20,.72)` 消费于 `.pp-slider-row/.pp-select/.pp-toggle-btn`；`gev-layer-limits.js` 的 `input[type=number]{background:rgba(3,14,20,.85)}` | `§14`（G3）改白 5% → `§17`（G4）再改 0 | 同一文件里 G3/G4 两代规则**同时存在**，靠特异性高低决定胜负，无人能一眼预测 |
| 白条 / 灰块 | `§14` 的 `rgba(255,255,255,.05)` + `gev-cn.css` 的 `0 10px 40px rgba(0,0,0,.55)` | `§17` 只覆盖名单内的控件 | `§14` 名单 ⊃ `§17` 名单（`.pp-header-row`、`.scene-progress`、`.cctv-cal-value` 只在 §14 里）→ 这些永远是白条 |
| 暗色描边/假彩边 | 历史 `1px 虹彩描边` 已删（`ensureWarp` 里 `rim.remove()`，`gev-liquid-cards.js:300-304`） | 由 WebGL 环替代 | — |

### 6.4 无 `!important` 的特异性预算

App 侧最高：`#right-context-rail .lg-glass-skin` = **(1,1,0)**；`#command-dock > #gev-voice-control` = **(2,0,0)**。
卡片层统一用**单一锚点 + `:is()` 列表 + 一层类**：

```css
/* 每个规则组只允许这一种形状，全部 ≥ (1,2,0)，无 !important */
:is(#data-panel,#scene-panel,#pp-toggles,#cctv-panel,#global-context-panel,
    #location-bar,#control-panel,#gev-voice-control).gev-lc
  :is(.pp-slider-row,.pp-select,.pp-toggle-btn,…) { … }
```
- 对 `(2,0,0)` 的两处（`#command-dock > #gev-voice-control`）**不跟它比数字**，改为在 `tokens.json` 里登记「该元素属于 dock 托盘，由托盘统一上材质」，用 `#command-dock .dock-popover-content :is(...)` = (1,1,0) + 文件末尾顺序获胜，**不做双 ID 叠加**。
- 载入顺序：`material.css` 必须排在 `style.css` 与所有 `gev-*.css` 之后（`index.html` 最后一个 `<link>`），并在测试里断言 `document.styleSheets` 顺序。
- 硬性门槛（可自动化）：`material.css` 行数 ≤ 300、`!important` 计数 **=== 0**、`#a > #b` 双 ID 计数 **=== 0**。

### 6.5 不变量检查器（替代无限 deny-list）

```js
// scripts/lc/invariants.mjs — 对 7 张卡（含展开态）+ .dock-panel + 页面 chrome 逐元素枚举
for (const el of card.querySelectorAll('*')) {
  const cs = getComputedStyle(el);
  assert(cs.backdropFilter === 'none', el);                       // 无磨砂
  assert(alpha(cs.backgroundColor) <= 0.02, el);                  // 无底
  assert(cs.filter === 'none', el);                               // 无滤镜
  // —— 灰圈三条（v2）：任一非零即 FAIL，并打印元素路径 ——
  assert(['Top','Right','Bottom','Left'].every(s => px(cs[`border${s}Width`]) === 0), el);
  assert(px(cs.outlineWidth) === 0 && cs.outlineStyle !== 'dotted', el);
  assert(numberOfInsetShadowLayers(cs.boxShadow) === 0, el);      // 外投影 ≤1 层可留
  for (const pe of ['::before','::after']) {                      // 伪元素也算
    const pcs = getComputedStyle(el, pe);
    assert(px(pcs.borderTopWidth) === 0 && numberOfInsetShadowLayers(pcs.boxShadow) === 0, el + pe);
  }
}
```
新增元素只要犯上述任一条，**测试红**——这就是「不再靠名单」的机制。

### 6.6 灰圈 = 0（v2 硬不变量）

「灰圈」不是审美偏好，是**可断言的属性集合**。卡壳、控件、dock 托盘、页面 chrome 四类元素上，下列三条必须**同时为 0**：

| 属性 | 阈值 | 现存违反（实测） |
|---|---|---|
| `border-width`（四边 + 伪元素） | 全 `0px` | 卡层 `border` 相关行 **38 行**；App 侧 `controls.css` 22 行 / `lg-glass.css` 5 行 / `gev-cn.css` 3 行 / `gev-fix.css` 3 行 |
| `outline-width` | `0px`（focus 环改外投影，不用 `outline`） | 卡层 **1 行**（`gev-liquid-cards.css:587` 的 `.material-symbols-outlined` 选择器） |
| `box-shadow` 的 `inset` 层 | **0 层** | **22 处** `inset 0 0 0 {0.5\|1}px`：37 / 47 / 255 / 542 / 553 / 566 / 666 / 671 / 696 / 707 / 716 / 725 / 739 / 750 / 911 / 922 / 933 / 947 / 973 / 990 / 1004 / 1009 |

复算：
```bash
grep -c 'inset 0 0 0' public/gev-liquid-cards.css        # 22
grep -rn 'inset 0 0 0' --include=*.css src/ public/ | wc -l   # 36（全仓，卡层占 22）
grep -c 'border' public/gev-liquid-cards.css             # 38（含 border-radius/边框盒声明）
grep -c 'outline' public/gev-liquid-cards.css            # 1
```

灰度来源必须一分为三、各归各的处置：
1. **卡壳**（`.gev-lc`）：删 `inset` 描边，只留 `--lc-control-gloss` 顶部 1px 高光 + `--lc-shell-shadow` 单层外投影；
2. **控件/托盘**（`.pp-toggle-btn` / `.dock-popover-content` / toast / chip）：删发丝边，`active/hover` 只用「亮度/高光强度」表达，不画线；
3. **可访问性回退**（`prefers-reduced-transparency: reduce`，即 CSS `§8` ∪ `§16` 的选择器并集）：**不用描边**，改用 `background: var(--lc-soft-fill)`。这样灰圈不变量在所有 `@media` 分支下都成立（这是 v1 §8.1 对 `§16` 判「迁移」的**具体改法**：选择器并集不变，值从 `inset 0 0 0 1px rgba(255,255,255,.22)` 换成半透明填充）。

### 6.7 GPU tier 驱动的材质档（不做第二套材质）

| tier | `#gev-edge-lens` | morph（§15） | 目标 FPS | 用户可见提示 |
|---|---|---|---|---|
| `high` | 创建，签名去重、只画 open/可见卡 | 350–450ms + overshoot 1.02–1.05 | 60（下限 30） | 无（`#gev-gpu-chip` 常驻显示 renderer） |
| `software` | **不创建**（省一次全屏合成/读回） | 150ms、无回弹 | 30（下限 20） | `#gev-gpu-notice` 一次（9s 淡出）+ `#gev-gpu-chip` 标「未启用 GPU」 |
| `none`（无 WebGL） | 不创建 | 150ms、无回弹 | 不裁定 | 「未启用硬件加速」+ 关闭 3D 相关控件 |

**只有一个开关（tier）**，不允许出现「软件渲染专用材质表」——否则就是第 5 代材质，重复 §2 F2 的错误。

---

## 7. 冲突清单（逐项，含处置）

### 7.1 `.collapsed` 的写入者（6 类）

| # | 写入者 | 位置 | 触发 | 处置 |
|---|---|---|---|---|
| A1 | `panelChrome.setPanelCollapsed()` | `src/ui/panelChrome.js:386-568`（`classList.toggle` 在 `545`） | 所有披露按钮 / 程序调用 | **保留为唯一实现**，经 `CollapsePort` 调用 |
| A2 | 披露按钮 click | `src/ui/panelDisclosure.js:38-42`（`bindPanelDisclosure`） | 点 `+` / `−`、dock header | Phase 1 对 7 张卡关掉（`externalDisclosure` 开关） |
| A3 | hover 自动展开 | `src/ui/panelChrome.js:140-150` + `panelDisclosure.js:88-200`（`createHoverDisclosure`，dock 130ms/900ms，其余 850ms/1000ms） | 悬停 | 同上关掉（Hermes 现在用 `document` capture 的 `blockHover` 硬拦，`gev-liquid-cards.js:2874-2875`） |
| A4 | 轨道自适应折叠 | `src/ui/leftPanelRail.js:246`、`rightPanelRail.js:57`、`panelLayoutController.js:296,431` | 空间不足 / HUD 变体 / cockpit | 保留（App 职责），但**必须回流**：`CollapsePort.subscribe` → `dispatch({type:'APP_COLLAPSED'})` 让控制器知情 |
| A5 | 位置/状态控制 | `src/ui/panelPositionControls.js:124`（`classList.toggle('collapsed', collapsed)`），持久化键 `godsEyeView.<ver>.panelCollapsed.<id>`（`97-99`） | 启动恢复 | 同上，经 subscribe 回流；Hermes 的 `gev-liquid-cards:v2` **只存几何，不存形态** |
| A6 | 业务模块直接开面板 | `cctvPresentation.js:44`、`contextBindings.js:46,75`、`radioBindings.js:353,387,404,407,518,808`、`radioPresentation.js:364`、`firstRunExperience.js:464`、`panelChrome.js:470,520,529,538,591,605` | 选图层/ CCTV / 电台 / 首次引导 / cockpit 进出 | 保留；同样回流。**注意**：这些是「用户点图层 → 面板该开」的真实需求，不能被 Hermes 的 mutex 压掉 → 控制器的 `APP_COLLAPSED=false` 必须**反向驱动**成 `opening`（否则就是用户报的「点了图层卡没展开」） |

### 7.2 Hermes 侧的监听与自纠（全部要删/换）

| 位置 | 现在做什么 | 处置 |
|---|---|---|
| `334-341` | MutationObserver：`floating + collapsed` → 强行 `remove('collapsed')` | 删（相位由 controller 决定） |
| `406-428` / `2904-2905` | press 记候选 / `document` capture 结算 | 换成 `interaction.js` 单一状态机 |
| `430-460` | click capture「灭口」（`stopImmediatePropagation`） | 保留**形态**（App 的 click 不得改状态），但改为 Port 拒绝 + `preventDefault`，不做三层 `stopPropagation` |
| `462-483` | keydown Enter/Space/Esc 抢占 | 并入 `interaction.js` |
| `484-505` | wheel 仅浮层态生效 | 换成滚动职责表（§5.3） |
| `507-517` | 头部拖拽 | 保留，改由 `interaction.js` 出 `DRAG` 事件 |
| `2266-2267` / `2379-2380` | 拖拽/缩放的 `window` pointermove/up | 并入同一状态机 |
| `2874-2875` | `pointerenter/leave` capture 拦 hover 展开 | 删（改 A3 开关） |
| `2945` | document Esc → `closeTopFloat` | 并入 `interaction.js` |
| `2990-3004` | `watchAutoExpand`（同帧压回 `.collapsed`） | 删 |
| `3045-3064` | `startNormalizeWatch`（600ms × 30，18s 后自停）；紧随其后的 `primeInitialState` 3065–3102 见 §8.2 | 删 |
| `2834-2886` | `healExclusive`（含内部 const `blockHover` 的 pointerenter/leave 拦截，visibilitychange/focus 自纠） | 删（不变量保证，不用自纠） |
| `847-883` | `watchLayoutDrift`（含 `refreshNatsSoon` 876–883）：ResizeObserver + `setInterval` 刷自然槽位 | 改为「只观察 3 个轨道容器的 ResizeObserver」→ `layoutDirty` |
| `973-1330` / `1388-1530` / `1573-1656` / `1657-1767` | `planGroupPush` / `normalizeRail(Tick)` / `clearLateOverlaps` / `reflow` | 由 `layout.js` 一次算完替代 |
| `908-950` | `setPush/clearPush`（写内联 transform） | 由 `render.js` 统一写 |

### 7.3 CSS 冲突面（谁在压谁）

| 来源 | 形态 | 与卡片层的关系 | 处置 |
|---|---|---|---|
| `public/gev-liquid-cards.css` | 1011 行 / 284 `!important` / **4 代材质（G1 §1 · G2 §12 · G3 §14 · G4 §17）** | 自己跟自己打架 | **整文件删除**，换 `src/lc/material.css` |
| `public/gev-cn.css:125,212,238` | `backdrop-filter: blur(18/20px)`（ID 上下文） | 卡内磨砂主源 | 由 §6.5 不变量兜住；不追着改 App 文件 |
| `public/gev-fix.css` | ID 级黑字 / 深底 | 透明底上读不清 | 同上（卡片层用 `--lc-text` + 文本投影；不覆盖 App 文字色，改由不变量报告） |
| `public/gev-panel-win.css` + `src/gev-panel-win.js` | 轨道/托盘拖拽缩放写 inline `transform` | 与 `normalizeRail` 的 translate 抢同一个属性 | 二者**只能有一个**写 transform：拖拽结果进 controller 的 `slot` 偏移，`render` 统一输出 |
| `src/ui/styles/layers.css:253-262` | `#right-context-rail.layout-exclusive > [data-panel-id].collapsed{display:none}` | 互斥 = 隐形卡 | 由 §4.4 保证「不靠 `.collapsed` 做互斥」，该规则自然不触发 |
| `src/ui/styles/*.css` + `public/*.css` | **134 处 `backdrop-filter` / 133 行**（口径：`grep -ro 'backdrop-filter'` 出现数；其中 **59 处**同时写了 `-webkit-` 前缀）= `src/ui/styles/` **90 处 / 89 行 / 19 个文件**（`-webkit-` 43）+ `public/` **44 处 / 44 行 / 2 个文件**（`-webkit-` 16 = `gev-liquid-cards.css` 38、`gev-cn.css` 6）；另有 `--glass-bg = rgba(12,12,20,.72)`（`controls.css`） | 卡内材质：App 侧这 90 处是卡片层要清剿的对象；`gev-liquid-cards.css` 自己的 38 处是清剿规则本身（§13） | 不逐个改 App 文件；靠 §6.5 不变量 + 一次性「卡内平面清零」（S6） |

> **`backdrop-filter` 全量清单（可复现）**：`src/ui/styles/` 按出现数 = controls 14 / lg-glass 14 / command-dock-sliding 8 / status 8 / cockpit 6 / layers 6 / foundation 5 / command-dock 4 / cyber 4 / provider-settings 4 / cctv 2 / command-dock-trays 2 / first-run 2 / location 2 / mobile-portrait 2 / recent-imagery 2 / scenes 2 / weather 2 / bhote-koshi 1（合计 **90**，19 个文件）+ `public/gev-liquid-cards.css` 38 / `public/gev-cn.css` 6（合计 **44**）= **134**。其中与卡片/托盘**直接相关**的是 controls 14 + lg-glass 14 + command-dock 三表 8+4+2 + cctv 2 + cockpit 6 + gev-cn 6 = **56 处**；其余（status / weather / first-run / location / scenes …）与卡片无关，S6 **不得**顺手改。
> 复现（全部实测通过）：
> ```bash
> grep -ro  'backdrop-filter' src/ui/styles/ | wc -l            # 90   （属性出现数）
> grep -r   'backdrop-filter' src/ui/styles/ | wc -l            # 89   （含该属性的行数）
> grep -rl  'backdrop-filter' src/ui/styles/ | wc -l            # 19   （文件数）
> grep -ro  -- '-webkit-backdrop-filter' src/ui/styles/ | wc -l  # 43
> grep -ro  'backdrop-filter' public/*.css | wc -l              # 44   （gev-liquid-cards 38 + gev-cn 6）
> grep -ro  -- '-webkit-backdrop-filter' public/*.css | wc -l    # 16
> ```

### 7.4 重复注入（要清的 DOM/资源）

| 注入 | 位置 | 现状 | 处置 |
|---|---|---|---|
| `.gev-lg-warp` × 9 | `ensureWarp()` `288-310` | `display:none`（CSS §2） | 删注入 + 删 CSS（不是留 `display:none`） |
| `.gev-lg-rim` | 同上 | 已 `remove()` | 删相关代码路径 |
| `.gev-lc-edge` × 8/卡 = 72 个热区 div | `353-358` | 为了无把手缩放 | 收敛为 1 层 `resize-frame`（8 个假元素 → 1 个伪元素 + 命中判定） |
| `.gev-lc-ghost` | `307-309` | 拖拽幽灵 | 保留 1 个（全局），`display:none` 时移出合成树 |
| `#gev-edge-lens` | `gev-edge-lens.js` | 每卡 quad，签名去重（t_834a621c 已修） | 保留；增加「只画 `phase==='open'` 或 header 可见」 |
| `gev-lg-filter.js` + `.gev-lg-dispmap.jpg` | `index.html:64` | `lensSvg()` 对照开关才用（≈8fps） | 移出默认加载（改为按需 `import()`），默认不发请求 |
| `gev-gl-glass.js` | `index.html:69`（注释） | 死代码 889 行 | 删文件 |
| `scrubXGlyphs()` | `2386-2395` | 只对 `.cesium-credit-lightbox-close` 把 `×/✕` 换成「关闭」，每 2 s 一次（`setInterval` 2395） | 保留**原样**（无 ✕ 是硬需求，且它本来就没扫全页；不属于卡片层改动范围） |

### 7.5 灰圈/描边冲突清单（v2）

| 来源 | 形态 | 为什么看起来是「灰圈」 | 处置 |
|---|---|---|---|
| `public/gev-liquid-cards.css` 22 处 `inset 0 0 0` | 半透明白 0.5–1px **内**描边 | 在深色地图上等效「一圈灰线」；与 App 的 `border` 叠加成 2 层 | **删**（不迁移），边界只留顶部高光 + 折射（§6.6） |
| `§12` G2 的 `--lgm-chip-stroke` / `.lgm-*` 描边（`:542,553,566`） | 品牌色发丝边（0.42–0.44 alpha） | 有色描边比白色更像「脏边」 | 随 G2 整代**删** |
| `§14` G3 白 5% 的 `border` 盒 | 边框盒 + 白底 | 白底 + 边线 = 实体小卡 | 随 G3 删 |
| App `controls.css` / `lg-glass.css` 的 `border` | 面板/按钮自带 1px 边 | Hermes 清了一层、App 又画一层 | 由 §6.5 不变量兜住（卡内平面清零），**不逐个改 App 文件** |
| `outline`（卡层 1 行 + App focus 环） | 聚焦时出现一圈 | 键盘聚焦时最明显 | 卡层删；App 侧不覆盖，改为 `:focus-visible` 用 `box-shadow` 外投影（**不带 inset**） |
| `.gev-lg-rim`（边缘灰 rim） | 已 `remove()`（`gev-liquid-cards.js:300-304`） | 历史遗留 | 删相关代码路径（§7.4 已列） |

### 7.6 GPU 冲突清单（v2）

| 位置 | 现状 | 风险 | 处置 |
|---|---|---|---|
| `src/app/viewer.js:178-182` | Cesium `contextOptions.webgl.powerPreference = gfx.gpuPref` | 桌面默认已是 `high-performance`（`gev-graphics.js:56`），但 iOS 默认 `'default'`（`:46`） | **保留**，不改默认；只在 probe 判定软件渲染时降级 |
| `public/gev-edge-lens.js:282-284` | 已 `powerPreference:'high-performance'` | 无 | 保留；software tier 下**不创建**该 canvas |
| `src/cockpitCloudEffects.js:278-291` | 私有 `webgl` 上下文，自读 `gev.gfx` | 与主画布可能**不是同一块 GPU**（跨 GPU 合成反而更慢） | 改读 `gpu.tier()`；software tier 下停用云层特效 |
| `src/gev-graphics.js:257` | 探测画布 `getContext('webgl2')`（**无 options**） | 探测结果可能来自另一块 GPU → 提示与实际不符 | 传 `{powerPreference:'high-performance'}` + 用完 `WEBGL_lose_context.loseContext()` |
| `src/app/atmosphereCompat.js:135` | 同上无 options | 同上 | 同上 |
| `public/gev-gl-glass.js:150-195` | 完整 `gpuInfo()` + `SOFT_RE` + `showSoftNotice()`，但**文件未加载**（死代码） | 唯一正确实现躺在死文件里 | **移植**到 `src/lc/gpu.js`，然后删死文件（§8.3） |
| `src/gev-perf.js:129-141` | 只有 FPS 徽标 `#gev-perf-fps` | 用户看不到「用的是不是 GPU」 | 增加 `#gev-gpu-chip`（同一 wrap，`data-gpu-tier` 供断言） |

---

---

## 8. 删除清单（CSS 节级 / JS 函数级 / 文件级）

### 8.1 `public/gev-liquid-cards.css` 逐节裁决

| 节 | 行（实测分节头切段） | 内容与 `!important` 数 | 裁决 | 去向 |
|---|---|---|---|---|
| §0 滚动条 | 15–20（6 行） | 全局滚动条隐藏，**4** | **删**（全局副作用） | `material.css` 内 `.gev-lc[data-lc-phase="open"]` 作用域 |
| §1 卡壳透明 | 21–49（29 行） | **G1** 初代：卡壳完全透明，**11** | **迁** | token + `(1,2,0)` 规则 |
| §2 warp 磨砂 | 50–80（31 行） | `display:none` 历史层，**5** | **删** | 层都不存在 |
| §2b 内层清零 | 81–126（46 行） | 内层底板/blur 清零，**8** | **迁** 为不变量 | `scripts/lc/invariants.mjs` |
| §3 折叠按钮 | 127–132（6 行） | 隐藏 `+`/`−`，**2** | **删** | 按钮本就不该出现 |
| §4 缩放热区 | 133–148（16 行） | 8 个透明热区，**0** | **迁** | `render.js` 单层命中 |
| §5 浮层 | 149–184（36 行） | 浮层几何，**14** | **删** | 几何由 `layout.js` 写 inline |
| §5b ✕ 移除 | 185–218（34 行） | `.gev-lc-close{display:none}`，**9** | **删** | JS 不再注入即无需兜底 |
| §6 占位/幽灵 | 219–229（11 行） | `.gev-lc-placeholder` / ghost，**1** | **迁** | `render.js` |
| §7 卡内结构 | 230–246（17 行） | 与玻璃无关的历史修正，**8** | **迁**（逐条复核） | `material.css` |
| §8 reduced-transparency | 247–263（17 行） | **6** | **迁** | token 的 `@media` 变体（1 处） |
| §9 动效降载 | 264–271（8 行，含 269–271 QA 钩子） | **1** | **迁** | `material.css` |
| §10 squircle | 272–326（55 行） | `corner-shape`，**1** | **迁** | token `--lc-radius` |
| §11 收窄自保 | 327–337（11 行） | 展开卡横向让位时内容自保，**1** | **删** | 布局引擎不该靠 CSS 自保（内容由 `open` 滚动） |
| §12 Figma 材质 | 338–600（263 行，含 12a–12e） | **G2**：`--lgm-*`，**43**（12a 9 / 12b 4 / 12c 7 / 12d 16 / 12e 7） | **删** | 与 G1/G3/G4 并存，留一套 token |
| §13 禁 blur | 601–612（12 行） | 全平面 `backdrop-filter:none`，**3** | **迁** 为不变量 + 1 条平面规则 | `material.css` + `invariants.mjs` |
| §14 白 5% | 613–644（32 行） | **G3**：`rgba(255,255,255,.05)`，**10** | **删** | token `--lc-control-fill: transparent` |
| §15 不压缩 | 645–655（11 行） | `flex-shrink:0`，**1** | **删** | `open` 相位的滚动模型替代 |
| §16 dock 注释 + reduce 回退 | 656–680（25 行） | 656–657 只是注释（dock 高度由 JS 的 `dockHeight()` 算，确实无规则主体），但 **659–679 是一个完整的 `@media (prefers-reduced-transparency: reduce)` 块，含 9 个 `!important`**（664/665/666 卡壳 · 669/670/671 托盘 `.dock-popover-content` · 675/676/677 控件），选择器 = `.gev-lc` + `[data-gev-glass-lum="bright"]` + `[data-gev-mat="light"]` + `#command-dock > #gev-voice-control` + `.dock-popover-content` + **16 个控件名**（`:is()` 内 11 个：`.pp-toggle-btn` / `.data-toggle-btn` / `.style-btn` / `.pp-mode-btn` / `.context-mode-button` / `.map-stack-chip` / `.search-toggle-btn` / `.lg-glass-skin` / `#gev-voice-button` / `.gev-voice-tier-btn` / `#control-panel-toggle`，另 5 个 ID：`#gev-locate-btn` / `#gev-perf-fps` / `#gev-lang-toggle` / `#key-setup-chip` / `#gev-perf-btn`）；合计 **9** | **迁**（上一轮判「删」是错的） | 它是 §8（247–263：仅 `.gev-lc`×2 + `.gev-lg-warp`）的**严格超集**，也是 dock 托盘与本批控件在 `reduce` 下唯一的回退，删 = `prefers-reduced-transparency` 下重新变透明无描边 = a11y 回归；去向：并入 §8 的 `@media` 变体（选择器 = §8 ∪ §16，token 的 reduced-transparency 层只留 1 处） |
| §17 零填充 | 681–763（83 行） | **G4**（当前口径），**28** | **迁** 为 token | `material.css` |
| §18 文字浅色 | 764–788（25 行） | 文字/滑杆，**10** | **迁** | `--lc-text` |
| §19 pp 展开 | 789–869（81 行） | **单节最大**：pp 专用布局，**55** | **迁** 3 条（滚动/sticky/gap），其余删 | `material.css` |
| §20 ✕ 全消 | 870–893（24 行） | `panel-collapse-btn` 隐藏等，**11** | **迁**（保留语义） | `material.css` + JS |
| §21 页面 chrome | 894–953（60 行） | toast/chip/sync 透明，**23** | **迁** | `material.css`（≤10 条） |
| §22 状态型 chrome | 954–1011（58 行） | toast / 3 个 sync chip，**20** | **迁** | `material.css`（≤10 条） |

> **口径注（可复现）**：分节头必须**按字符**匹配（`grep -P` + UTF-8 locale）。**不带 `-P` 的 `grep -n '^/\* [─═]'` 会把 `[─═]` 当字节类**，于是 `/* —— 12a)`～`12e)`（U+2014 破折号）和另外两行 `/* —— …` 一起被算进来，输出 **34 行** —— 那个 34 不是分节头数，上一轮的口径注就错在这里。
> 正确复现命令（四条，结果必须一致）：
> ```bash
> LC_ALL=C.UTF-8 grep -nP '^/\* [\x{2500}\x{2550}]' public/gev-liquid-cards.css | wc -l                  # 27
> LC_ALL=C.UTF-8 grep -cP '^/\* [\x{2500}\x{2550}]+\s*[0-9]+[ab]?\)' public/gev-liquid-cards.css          # 25 = 上表 25 行
> grep -c '!important' public/gev-liquid-cards.css                                                     # 284（全文件）
> sed -n '327,337p' public/gev-liquid-cards.css | grep -c '!important'                                 # 1（§11 自身）
> ```
> 27 = 上表 **25 个编号节** + **2 个未编号注释块**：`269`（QA 钩子 `html.gev-nofilter`）在 §9 的 264–271 区间内、`322`（「亮底档补强：已删除」）在 §10 的 272–326 区间内，都不单独占行；`12a`–`12e` 用 `——` 是 §12（338–600）的子段，含在 §12 的 43 个 `!important` 里（9/4/7/16/7）。按这 25 段统计段内 `!important`，逐段累加 = **284** = 全文件 `grep -c`，所以上表**可以当删除图直接用**，任一行区间都不会切到邻节。
> `§11` 自身只有 327–337（11 行）/ **1** 个 `!important`；**214 是 §11–§22 的合计**，不是某一节。
> 结论：**1011 行 → 约 265 行，284 个 `!important` → 0，4 代材质（G1 §1 · G2 §12 · G3 §14 · G4 §17）→ 1 套 token**；其中 §16 的 reduce 块不是「删」而是并入 §8 的同名 `@media`（合并后共 1 个变体，覆盖 §8 ∪ §16 的选择器并集）。
> **v2 追加（灰圈）**：删除图不变（区间与计数全部复算通过，逐段累加 = 284，见 §1.1），但 **§1/§12/§14/§17/§18/§21/§22 里所有 `inset 0 0 0 {0.5|1}px` 描边一律「删除」而不是「迁移」**（共 22 处，行号见 §2 F7）——迁到 `material.css` 的只有值不变量与高光/投影 token，`material.css` 的 `inset 描边计数必须 === 0`。§16 的 reduce 块保留其「选择器并集 + 可读性回退」的**作用**，但回退值从「1px 内描边」改为 `background: var(--lc-soft-fill)`（§6.6 处置 3）。

### 8.2 `src/gev-liquid-cards.js` 函数级裁决（3245 行）

| 函数/块 | 行 | 裁决 |
|---|---|---|
| `SPRING` / `springProgress` / `springKf` / `runMorph` | 14–278 | **迁** `render.js`（保留 350ms 弹簧语义，改由 WAAPI 一条曲线） |
| `ensureWarp` | 288–310 | **删** |
| `initCard` | 311–520 | **拆**：热区→`interaction`，持久化→`controller`，几何→`layout` |
| `const RAIL` / `SAFE_TOP` / `SAFE_BOTTOM` / `GAP` / `PROTECT_IDS` | 525–545 | **迁** `layout.js`（RAIL / GAP / SAFE_TOP / SAFE_BOTTOM）与 `app-adapter`（PROTECT_IDS）；v1 漏列，v2 补 |
| `isVisibleEl` / `rectOf` / `obstacleRects` | 547–620 | **迁** `app-adapter.measure()` |
| `placeExpanded`（700+ 行） | 622–800 | **删**，被 `layout.js`（≈120 行纯函数）替代 |
| `rememberNat` / `refreshNats` / `watchLayoutDrift` / `refreshNatsSoon` / `readTranslate` / `natRect` | 808–918 | **迁** measure（读一次缓存）；`watchLayoutDrift` 单独换成 ResizeObserver×3 |
| `setPush` / `clearPush` / `miniBox` | 919–972 | **迁** `render.js` |
| `planGroupPush`（≈350 行） | 973–1323 | **删** |
| `applyGroupPush` / `clearAllPushes` | 1324–1341 | **迁** `render.js`（一次写） |
| `const RAIL_LISTS` / `RAIL_INDEX` | 1356–1368 | **删**（随 `normalizeRail` 一起消失；v1 误并进 1324–1359，v2 拆出） |
| `normalizeRail` / `railNormalizeTick` / `normalizeRailsSoon` | 1388–1530 | **删** |
| `applyBox` | 1541–1572 | **迁** `render.js` |
| `clearLateOverlaps` | 1573–1656 | **删** |
| `reflow` / `reflowSoon` / `currentRect` / `otherRects` / `resolvePos` | 1657–1846 | **删** |
| `toggleFloat` / `focusCardHeader` | 1847–1863 | **迁** controller/render |
| `activateFloat` | 1864–1898 | **重写**（`if (st.closing) return` 必须去掉） |
| `retireInstant` | 1899–1937 | **迁** controller（改为经 CollapsePort） |
| `floatOpen` | 1938–2108 | **重写**（占位/脱层/resize 交给 render） |
| `floatClose` | 2109–2212 | **重写** |
| `startDrag` / `startResize` | 2213–2385 | **迁** `interaction.js` |
| `scrubXGlyphs` | 2386–2395 | **保留原样**（只处理 Cesium credit 容器，与卡片层无关） |
| `boot` / `initTheme` / `startLumProbe` | 2396–2533 | **拆**（主题探针保留，boot 简化） |
| `applyTopChipStyle` / `injectResetIntoGfx` / `moveRailsUp` / `healFloatingParents` / `settleGuard` / `applyUiFixes` | 2534–2833 | **迁** `material.css` / 单点清理；其中 `settleGuard`（2658–2791）**删**——调用点只有 `activateFloat:1895/1896` 与 `startNormalizeWatch:3057`，两处都随本次重写/删除消失 |
| `healExclusive`（含内部 const `blockHover`）/ `resolvePress` / `closeTopFloat` / `forceMiniAll` / `watchAutoExpand` / `natSig` / `railHostOk` / `openDefaultCard` / `startNormalizeWatch` | 2834–3064 | **删/换**：`healExclusive` / `watchAutoExpand` / `startNormalizeWatch` 删；`resolvePress` 并入 `interaction`；`openDefaultCard` 归 §11.1 D1（初始全 mini） |
| `primeInitialState` | 3065–3102 | **重写**（现在是 3 个 `setTimeout` + 60×250 ms 轮询兜底 15 s；改由 controller 一次定初始态） |
| `window.__gevLc`（30+ 调试钩子） | 3105–3245 | **删旁路**，保留 `__lc.state()` / `__lc.assert()` 两个**只读**钩子 |

> **口径注（可复现 · v2 修正）**：每行的行区间 = 块首行（`function` 定义行，或 `const` 块的首行）→ **该块最后一个非空行（块尾）**；相邻块之间不重叠。上一轮写的「→ 下一个 `function` 的前一行」与表里的值（块尾）不符，v1 复核时已按块尾改正表格、但口径注未同步，本版同步（例：`SPRING…runMorph` 14–278、`initCard` 311–520、`applyGroupPush/clearAllPushes` **1324–1341**、`primeInitialState` 3065–3102）。全文件按 `grep -n '^  function ' src/gev-liquid-cards.js` 得 **67 个定义**（文件 3246 行、末行为空即 3245 行有效），定义行分别是 `2386 scrubXGlyphs` / `2396 boot` / `2430 initTheme` / `2495 startLumProbe` / `2534 applyTopChipStyle` / `2568 injectResetIntoGfx` / `2592 moveRailsUp` / `2615 healFloatingParents` / `2658 settleGuard` / `2792 applyUiFixes` / `2834 healExclusive` / `2887 resolvePress` / `2914 closeTopFloat` / `2977 forceMiniAll` / `2990 watchAutoExpand` / `3005 natSig` / `3023 railHostOk` / `3032 openDefaultCard` / `3045 startNormalizeWatch` / `3065 primeInitialState` / `3105 window.__gevLc`。相邻行区间**不重叠**（上一轮的 `2457–2394` 首尾颠倒、且与 `2396–2560`、`2826–3070` 互压，会切进别的函数，已按定义重算）。`blockHover` 是 `healExclusive` 内部的 const（2869），不单独占行，因此并进 2834–2886 一行而不是自成行。

### 8.3 文件级

- 删：`public/gev-gl-glass.js`（889 行，未加载）、`public/gev-lg-dispmap.jpg` + 默认加载的 `gev-lg-filter.js`（改为按需）。
- 换：`public/gev-liquid-cards.css` → `src/lc/material.css`。
- 换：`src/gev-liquid-cards.js` → `src/lc/*.js`。
- 归档（不删）：`scripts/` 下 172 个 `qa-*` 与 164 个 `_*` 前缀脚本（其中 `_diag*`/`_probe*`/`_tmp*` 三类 31 个）→ `scripts/_archive/`，只保留 `scripts/lc/`。

---

## 9. 测试设计（Ego Lite 真实指针矩阵）

### 9.1 Harness 结构（替代 172 个散装脚本）

```
scripts/lc/
  harness.mjs     # puppeteer → 真实 CDP mouse（page.mouse.click 产生 isTrusted=true），
                  # 记录 window.__ptr（type/trusted/x/y/target/时间戳）供断言
  matrix.mjs      # 16 条用例（下表，v2 新增 T14–T16），逐条产出 PASS/FAIL + 证据 JSON/PNG
  invariants.mjs  # 不变量枚举（几何/材质/可点性/无 ✕）
  fps.mjs         # 帧率采样（空闲 + 交互期），与基线比
```
硬性要求：**只能用真实指针**。断言 `window.__ptr.every(e => e.trusted) === true`；任何用例里出现 `__gevLc.open()`/`element.click()` 一律判 FAIL。

### 9.2 用例矩阵（每条都可判定）

| # | 用例 | 操作 | 断言（全部必须成立） |
|---|---|---|---|
| T1 | 冷启动全 mini | 清 `localStorage` → 载入 → 等 3s | 7 卡 `phase==='mini'`、`floating===0`、无 inline 几何、`header` 的 `elementFromPoint` 命中自身、0 半开帧（连续 30 帧采样 `offsetHeight` 恒定） |
| T2 | 单卡展开 | 真实点 `#data-panel .panel-header` 中心 | `phase==='open'` 且 `rect` = 配置尺寸、header 顶边位移 ≤1px、与任何可见卡重叠 = 0、`__ptr` 全 `trusted` |
| T3 | 7 卡逐一展开/收起 | 依次点 7 张，每张点两次（开→关） | 每次开：overlap 0、在视口内；每次关：`rect` 与基线**逐像素相同**、`placeholder===0`、inline style 为空 |
| T4 | 左右轨道切换 | 左栏 data→scene、右栏 pp→cctv→context、dock location→control | 组内 `open` 数恒 ≤1；被退场卡回 mini 且 `rect===基线`；退场卡的 header 仍 `elementFromPoint` 命中自身（**不隐形**） |
| T5 | 跨组并存 | 左 1 + 右 1 + dock 1 同时开 | 三者 overlap 0；不覆盖 `SAFE_TOP/S`；不覆盖 `PROTECT_IDS`（`gev-gfx-fab/style-indicator/...`） |
| T6 | 快速连点（同卡 ×5，60ms 间隔） | `page.mouse.click` ×5 | 终态 = 最后一次点击意图；`getAnimations().length===0`；无 `phase` 卡在 `opening/closing` |
| T7 | 快速切换 A→B→A（100ms） | 3 次点击 | 终态 A open / B mini；无隐形卡（`display:none` 计数 0）；`aria-hidden` 计数 0 |
| T8 | pp 展开滚动 | 打开 `#pp-toggles` → wheel 5×200px | `scrollTop` 单调增加；header 仍在视口内（sticky）；滚到底后不越界、不外溢到地图（地图 zoom 不变） |
| T9 | mini 滚动禁用 | mini 态 wheel ×3 | 卡内 `scrollTop === 0` 恒不变；外层地图 zoom 亦不变（被吞掉，不是穿透） |
| T10 | 收起归位 | 全关 → 等 600ms | 7 卡 `rect` 与 T1 基线逐字相同；`placeholder/ghost/floating` 计数 0 |
| T11 | 无 ✕ | 任意态扫描 | 卡内 `.gev-lc-close` / `[aria-label*="Close"]` / 文本 `✕` 计数 **=== 0**；页面其它圆形 ✕（Cesium credit 除外）0 |
| T12 | 透明 + **灰圈=0** | 开 1 张；再把 7 张逐一开一遍（每张开态都跑一次枚举） | ① `backdropFilter==='none'`；② 背景 alpha ≤0.02；③ **`border-{top,right,bottom,left}-width` 四边 === 0px**；④ **`outline-width` === 0px**；⑤ **`box-shadow` 的 `inset` 层数 === 0**（外投影 ≤1 层）；⑥ 伪元素 `::before/::after` 的 border/inset 同样 === 0；⑦ `filter==='none'`；⑧ **中心像素与条纹底比值 ≥0.95**（A/B：`?testBg`）；⑨ **4x 角部/边缘截图无灰色闭合圈**（附 PNG 作人工证据）。任一元素违反 = FAIL，报告必须点名元素选择器路径 |
| T13 | FPS（用户口径） | **默认视口 1536×730**；空闲 1.5s×3 + 交互 1s；`high` 与 `software` 两轮各跑一次 | **空闲 ≥30fps**、**交互期 p90 帧间隔 ≤33ms**（= ≥30fps 等效）；`tier==='high'` 时**目标 60fps（记录，不门禁）**；`tier==='software'` 时下限 **≥20fps** 且必须出现 `#gev-gpu-notice`；**报告里 FPS 与 GPU 状态分两栏写**（renderer / requested / granted / tier）；`__gevEdge.stats().skip` 单调增长（去重生效）。**不再引用 50.5fps / 40fps 基线**（§11.1 D2） |
| T14 | GPU 判定与降级 | 两轮冷启动：正常轮；软件轮（`--disable-gpu` 或 `--use-gl=swiftshader`） | 正常轮：`__lc.gpu().tier==='high'`、`renderer` 不含 `SwiftShader\|llvmpipe\|Software`、`requested==='high-performance'`、静态扫描「所有活代码 `getContext('webgl*)` 调用都带 `powerPreference`」（0 例外）、`#gev-gpu-chip[data-gpu-tier]` 存在且文案含 renderer 简写。软件轮：`tier==='software'`、`#gev-gpu-notice` 出现且 `role="status"`、`#gev-edge-lens` **不存在**、该轮 morph 时长 =150ms、T13 按 software 下限判 |
| T15 | DockOverlay 单展开 + 居中 | 真实鼠标依次点 位置 → 语音 → 视觉预设（间隔 400ms）；再快速 A→B→A（100ms）；最后连点语音栏 ×5 | 每步 `count(dock 组 phase∈{opening,open}) === 1`；被点开的 `.dock-panel` **水平中心与 `#command-dock` 中心差 ≤2px**、底边 = `dock.top − 12`（±1px）；`document.querySelectorAll('.dock-panel').length === 1`；`.dock-popover-content` 计数 **=== 0**；面板内所有可见文字 `scrollWidth ≤ clientWidth + 1`（无截字）；面板与面板内控件 `border/outline/inset === 0`；无空玻璃块（面板内容高度 ≥ 首/末控件外框） |
| T16 | 果冻动画 | 7 张卡各开/关 1 次；同一卡连点 ×5（60ms）；再以 `prefers-reduced-motion: reduce` 模拟跑一轮 | 该卡的 `document.getAnimations()` 数**恒 ≤1**；`duration ∈ [350,450]` 且与该卡目标面积按 §15.2 公式一致（±5ms，见时长表）；关键帧 `scale` 峰值 **∈[1.02,1.05]**（确有回弹）；连点后无叠动画、无「跳回起点」（首帧 presentation 值 = 点击瞬间 rect）；reduce 轮 `duration===150` 且峰值 **1.000±0.002**（无回弹） |

> 视口矩阵与 Ego 一致：`1228×730 / 1228×680 / 1536×730`，dpr 1，**headed**（`glass-effects` 铁律 6：材质类断言必须在 headed 下读 computed style，不用 headless 截图判定）。

### 9.3 需要废弃的旧断言

- `scripts/qa-ego-clicks.mjs:8` 断言「初始必须 1 张 `data-panel` 浮层」——与**已决策**口径（初始全 mini，§11.1 D1）冲突，直接归档，不再「先定口径」。
- `t_834a621c` 的 **50.5fps 空闲基线 / 40fps 上限** 口径**作废**（v2）：那是 Ego 窗口在软件合成下的上限，与用户口径（1536×730 ≥30、目标 60）不是同一件事。保留其「边缘折射签名去重」的结论，**删除其 FPS 门槛**（§11.1 D2）。
- 任何用 `border`/`inset` 判断「有玻璃感」的断言 → **反转**为「必须为 0」（灰圈=0，§6.6）。
- 所有以 `__gevLc.open()/toggle()` 驱动的脚本（`__gevLc.toggle/open/close` 均为旁路）→ 归档。

---

## 10. 实施计划（Phase 1 起，每步独立可回滚）

> 纪律：**禁止 append-only CSS**。每步一个 commit，回滚 = `git revert <sha>`；`index.html` 每步增量 ≤2 行（一行 `<script>` 或一行 `<link>`，均带「删掉本行即完全还原」注释）。
> CSS 门槛（CI 硬卡）：`material.css` 行数 ≤300、`!important === 0`、双 ID 选择器 === 0。

| 步 | 内容 | 文件 | 验收 | 回滚点 |
|---|---|---|---|---|
| **S0** | 基线取证（0 改动）：跑现有 harness 存 rect/state/computed 快照 | `.gev-logs/frontend-phase0/` | 7 卡基线 JSON + 截图 | 无（只读） |
| **S1** | 纯模块骨架 + 单测：`controller/layout` 先不接线 | `src/lc/{controller,layout}.js` + `node --test` | 布局纯函数 12 组输入断言；状态机转移表全覆盖 | 删 `src/lc/` |
| **S2** | `CollapsePort` + 接管 `.collapsed`（App 侧 3 行开关：7 卡跳过 `bindPanelDisclosure`/`createHoverDisclosure`） | `src/lc/collapse-port.js`、`src/lc/app-adapter.js`、`src/ui/panelChrome.js`(3 行) | T1/T4 绿：初始全 mini、切换后兄弟 header 可点 | `git revert`（`index.html` 未动） |
| **S3** | `Interaction` 替换：新指针状态机上线，删 `press/resolvePress/click 灭口/blockHover/watchAutoExpand` | `src/lc/interaction.js`、删 `gev-liquid-cards.js:406-470,2874,2904-3010` | T2/T6/T7 绿；`__ptr` 全 trusted | `git revert` |
| **S4** | `LayoutEngine + Renderer` 上线：删 `planGroupPush/applyGroupPush/normalizeRail/clearLateOverlaps/reflow/settleGuard` 及其定时器 | `src/lc/{layout,render}.js`、删 `973-1767` | T3/T5/T10 绿；`grep -c setTimeout src/lc = 0` | `git revert` |
| **S5** | 材质收敛：新建 `material.css`（≤260 行、0 `!important`），删 `public/gev-liquid-cards.css` | `src/lc/material.css`、`index.html`（换 1 行 `<link>`） | T11/T12 绿 + 门槛 CI 绿 | `git revert`（旧的 link 一行恢复） |
| **S6** | 死注入/死代码清除：删 `gev-gl-glass.js`、按需加载 `gev-lg-filter.js`、删 `ensureWarp` 与 72 个热区 | `public/`、`src/lc/render.js` | `document.querySelectorAll('.gev-lg-warp').length===0`；网络面板无 `dispmap.jpg` | `git revert` |
| **S7** | Harness 重建：`scripts/lc/*` 上线，172 个 `qa-*` 归档 | `scripts/` | T1–T16 全绿 + `npm test` 全绿 | 目录移回 |
| **S0b**（v2） | GPU/FPS 取证（0 改动）：`chrome://gpu` 的 WebGL2 加速状态 + `renderer` 字符串 + 1536×730 基线 FPS（high/software 两轮） | 无代码 | `evidence/_collab/t_7cba5d02/gpu-baseline.json` + 2 张截图 | 无（只读） |
| **S1g**（v2） | `gpu.js` 上线 + 三处 `getContext` 补 `powerPreference`（探测画布 / atmosphere / gev-graphics）+ `#gev-gpu-chip` + `#gev-gpu-notice` + tier 降级 | `src/lc/gpu.js`、`src/gev-graphics.js`(2 行)、`src/app/atmosphereCompat.js`(1 行)、`src/gev-perf.js`(≤10 行)、`index.html`(≤2 行) | T14 双轮绿；`grep -rn "getContext('webgl" src/ public/` 全部带 options（0 例外） | `git revert`／删那 1 行 `<script>` |
| **S4m**（v2） | `morph.js` 上线，替换 `SPRING/springKf/progress/runMorph`（删固定 350ms、删 `easing:'linear'` 采样、删 64ms 保险丝的 `setTimeout`） | `src/lc/morph.js`、删 `src/gev-liquid-cards.js:12-278` | T16 绿（逐卡时长对表 ±5ms、峰值 1.02–1.05） | `git revert` |
| **S5d**（v2） | `dock-overlay.js` 上线：`.dock-panel` 唯一形态；删 `.dock-popover-content` 第二套几何 + `.dock-tray-toggle` 第三套 + 语音卡独立 popover | `src/lc/dock-overlay.js`、`src/lc/material.css` | T15 绿（≤1 张 / 居中 ≤2px / 无截字 / border+outline+inset 全 0） | `git revert` |

**验收口径（Phase 1 完成定义 · v2）**：**T1–T16 全绿**（含 T14 GPU 双轮、T15 dock 单展开、T16 动画时长/回弹）；`src/lc` 单测覆盖状态机全部转移；`!important === 0`；**`inset` 描边计数 === 0、`border/outline` 计数 === 0**（卡层 + `.dock-panel`）；`document.getAnimations()` 在任意序列结束后 600ms 清零；**GPU 两轮报告齐全且 FPS 与 GPU 状态分栏**；`src/gev-liquid-cards.js` 与 `public/gev-liquid-cards.css` 均为 0 行。

---

## 11. 决策状态（v2：3 条已决策 + 1 条仍需批准）

### 11.1 已决策（写进 spec，不再讨论）

| # | 决策 | 依据 | 落地位置 |
|---|---|---|---|
| **D1** | **初始态 = 全 mini，不自动展开** | 用户 2026-10-28 明确（P 表总验收「初始全 mini … 无圆形 ✕」）；代码里 `openDefaultCard()` 本来就是空实现（`gev-liquid-cards.js:3032-3040`） | T1 按「7 卡全 mini、`floating===0`」判；`scripts/qa-ego-clicks.mjs:8` 的旧断言作废（§9.3）；`primeInitialState`（`3065-3102`）重写为「一次定初始态」，删 3 个 `setTimeout` + 60×250ms 轮询 |
| **D2** | **FPS 口径 = 默认视口 1536×730 空闲 ≥30fps、目标 60；GPU 状态单独记录** | 用户口径（P0-1 验收）；Ego 窗口 50.5/40 是**软件合成下的环境上限**，不能当产品基线 | T13 重写（§9.2）；`software` 档下限 20fps；报告分「FPS」与「GPU」两栏（§13.4） |
| **D3** | **灰圈 = 0：材质层删除 `hairline/发丝边`** | P0-2；G1–G4 四代各带一套 edge token 是叠圈主因（§2 F7） | token 删 2 个（§6.1）、不变量加 3 条（§6.5）、新增 §6.6、T12 重写、§8.1 尾注改为「删而非迁」 |

### 11.2 仍需批准（阻塞 S2，只有 1 条）

1. **`.collapsed` 的最终归属**：推荐 **`CollapsePort` 调 App 的 `setPanelCollapsed()`**（App 继续拥有披露/持久化/share，Hermes 只拥有几何）——代价是改 `src/ui/panelChrome.js` 约 3 行（给 7 张卡加 `externalDisclosure` 开关）。备选（不改 App）：Hermes 独占并向后发合成意图——但 App 的 `godsEyeView.*.panelCollapsed.*` 会与 Hermes store 永久漂移，**不推荐**。

### 11.3 原「待 lead 确认」两项 —— 已由 review round 1（artifact lens）裁定闭合

2. **行数基线（已裁定）**：裁定为 **1011 / 3245**。本文按实测 **1011 / 3245**（§1.1 三条命令 + 5 组口径 + 全仓副本排查）；P 表/检查报告的 **908 / 3048** 本仓库任一口径都复现不出来，review 已独立复核 4 组口径同样为 0 命中 → **Phase 1 门槛数字按 1011/3245**，不存在第二个有效口径。`!important` 284 / `setTimeout` 33 与 P 表一致，不受影响。
3. **动画时长公式（已裁定）**：裁「以本文 §15.2 两点线性插值为准」。P 表 `clamp(350, 350 + sqrt(area)*4, 450)` 对任何卡片都夹到 450（含其自身示例 176×43「≈350ms」，实算 698→450），等于没有自适应；§15.2 的两点插值（`K=0.3630`，端点 350/445）端点与其示例一致且可复算，review 已采纳。**不需要再等确认**，T16 直接按 §15.2 的逐卡时长表断言。

## 12. 与既有文档/报告的关系

- `docs/UI-OWNERSHIP.md:13`：App 侧已声明 `panelChrome.js` 拥有「Disclosure, docking, layout」。本方案**尊重该声明**：控制器不再直接写 `.collapsed`，而是经 Port 调用该 owner。
- `evidence/_collab/t_b37e6b4b/REPORT.md`：唯一 owner 的第一次尝试（按下-抬起配对）。本次取其结论（不能靠 click 目标解析），但把「配对」升级为**状态机 + 世代号**，并把 `if (st.closing) return` 这类吞点路径全部移除。
- `evidence/_collab/t_8cf06356/REPORT.md`：3:25 结构与锚点生长结论保留为**布局规则的来源**（锚点/生长方向/收缩优先），但实现从「追着重排跑」改为「一次算完」。
- `evidence/_collab/t_834a621c/README.md`：边缘折射环的签名去重与 FPS 口径**原样保留**，作为 GlassRenderer 的既有成果。

---

## 13. GPU 能力与降级（v2 新增模块 `src/lc/gpu.js`）

### 13.1 取证：现在到底哪一段没接上

| 位置 | 现状 | 判定 |
|---|---|---|
| `src/app/viewer.js:146-150,178-182` | Cesium `contextOptions.webgl.powerPreference = gfx.gpuPref`；桌面默认 `'high-performance'`（`src/gev-graphics.js:56`）、iOS 默认 `'default'`（`:46`） | ✅ 已请求，**不改默认值** |
| `public/gev-edge-lens.js:282-284` | `getContext('webgl2', {... powerPreference:'high-performance'})` | ✅ 已请求 |
| `src/cockpitCloudEffects.js:278-291` | 私有 `webgl` 上下文，`powerPreference` 自读 `gev.gfx`，默认 `high-performance` | ⚠️ 与主画布可能不是同一块 GPU |
| `src/gev-graphics.js:253-272` | 探测画布 `getContext('webgl2')` **无 options**；`gpuInfo()` 只返回 renderer 字符串 | ❌ 探测可能来自另一块 GPU；不判软件渲染 |
| `src/app/atmosphereCompat.js:135` | 同上，无 options | ❌ |
| `public/gev-gl-glass.js:150-195` | `SOFT_RE = /SwiftShader\|llvmpipe\|Software\|Basic Render\|Microsoft Basic/i` + 完整 `gpuInfo()` + `showSoftNotice()` | ❌ **在死文件里**（`index.html` 未加载，889 行） |
| `src/gev-perf.js:129-141` | 只有 `#gev-perf-fps` | ❌ 没有任何「GPU 状态」可见位 |

一句话：**请求高性能上下文这件事做了一半（探测路径漏了），判定与降级一件没做（实现躺在死文件里），状态没有一个可见位。**

### 13.2 模块契约（唯一 GPU 能力来源）

```ts
// src/lc/gpu.js  — L0，唯一允许调用 getExtension('WEBGL_debug_renderer_info') 的模块
type Tier = 'high' | 'software' | 'none';
type GpuState = {
  ok: boolean;
  api: 'webgl2' | 'webgl' | 'none';
  renderer: string;                 // UNMASKED_RENDERER_WEBGL（无扩展时退 RENDERER）
  vendor: string;
  requested: 'high-performance';    // 我们请求的值（固定）
  granted: string | null;           // getContextAttributes().powerPreference（浏览器可忽略请求）
  software: boolean;                // SOFT_RE 命中
  tier: Tier;                       // high | software | none
  at: number;                       // 探测时间戳
};
export function probe(): GpuState;                      // 首次探测后缓存；visibilitychange / webglcontextlost 时重探
export function tier(): Tier;
export function subscribe(fn: (s: GpuState) => void): () => void;
export function contextOptions(extra?): WebGLContextAttributes;  // { powerPreference:'high-performance', ...extra }
```

### 13.3 硬规则

- **R1 · 所有上下文都带 `powerPreference`**：`src/` 与 `public/` 中每一处 `getContext('webgl2'|'webgl'|'experimental-webgl')` 都必须显式传 `{powerPreference:'high-performance'}`，**探测画布也不例外**（否则探测到的 renderer 不是渲染用的那块 GPU）。探测完立刻 `getExtension('WEBGL_lose_context')?.loseContext()` 释放（`src/gev-graphics.js:263-265` 已有此写法，保留）。
- **R2 · 软件渲染就明确降级，不假装流畅**：`SOFT_RE.test(renderer)` → `tier='software'`；此时 ① `#gev-edge-lens` **不创建**；② morph 时长固定 **150ms、无回弹**；③ FPS 目标降到 30（下限 20）；④ 出一次 `#gev-gpu-notice`（`role="status"`，9s 淡出，可手动关）＋ `#gev-gpu-chip` 常驻显示「GPU 未启用」。
- **R3 · 状态必须可见可断言**：`#gev-gpu-chip` 挂在 `#gev-perf-wrap` 内（与 FPS 并排，`src/gev-perf.js:139-141` 已有 wrap），带 `data-gpu-tier` 属性；正常态文案 `GPU · <renderer 简写>`（≤28 字符，超长截断），软件态 `GPU 未启用`。T14 直接断言该属性。
- **R4 · 不覆盖用户的画面设置**：`gfx.gpuPref` 的 `low-power` / `default` 是用户选择，`gpu.js` **不写回**；缺省值维持现有（桌面 `high-performance`、iOS `default`）。
- **R5 · 单一判定**：`software` 判定只允许在 `gpu.js` 里出现一次；`gev-edge-lens`、`morph`、`cockpitCloudEffects` 一律问 `gpu.tier()`，**不许各自再写一份正则**（现在是两份：死文件里的 `SOFT_RE` + 谁都没用）。

### 13.4 记账（FPS 与 GPU 分开，禁止混用）

- 只读钩子：`window.__lc.gpu()` → `GpuState`；`window.__lc.assert().gpu === 'high'`。
- FPS 报告 JSON 结构：`{ "view": {"w":1536,"h":730}, "fps": {...}, "gpu": {"renderer":..., "requested":"high-performance", "granted":..., "tier":...} }` —— **两栏并列**，不允许把 GPU 状态折算成帧率基线，也不允许用帧率反推「有没有用 GPU」（软件渲染在小视口也可能跑到 30）。

### 13.5 失败模式与处置

| 现象 | 判定 | 处置 |
|---|---|---|
| `renderer` 含 `SwiftShader` / `llvmpipe` / `Software` / `Basic Render` | `tier='software'` | R2 全量降级 + 提示条（不阻断使用） |
| 无 WebGL（`getContext` 返回 null） | `tier='none'` | 提示「未启用硬件加速」；不创建任何 canvas 层；3D 相关控件置灰 |
| `granted !== requested` | 记 event，不报错 | 浏览器有权忽略；仅当 `granted==='low-power'` 且 `renderer` 是核显时，在 chip 上标 `（低功耗）` |
| `webglcontextlost` | 重探一次 | 若变 software → 走 R2；若 `none` → 顶部提示「GPU 上下文丢失，已恢复 2D」 |
| Cesium 侧 `failIfMajorPerformanceCaveat:false`（`viewer.js:181`） | 现状：即使落到软件渲染也照跑 | 保留（否则地图直接白屏），但**必须**由 R2 的提示条告知用户 |

### 13.6 用户侧 / 桌面壳 Runbook（写进文档，不改代码）

1. `chrome://gpu` → 看 **WebGL2: Hardware accelerated**；若显示 `Software only` → 浏览器设置 →「系统」→ 开启「使用图形加速」后重启浏览器。
2. Windows：设置 → 系统 → 显示 → 图形 → 找到浏览器 → 选项 → **高性能**（双显卡本默认可能给核显）。
3. 桌面壳（Electron/Tauri 打包时）加：`--ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy`（**只写进打包配置**，运行时不许偷偷改用户浏览器）。
4. 验收：T14 的正常轮必须 `chrome://gpu` 显示 WebGL2 硬件加速 + `__lc.gpu().tier==='high'` + 1536×730 空闲 ≥30fps。

---

## 14. DockOverlay（v2 新增模块 `src/lc/dock-overlay.js`）

### 14.1 取证：底部语音栏为什么「乱」

| 现象 | 机制 | 证据 |
|---|---|---|
| 同组可能同时展开 | dock 三卡（`#location-bar` / `#control-panel` / `#gev-voice-control`）在 §4.4 只是「互斥组成员」，实际靠 `floatOpen` 给兄弟加 `.collapsed` + App 的 `layout-exclusive` 兜底 | `gev-liquid-cards.js:1988-2005`、`src/ui/rightPanelRail.js:93` |
| **两套展开形态** | 语音卡有独立 popover；`control-panel` 有 `.dock-popover-content`（`0.42rem` 另一套）；`.dock-tray-toggle` 又是第三套 | `gev-liquid-cards.css:306-309`、`483-487`、`109-122` |
| 展开面板贴边、不居中 | 面板定位跟随各自 header 锚点（`dock = header.bottomleft`，§5.2），dock 内三卡横向排布 → 谁开谁贴自己那一侧 | §5.2 锚点规则 |
| 文字周围多一圈边框 | 控件用 `inset 0 0 0 0.5px` 发丝边冒充「玻璃感」 | `gev-liquid-cards.css:696,707,716,725,739,750` |
| 空玻璃块 / 截字 | dock 高度由 `dockHeight()` 取「最高子卡」并夹 60–140（`src/gev-panel-win.js:72-88`），展开面板不参与；面板 padding/line-height/overflow 三处口径不一 | `gev-panel-win.js:66-88` |

### 14.2 模块契约

```ts
// src/lc/dock-overlay.js — dock 组展开面板的唯一渲染者
const DOCK_GROUP = ['location-bar','control-panel','gev-voice-control'];  // 与 controller 同一份定义（§4.4）
type DockPanel = {
  id: string;            // 当前展开的 dock 卡
  box: {x,y,w,h};        // 居中于 dock 上方
  radius: number;        // --lc-radius
};
DockOverlay.layout(snapshot, openId): DockPanel | null;   // 纯函数：不读 rect、不写 DOM
DockOverlay.form: 'single'                                // 唯一形态，不允许第二值
```

硬约束：

- **D1 · 同组 ≤1 张**：`count(DOCK_GROUP, phase ∈ {opening, open}) ≤ 1`（与 §4.4 同一不变量，不新增第二套判定）。互斥由 `CardController` 的 MUTEX 事务保证，DockOverlay **不决定谁开**。
- **D2 · 面板居中在语音栏上方**：`x = dock.cx − w/2`（容差 2px）、`bottom = dock.top − 12`；`w = clamp(320, min(dock.w, 560), viewport.w − 24)`；`h = clamp(240, contentH, dock.top − SAFE_TOP − 12)`；越界时**面板自己**滚，不缩到看不见。
- **D3 · 只有一种展开形态**：DOM 上只允许一个 `.dock-panel[data-lc-phase]`。**删除**：语音卡独立 popover、`.dock-popover-content` 的第二套几何（`gev-liquid-cards.css:483-487`）、`.dock-tray-toggle` 的第三套（`:109-122`）、任何 `.dock-panel-inner` 内层底/内层模糊。
- **D4 · 文字直接在玻璃上**：`--lc-text` + `text-shadow`，面板与面板内控件 `border=0 / outline=0 / inset box-shadow=0`（§6.6）。hover/active 只用高光/亮度表达。
- **D5 · 空块与截字即失败**：`h` 由内容行数决定（`pad*2 + rows*lineH`）；`overflow:auto` 时最后一个控件必须可达；`scrollWidth > clientWidth + 1` 的可见文本 = FAIL。
- **D6 · 与数据卡同材质（P1-2）**：`#gev-voice-control` 的外层也走同一套 token，不再「特殊」；`html[data-gev-mat="light"]` 的文字色分支保留在共享 token 层，不做每卡一份。

### 14.3 目标结构（与 P 表一致）

```text
┌──────────────────────────────────────────────┐
│        展开面板：居中浮在语音栏上方           │   ← .dock-panel（唯一形态，同时只有 1 张）
│        （文字直接在玻璃上，无边框）           │
└──────────────────────────────────────────────┘
        ┌──────────┬──────────┬──────────┐
        │  位置    │  语音    │ 视觉预设 │        ← dock 行内 mini（不参与展开几何）
        └──────────┴──────────┴──────────┘
```

### 14.4 与其它模块的关系

- **controller**：`ACTIVATE(dock 成员)` → MUTEX 事务（先 `retire(old)` 再 `open(self)`，同 tick）；`DockOverlay` 只把 `openId` 翻译成盒。
- **layout**：面板盒在 `layout.js` 里以 `DockPanel` 形式返回，`render.js` 一次写 `left/top/width/height`（**不写 `transform`**，避让 `gev-panel-win` 的拖拽写者，§5.4）。
- **morph**：面板开合用 §15 的动画，且**与卡片动画同一个 `gen`**（连点语音栏不得出现「面板开一半又换卡」）。
- **零 `setTimeout`**：dock 现有的 `[260,900,2200]` 三次 `syncDock` 复核（`src/gev-panel-win.js:126`）是对 dock 高度量不准的补丁，S5d 之后由「面板不参与 dock 高度」+ 一次 ResizeObserver 取代。

---

## 15. MorphAnimation（v2 新增模块 `src/lc/morph.js`）

### 15.1 取证：现在的「展开」为什么没有果冻

| 事实 | 证据 |
|---|---|
| 弹簧硬编码 `duration: 350`，不随面积变化 | `src/gev-liquid-cards.js:12-19` |
| 动画用 FLIP（`transform: translate+scale`）+ `easing:'linear'` 采样 26 帧关键帧 | `:230-278`（`springKf`）、`:14-19`（`samples:26`） |
| `prefers-reduced-motion` 时 `dur = 0` → **完全无动画**（P 表要求 150ms） | `:237-238` |
| 另有一处 `{duration:280, easing:'cubic-bezier(.22,.9,.24,1)'}` 写在同一卡上 → 可能双动画互踩 | `:934` |
| 64ms「一帧没走就 cancel」保险丝（值得保留的防线） | `:255-275` |

### 15.2 时长公式（**已修正 P 表公式**）

P 表给的是 `clamp(350, 350 + Math.sqrt(area) * 4, 450)`。**该式自相矛盾**：对 176×43 实算 `350 + 87.0×4 = 698 → clamp = 450`，而 P 表自己写「176×43 ≈ 350ms」；对 320×380 也是 450 —— 即**所有卡都夹到 450**，等于没有自适应（复算见 §16.3）。

本文用同端点、可复算的两点线性插值（端点直接取自 P 表的两个示例）：

```js
// src/lc/morph.js
const S_SMALL = Math.sqrt(176 * 43);    // 86.994  → 350ms
const S_LARGE = Math.sqrt(320 * 380);   // 348.712 → 445ms（P 表「≈430–450」取中）
const K = (445 - 350) / (S_LARGE - S_SMALL);   // 0.3630
export const durationMs = (w, h) =>
  Math.round(Math.min(450, Math.max(350, 350 + (Math.sqrt(w * h) - S_SMALL) * K)));
```

**面积口径**：用**目标盒**（展开后的 `targets.expW × expH`，来自 `CARDS`，`gev-liquid-cards.js:30-40`），不用起始盒 —— 否则同一张卡每次开卡时长都不同，无法断言。按现有配置复算的时长表：

| 卡 | 目标盒 | area | √area | 时长 |
|---|---|---|---|---|
| `data-panel` | 320×380 | 121 600 | 348.71 | **445ms** |
| `scene-panel` | 320×340 | 108 800 | 329.85 | 438ms |
| `pp-toggles` | 300×430 | 129 000 | 359.17 | 449ms |
| `cctv-panel` | 340×430 | 146 200 | 382.36 | **450ms** |
| `global-context-panel` | 320×400 | 128 000 | 357.77 | 448ms |
| `location-bar` | 380×240 | 91 200 | 301.99 | 428ms |
| `control-panel` | 520×380 | 197 600 | 444.52 | **450ms** |
| `gev-voice-control` | 260×240 | 62 400 | 249.80 | 409ms |
| （示例小卡） | 176×43 | 7 568 | 86.99 | **350ms** |

### 15.3 硬规则

- **M1 · 时长**：`durationMs(expW, expH)`，值域夹在 `[350, 450]`；T16 逐卡对表 ±5ms。
- **M2 · easing = `easeOutBack` 或等价弹簧，overshoot 1.02–1.05**：只允许**一条** WAAPI 驱动几何（`transform` 或 `width/height/left/top/border-radius` 中的一个集合）；`overshoot` 的关键帧峰值必须落在 1.02–1.05（不是 1.10 的夸张回弹，也不是 1.00 的线性）。同时**删掉 `:934` 那条 280ms 的 `cubic-bezier` 动画**（同一元素双动画 = 「抖一下」「跳回去」的直接原因）。
- **M3 · 连点取消**：新 `ACTIVATE` 到来 → `anim.cancel()` 旧动画，并从**当前 presentation 值**（`getComputedStyle(el).transform` / 当前 render box）继续；禁止从起点重播。动效层不持有状态（`gen` 在 controller）。
- **M4 · reduced-motion**：`matchMedia('(prefers-reduced-motion: reduce)')` → **150ms、`ease-out`、无回弹**（overshoot = 1.000）。**不再用 `dur=0`**（0ms 会让「开卡」变成瞬移，反而更难跟踪）。
- **M5 · 帧健康保险丝**：保留现有 64ms「`currentTime < 32` 就 cancel 并直接落定」的防线（`:255-275`），搬进 `morph.js`。这是**必要的定时器**——动画不推进时 `Animation.finished` 永不触发，所以不能用事件替代。因此 `morph.js` 允许**恰好 1 个** `setTimeout`，并在 CI 里白名单化：`grep -c setTimeout src/lc/morph.js === 1`；其余 `src/lc/*` 仍必须为 0。
- **M6 · 可断言**：`document.getAnimations().filter(a => a.effect.target === card).length ≤ 1`；结束后 600ms 内必须归零。

### 15.4 与其它模块的关系

`CardController` 决定 `phase`（mini/opening/open/closing）与 `gen`；`MorphAnimation` 只负责「从 A 盒到 B 盒的一条曲线」并把 `onfinish` 回写给 controller（`ANIM_END(gen)`）。**MorphAnimation 不读 rect、不决定目标盒**（目标盒来自 `LayoutEngine`）。

---

## 16. v2 交付对账（P 表 7 条 → 本文章节 / T 用例）

> **v3（2026-10-28 15:29，review round 1 两处必改已修）**：① §1.1 第 3 条的跨行 code span 已合成一行，`tr -d '\r'` 才是「去 CR 行数不变」，`tr -d '\n'` 实测为 0（反例已写进命令块）；② 「去注释」两数各自标注口径（CSS 用 `/*`、JS 用 `//`），并补统一口径 870 / 2963；两条命令均挂在 §16.3。其余节未改。

### 16.1 逐条映射

| # | P 表条目 | 落在哪 | T 用例 | 状态 |
|---|---|---|---|---|
| 1 | **GPU**：`powerPreference` + `WEBGL_debug_renderer_info` + SwiftShader/llvmpipe 降级 + GPU 状态显示 | §2 F8、§3.2（L0 `GpuCapability`）、§6.7（tier 材质档）、§13 全节、§7.6 冲突清单、S0b/S1g | **T14** | ✅ 已补 |
| 2 | **去灰圈**：删材质层 `hairline/发丝边`、灰圈=0、T12 断言 border/outline/inset 为 0 | §2 F7、§3.1 原则 4、§6.1（删 2 token）、§6.2、§6.5（不变量 +3 条）、**§6.6**、§7.5、§8.1 尾注 | **T12** | ✅ 已补 |
| 3 | **DockOverlay**：同组只 1 张、居中在语音栏上方、一种形态、文字无边框 | §4.4（dock 组四约束）、§5.4（几何口径）、**§14 全节**、§14.4、S5d | **T15** | ✅ 已补 |
| 4 | **MorphAnimation**：350–450ms 面积自适应、overshoot 1.02–1.05、连点取消、reduce 150ms 无回弹 | §15 全节（含修正公式 + 逐卡时长表）、§3.2 L2b、S4m | **T16** | ✅ 已补 |
| 5 | **初始态 = 全 mini、不自动展开**（从「待决策」改为已决定） | **§11.1 D1**（已决策表）、§9.3（旧断言作废）、S2 | **T1** | ✅ 已改 |
| 6 | **FPS 口径 = 1536×730 ≥30 / 目标 60；不用 50.5/40 基线；GPU 状态单独记录** | **§11.1 D2**、§9.2 T13 重写、§13.4（分栏记账）、§9.3（旧基线作废） | **T13** | ✅ 已改 |
| 7 | **修正取证行数** | **§1.1**（三条命令复算 + 5 组口径 + 差异定位）、**§11.3 已裁定**、§16.3（命令块 + 差异记录）；结论：**1011 / 3245**（908/3048 任一口径均不复现） | — | ✅ 已复算（差异留档） |

### 16.2 新增/改写的 T 用例清单

| 用例 | 类型 | 门禁 |
|---|---|---|
| T12 | 改写（加灰圈三条 + 伪元素 + 4x 截图） | 硬门禁 |
| T13 | 改写（用户 FPS 口径 + 双轮 + 分栏） | 硬门禁（≥30 / p90≤33） |
| **T14** | 新增（GPU 判定 + 降级 + 可见位） | 硬门禁（双轮） |
| **T15** | 新增（dock 单展开 + 居中 + 无截字 + 无边框） | 硬门禁 |
| **T16** | 新增（时长表 + 回弹 + 连点 + reduce） | 硬门禁 |
| T1 / T3 / T10 | 沿用（初始全 mini 口径已被 D1 固定，不再「先定口径」） | 硬门禁 |

### 16.3 复算命令总表（新增数字必须挂在这里）

```bash
cd /d/Hermes/gods-eye-view
# —— 行数（§1.1）——
wc -l public/gev-liquid-cards.css src/gev-liquid-cards.js            # 1011 / 3245
awk 'END{print NR}' public/gev-liquid-cards.css                      # 1011
sed -n '$=' src/gev-liquid-cards.js                                  # 3245
# —— 计数口径（§1.1 第 3 条：908/3048 的反证，五组口径各自可复算）——
tr -d '\r' < public/gev-liquid-cards.css | wc -l                     # 1011（去 CR，行数不变）
tr -d '\r' < src/gev-liquid-cards.js | wc -l                         # 3245
tr -d '\n' < public/gev-liquid-cards.css | wc -l                     # 0（反例：删 \n 会把整文件并成 0 行，勿用作「去 CR」）
grep -c '[^[:space:]]' public/gev-liquid-cards.css                    # 955  （非空行，CSS）
grep -c '[^[:space:]]' src/gev-liquid-cards.js                        # 3179 （非空行，JS）
# 去注释（CSS 口径：非空且不以 /* 或 * 开头）
grep '[^[:space:]]' public/gev-liquid-cards.css | grep -vc '^[[:space:]]*\(/\*\|\*\)'   # 870
# 去注释（JS 口径：非空且不以 // 开头；/* */ 行与 * 行仍计入）
grep '[^[:space:]]' src/gev-liquid-cards.js | grep -vc '^[[:space:]]*//'                # 3015
# 去注释（统一口径：排除行首 /*、*、//，CSS 与 JS 同一判据）
grep '[^[:space:]]' src/gev-liquid-cards.js | grep -vc '^[[:space:]]*\(/\*\|\*\|//\)'   # 2963
grep '[^[:space:]]' public/gev-liquid-cards.css | grep -vc '^[[:space:]]*\(/\*\|\*\|//\)' # 870
# —— P 表一致的三个数 ——
grep -c '!important' public/gev-liquid-cards.css                     # 284
grep -o 'setTimeout' src/gev-liquid-cards.js | wc -l                 # 33
grep -o 'setInterval' src/gev-liquid-cards.js | wc -l                # 5
# —— 灰圈（§6.6）——
grep -c 'inset 0 0 0' public/gev-liquid-cards.css                    # 22
grep -rn 'inset 0 0 0' --include=*.css src/ public/ | wc -l          # 36（全仓）
grep -c 'border' public/gev-liquid-cards.css                         # 38
grep -c 'outline' public/gev-liquid-cards.css                        # 1
# —— GPU（§13）——
grep -rn "getContext('webgl" --include=*.js src/ public/ | wc -l     # 7 处；活代码中 2 处缺 options（gev-graphics:257 / atmosphereCompat:135），另 2 处在死文件 gev-gl-glass.js:80,158
grep -rn 'powerPreference' --include=*.js src/ public/ | wc -l        # 9 处
grep -rln 'WEBGL_debug_renderer_info' --include=*.js src/ public/     # gev-graphics.js / gev-edge-lens.js / gev-gl-glass.js(死)
# —— dock（§14）——
grep -c 'dock-popover-content' public/gev-liquid-cards.css            # 13
grep -n 'function dockHeight' src/gev-panel-win.js                    # 72
```

**908 / 3048 差异记录**：见 §1.1 —— 三条命令均得 1011 / 3245，全仓 `*gev-liquid-cards*` 副本无此二值（`dist/` 与 `evidence/_collab/*/orig` 是 862），文件 mtime 早于检查报告，故不是「测量时机」问题。以 1011/3245 为 Phase 1 基线；若 lead 有复合口径，请补命令后本文再改。

**P 表动画公式差异记录**（§15.2）：`350 + sqrt(area)*4` 对 176×43 得 698、对 320×380 得 1745，两者都夹到 450 —— 与该表自身示例（350/445）矛盾。本文改用两点线性插值 `K=(445−350)/(348.712−86.994)=0.3630`，端点与示例一致、可复算（`python3 -c` 一行可验）。

### 16.4 本轮未覆盖（明确写在文档里，不假装覆盖）

| 项 | 为什么不在本卡 | 后续 |
|---|---|---|
| 桌面壳 Chromium flags（`--ignore-gpu-blocklist` 等） | 属打包/部署配置，不在 `docs/architecture` 的可改范围，且本卡禁止改 `public/`、`src/`、`index.html` | 写进 §13.6 Runbook；由发布任务处理 |
| 真实设备上的双显卡切换验证 | 需要用户侧 Windows 图形首选项设置，agent 无法替代 | S0b 取证时由用户按 §13.6 操作一次 |
| `mobile-portrait` / Safari 的 `llvmpipe` 判定 | 移动端 Safari 不暴露 `WEBGL_debug_renderer_info`，`tier` 只能靠 `getContextAttributes().powerPreference` + 帧率推断 | 记为已知限制：iOS 上 `tier` 保守判 `high`，仅 FPS 兜底 |
| 灰圈的视觉终判 | 需要 headed 真实截图（`glass-effects` 铁律 6：材质断言不能用 headless 截图判） | T12 的 ⑨ 项，S5 完成后由 Ego 抓 4x 角部图 |
