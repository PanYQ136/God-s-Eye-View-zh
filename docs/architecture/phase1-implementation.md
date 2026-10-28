# Phase 1 实施报告：GPU 默认 + 去灰圈 + 底部语音栏统一 + 果冻动画

- 卡片：`t_a4333e26`（父 `t_5c610f6a` Phase 0 架构 / `t_7cba5d02` v2 补丁）
- 基线：`docs/architecture/frontend-phase0.md`（963 行 v2）· 需求表 `上帝之眼-新问题P表-20261028.md`
- 日期：2026-10-28
- 结论：**29/29 验收全绿**（1536×730 与 1228×730 两个视口各跑一轮），`node --test` 9/9，`npm run build` 通过。

---

## 1. 现象（开工前的四处硬伤）

| # | 现象 | 实测值 |
|---|---|---|
| 1 | GPU 只在「请求侧」做了一半：探测画布不传 options，软件渲染判定只活在死文件 | `gev-graphics.js:257`／`atmosphereCompat.js:135` 无 options；`SOFT_RE` 仅在未加载的 `public/gev-gl-glass.js` |
| 2 | 灰圈：卡层 22 处 `inset 0 0 0 {0.5\|1}px` 内描边叠 App `border:1px` | 卡层 22 处 + 全仓 36 处 |
| 3 | dock 三卡各有一套展开形态，面板跟 header 锚点走 → 谁开谁贴边/被挤到 x=966、x=1142 | `#location-bar` 展开把 `#control-panel` 推到 x=966、`#gev-voice-control` 推到 x=1142/y=486 |
| 4 | 动画 `SPRING.duration=350` 硬编码 + 同一张卡上两族曲线（开卡采样 linear / 让位 280ms cubic-bezier） | `gev-liquid-cards.js:30` SPRING、`:934` 让位 280ms |

## 2. 根因

1. **没有单一 GPU 判定源** → 三处各自 `getContext` + 一份正则，且探测上下文不保证命中真正渲染的那块 GPU。
2. **描边是「叠加」出来的**：卡片本体去掉了 border，App 侧 `controls.css` / `lg-glass.css` / `gev-cn.css` 仍给小控件画 1px 边 + 0.5px 内圈，卡层逐个 `border-color: transparent` 兜，漏 6 处即多一圈灰边。
3. **dock 面板没有统一锚点**：三个面板各写一套 `left/right`，展开时互相挤位。
4. **动画参数散在调用点**：时长写死、easing 两族、reduce 时 `dur=0`（瞬移）。

## 3. 改法（4 个模块 + 5 处收口）

### 3.1 新增 `src/lc/gpu.js`（唯一 GPU 判定源，R1–R5）
- `contextOptions()` 统一返回 `powerPreference:'high-performance'`（探测与渲染同源）；
- `probe()` 建一次 1×1 上下文读 renderer → `tier: 'high' | 'software' | 'none'`，随后 `loseContext()`；
- `SOFT_RE` 全仓唯一；`mountChip()` 常驻 `#gev-gpu-chip`（与 FPS 同 wrap）、`showNotice()` 一次性 `#gev-gpu-notice`（CSS 9s + `animationend` 移除，**不用 setTimeout**）；
- 不写回用户设置；`_noticeShown` 留痕供断言（提示条 9s 后会自己消失）。

### 3.2 新增 `src/lc/morph.js`（M1–M5 唯一实现）
- M1 时长两点插值：`S_SMALL=√(176×43)=86.994 → 350ms`、`S_LARGE=√(320×380)=348.712 → 445ms`、`K=0.3630`，夹在 `[350,450]`；
- M2 `easeOutBack` 按**视觉放大比例**反解 `c1`，峰值钉在 `1.035`（落在 1.02–1.05）；
- M3 连点 `cancel` 旧动画并从 presentation 值续播；调用方新增 `to` 参数传权威目标盒（不依赖刚写 inline 的 gBCR）；
- M4 `reduce`（显式 → `tier==='software'` → `prefers-reduced-motion`）→ 150ms / `ease-out` / 零回弹；
- M5 帧健康保险丝：`morph.js` **恰好 1 个** `setTimeout`（200ms，实测首张开卡主线程被占 170–260ms，64ms 会掐掉正常动画）。

### 3.3 `src/gev-liquid-cards.js`
- `SPRING` 降级为兼容只读常量；删除本地 `springProgress()` 数值积分与 `springKf()`；`runMorph` 委托 `Morph.run`；
- dock 锚点统一（§14 D2）：`cx = #command-dock 水平中心`、`top = dock 组内其他可见成员最小 top`，落位 `x = cx − w/2`、`y = top − 12 − h`；底部收短时「底边贴语音栏、收上边」；
- 让位短路：dock 组零垂直重叠时不重排（否则水平轨道会重排）；
- `HEAD_SEL` 追加 `.gev-voice-heading,.gev-voice-readout`（语音卡过去**没有**可点标题条 → 点「语音」永不展开）；
- 重排时的 `runMorph` 在动画进行中跳过（否则 M3 会把**开卡动画**当旧动画 cancel，实测首卡峰值恒 1.000）；
- software tier 不跳过 FLIP（150ms 无回弹；否则「降级」=「瞬移」）。

