# 网页版上帝之眼 · UI/交互/图层/性能/状态 审计清单

> 依据：《上帝之眼小程序·全周期工程档案》第 7 章（视觉/交互标准）、第 8 章（性能自适应）、第 15 章（网页端专用指引 + Skill/工具方案）。
> 方法：只读扫描 `D:\Hermes\gods-eye-view`（619 JS + 23 CSS），逐项 file:line 取证、自审去伪。
> 日期：2026-10-24 · 审计范围：UI 样式 / 动画 / 交互逻辑 / 图层控制 / 渲染性能 / 状态联动。
> 原则：**本轮只出清单，不改代码**；后续按项「出 diff → 改 → 编译/单测 → 截图/feel-check → 写日志」落地，绝不破坏现有可用功能。

---

## 0. 总体结论（不粉饰）

本工程是**高工艺**的 Cesium 座舱应用，很多"小程序规范要修的点"它本来就做对了，不能当缺陷改：

**已达标（勿动，属强项）**
- 零 `transition: all`、零 `ease-in`；曲线均为优质贝塞尔（0.4,0,0.2,1 / 0.2,0.8,0.2,1 / 0.2,0.75,0.25,1）。
- 无障碍/焦点：`focus-visible` 85 处、`aria-label` 262 处；全局焦点环规则"任何局部 `outline:none` 不得擦除"（foundation.css:41-50）；忙碌态用 `aria-disabled`+`aria-busy` 保焦点（layerPanel.js:611-614）。
- 图层面板：分组标题、图标 `aria-hidden`、缺键提示（panel.js:89-94,626）、`DEGRADED`/`UNAVAILABLE` 降级占位（panel.js:11-15）。
- ticker 全部正确清理（shellFeedback.js:177,194-196；frameRateMonitor.js:23；cctvPresentation.js:224,232），**无泄漏**。
- 关键无限装饰动画（cyber-sonar-sweep / cockpit-* / detection-pulse）已被 `prefers-reduced-motion` 关停（cyber.css:1174,1414,2015；cockpit.css:612,2178；status.css:374）。
- 渲染：`resolutionScale` 生效、`maximumScreenSpaceError` 可调、强制独显（viewer.js:164-188,169）。

**问题分布（真实缺陷少，美化/差异为主）**
| 严重度 | 数量 | 说明 |
|---|---|---|
| HIGH | 0 | 无"伤手感"级问题 |
| MEDIUM | 4 | 玻璃层叠性能、layers.css 特异性债+瞬变、缺"组主开关/solo 独显"、装饰动画未随页面隐藏暂停 |
| LOW | 7 | 动效令牌复用、间距/字体节奏未成体系、骨架屏覆盖、玻璃层级/阴影体系、空态美化等 |
| 美化机会 | 6 类 | 用户最重视项，属设计增量，需 feel-check + 你确认方向 |

---

## A. 交互逻辑（成熟，仅 1 处待验）

| # | 严重度 | 位置 | 问题/差异 | 方向 |
|---|---|---|---|---|
| A1 | LOW(验) | `layers.css:313-322` | 面板/右轨用 `height:auto!important; transition:none!important` 强压 flex 分配 → 某些展开/收起路径**瞬时突变无过渡**，与"平滑"不一致 | 用一次测量后锁定具体高度走 `--transition-smooth`，取消该分支的 transition:none |
| A2 | LOW | `layerPanel.js` 键盘 | 分组/条目键盘导航是否含 ↑↓/Home/End/空格切换 | 补齐 roving tabindex（若无）|

## B. 图层控制（缺 2 项对齐能力）

| # | 严重度 | 位置 | 问题/差异 | 方向 |
|---|---|---|---|---|
| B1 | MEDIUM(缺失) | `src/ui/layers.js/layerPanel.js` | **无"组主开关"**（一键开关整组）与 **"solo 独显"**（临时只看某层、不改用户配置）——小程序面板已有此语义 | 增加组头 master toggle + 每层 solo 按钮（不改持久配置，退出即还原层）|
| B2 | LOW(验) | 图层注册处 | 默认开启图层集是否对齐小程序「事件 7 + 气象 4 默认开」 | 核对默认 enabled 集合，必要时对齐 |
| B3 | — | `layerPanel.js:11-15` | 降级/不可用占位**已具备**（非缺失，仅美化，见 D） | — |

## C. 动画 / 动效（底子好，2 项改进）

| # | 严重度 | 位置 | 问题/差异 | 方向 |
|---|---|---|---|---|
| C1 | LOW | 全 CSS | `--transition-fast/smooth` 仅 2 个令牌；18 处 `cubic-bezier(...)` 硬编码重复 3 种曲线 | 抽 `--ease-standard/out/spring` + `--dur-1/2/3` 令牌，全局复用 |
| C2 | MEDIUM(性能) | `cyber.css/cockpit.css` 等 | 无限装饰动画（sonar 扫掠、cockpit 仪表）仅靠 CSS reduced-motion 关；**页面隐藏(visibilitychange/后台标签)时未暂停**，持续耗 GPU/电 | JS 侧监听 `visibilitychange` 给 `<html>` 加 `.gev-bg`，CSS 对该态 `animation-play-state:paused` |
| C3 | LOW | `command-dock-reveal` 等 | 入场关键帧是否可被用户操作打断 | 用 transition/anime 可中断方式，或入场期间允许输入穿透 |