### 3.4 `src/gev-perf.js` / `src/gev-graphics.js` / `src/app/atmosphereCompat.js` / `public/gev-edge-lens.js` / `public/gev-gl-glass.js`
- `gev-perf.js`：`mountChip()` 把 `#gev-gpu-chip` 与 FPS 同 wrap；FPS/性能按钮去 `border`（改底色/字色表达状态）；
- `gev-graphics.js`：`gpuInfo()` 改读 `gpuProbe()`，不再自建探测画布（R5）；
- `atmosphereCompat.js`：探测上下文补 `powerPreference`（**不**提前 `loseContext`，后面还要真编译链接）；
- `gev-edge-lens.js`：`tier==='software'` 时**不创建**全屏折射 canvas；renderer 改读 `__gevGpu.probe()`；
- `gev-gl-glass.js`（死文件）：删掉第二份 `SOFT_RE`/`gpuInfo` 自建上下文，改委托。

### 3.5 `public/gev-liquid-cards.css`（去灰圈 + 面板内流）
- 批量剥离环形阴影（备份 `glc.before.css`）：`inset` 且 x/y 偏移皆 0、非 inset `0 0 0 …`、`x 0 0 -y` 发丝高光，共 22 处；
- 「平面清零」：`.gev-lc *` / `.dock-popover-content *` 一律 `border-color: transparent`（保留 1px 边框盒，尺寸与命中区不动）；`.panel-inner` / `[class$='-panel-inner']` / `.pp-panel-body` / `.gev-mic-orbit` 的 `box-shadow` 清空（内层不再画第二圈）；
- 语音卡展开态内部流：`grid` + 隐式列 → 纵向 flex；说话键居中 168×44；电平条给死 24px 高（原来 `height:0` = 空玻璃块，且条的样式全挂在 `#command-dock …` 作用域上，脱层即失效）；迷你态 `.gev-mic-orbit` 在展开面板里是一大块青光 → 隐藏；
  **踩坑记录**：`> * { width:100% }` 会把 8 个贴边缩放热区撑满整卡 → 标题条被热区盖住、展开后再点收不起来（实测 `elementFromPoint` 恒返回 `.gev-lc-edge`）。已用 `:not(.gev-lc-edge):not(.gev-lg-warp):not(.gev-lc-placeholder):not(.gev-lg-rim)` 排除。

## 4. 验证（全部本机实测，可复算）

### 4.1 验收脚本
`node scripts/lc/phase1-accept.mjs --tag=final`（1536×730）/ `--w=1228 --h=730 --tag=ego`（Ego 视口）
只用**真实 CDP 鼠标**（`isTrusted=true` 13 次点击、0 次合成），禁止 `__gevLc.open()/toggle()` 旁路。

| 项 | 实测 |
|---|---|
| 通过率 | **29 / 29**（两个视口各一轮） |
| GPU | `ANGLE (NVIDIA GeForce RTX 3060 Laptop GPU …)`、`tier=high`、`granted=high-performance` |
| 软件渲染轮 | `tier=software`、chip 显示「GPU 未启用」、notice 已出、**不建** edge-lens canvas、morph 150ms/零回弹 |
| FPS（1536×730 空闲） | 139.4fps、p90 6.2ms（1228×730：163.8fps、p90 6.2ms） —— 门槛 ≥30、目标 60 |
| 灰圈 | `visibleStrokes 0` / `rings 0`；`inset` 仅剩 11 处＝顶沿光泽 `0 1px 0`（y 偏移非 0）+ 语音卡 2 处 alpha=0 渐变 + fab |
| 磨砂/暗底 | 卡层 `backdrop-filter` 0、不透明底 0（扫描 141 个元素） |
| dock 单展开 | 三张卡 `nOpen=1`、`|Δcx|=0px`、面板底边距语音栏顶 `12px` |
| 无截字 | 叶文本元素被裁/出界 **0**（三张面板） |
| 逐卡时长 | 445/438/449/450/448/428/450/409 ms —— 与 §15.2 表逐卡相符 |
| 回弹峰值 | 1.0227–1.0471（关键帧实测；rAF 采样佐证 8/8 中 7–8 张吻合 ±0.003） |
| 页面错误 | 1 条（Cesium `Expected width to be greater than 0`，headless/SwiftShader 既有噪声，与本次改动无关） |

产物：`.gev-logs/lc/phase1/final/{report.json,*.png}`（含 3x 角部/边缘放大图、三张 dock 面板、GPU chip、软件渲染轮截图）、`ego/`。

### 4.2 静态门槛
- `src/lc/*` 代码内 `setTimeout` = **1**（`morph.js:209`，M5 保险丝）；`gpu.js` 0；
- `WEBGL_debug_renderer_info` 实调 = **1** 处（`src/lc/gpu.js:75`），其余为注释；
- 单测 `node --test src/lc/morph.test.mjs`：**9/9**（含 P 表原式反例、逐卡时长表、overshoot 反解）；
- `npm run build`：✓ 16.93s，无新增告警（既有 chunk 体积告警不涉本次）。

## 5. 未做 / 遗留

1. `§11.2` `.collapsed` 归属（`CollapsePort` → `panelChrome.setPanelCollapsed`）仍待 lead —— S2 起的闸门，本卡未自行选择；
2. 语音卡展开态的电平条样式是靠**窄化补丁**补上的（`#command-dock …` 作用域在脱层后失效）。S5 收口时应把 `command-dock-compact.css` 里语音条规则改成 `.gev-voice-control …`，届时删掉本段；
3. `public/gev-liquid-cards.css` 的 `!important` 由 **284 行 / 306 次** 增到 **309 行**（+25：平面清零 3 + 语音内流 11 + 电平条 11），行数 1011 → **1009**（去环脚本把 6 处多行 `box-shadow` 折叠成单行，-57 行；新增 55 行）。S5 迁入 `material.css` 时随选择器重写一起降为 0；
4. 未提交 git（按要求）；
5. `.gev-logs/lc/phase1/` 未纳入版本控制（诊断产物）。