## D. UI 样式 / 视觉美化（**用户最重视**，设计增量）

| # | 严重度 | 位置 | 现状 | 美化方向 |
|---|---|---|---|---|
| D1 | MEDIUM(品) | `controls.css` 14 / `status` 8 / `dock-sliding` 8 / `layers` 6 / `cockpit` 6 `backdrop-filter` | 玻璃层数多且可能嵌套叠加 | 建立**玻璃层级 3 档**（panel/popover/chip 各自 blur-radius+饱和+边框），减少同屏嵌套 blur；低配走 `@supports`/密度降级 |
| D2 | LOW(品) | `foundation.css:6-33` | 有颜色/圆角/过渡令牌，但**无间距刻度(4/8pt)、无字体级差、无阴影/高程令牌** | 补 `--space-1..8`、`--text-xs..2xl`、`--shadow-1..3`，全模块统一节奏 |
| D3 | LOW(品) | 各面板异步区 | 骨架屏覆盖 34 处但非全覆盖（weather/cctv/space 明细） | 统一 skeleton shimmer 组件，替代空白/文字跳动 |
| D4 | LOW(品) | 全局 | hover/active/press 微交互各模块手写，风格略散 | 提炼统一 press-scale(0.98)+hover 提亮 + focus 环美学 |
| D5 | LOW(品) | 空态/错误态 | 有 `.mission-table-empty` 等文字态，缺插画/引导 | 统一空态图标+一句操作引导+CTA |
| D6 | LOW(品) | 图标/字体 | 图标 aria 处理到位，但图标集/字号是否统一待核 | 核对图标网格/线宽一致、字号阶跃 |

## E. 渲染性能（基本到位，2 项加固）

| # | 严重度 | 位置 | 问题/差异 | 方向 |
|---|---|---|---|---|
| E1 | MEDIUM | 玻璃层叠（同 D1） | 大量 `backdrop-filter` 复合层在低端 GPU 掉帧 | 同 D1 降级策略；必要时对静态面板改用预渲染模糊图 |
| E2 | LOW(验) | `app/viewer.js` 循环 | `requestRenderMode`/按需渲染是否开启（静止不重绘） | 若未开，评估 `requestRenderMode:true` + `maximumRenderTimeChange` |
| E3 | LOW | `rAF` 126 处 | 是否有多余常驻 rAF 循环空转 | 审计常驻循环，静止时挂起 |

## F. 状态联动（健康，仅 1 项）

| # | 严重度 | 位置 | 问题/差异 | 方向 |
|---|---|---|---|---|
| F1 | LOW(验) | `stateChannel.js`/`sourceSlot.js` | UI↔状态是否存在同一变更多次刷新 | 核对订阅去重与批处理（对齐小程序 `_sigOf` 稳定签名思路）|

## G. 跨端差异 / 缺失项汇总（用于后续对齐）

| # | 类别 | 差异点 | 处置建议 |
|---|---|---|---|
| G1 | 图层交互 | 缺组主开关 + solo 独显（B1） | **建议补**（对齐小程序、提升图层操作体验）|
| G2 | 图层默认集 | 默认开层是否= 事件7+气象4（B2） | 核对后对齐 |
| G3 | 动效令牌 | 无统一 ease/duration/space 令牌（C1/D2） | **建议补**（规范化，避免走样）|
| G4 | 风场/3D/rpx/dock | 小程序为移动简化，网页有更优物（GPU 流线/Cesium/座舱） | **不倒灌**（档案第 15 章）|
| G5 | 预警 4 级配色 / 详情锚点 / GBK 等 | 网页无对应 UI 或实现不同 | 按需定点，不整体搬 |

---

## 建议优先级（供你选择落地顺序）
- **P0（体验明显、风险低）**：D1/E1 玻璃层级+性能降级、B1 组主开关+solo、C2 后台暂停动画。
- **P1（规范化+美化，观感提升大）**：C1+D2 令牌体系、D4 统一微交互、D3 骨架屏。
- **P2（打磨）**：A1 面板过渡、D5 空态美化、E2 按需渲染、F1 状态去重、A2 键盘导航。
- **不移植**：G4（移动特化）。

## 执行约定（后续）
1. 每项独立做：先出 diff 说明改动文件+验收点 → 改 → `node --check`/单测 → 重启 4173 或 CDP 截图/feel-check → 写 `PROGRESS.md`。
2. 每修完一项发一条结果消息；不并行铺开、不一次性大改。
3. 视觉类需 `prefers-reduced-motion` 与低配降级双保险。
