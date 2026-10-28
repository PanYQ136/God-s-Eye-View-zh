# scripts/lc —— 卡片层唯一验收台（真指针 / 真滚轮 / 真键盘）

全部结论来自 `getComputedStyle` / `getBoundingClientRect` / WAAPI 采样 / 页面内 MutationObserver，
**断言一律由真实 pointer / keyboard 触发**（CDP 合成输入，`isTrusted` 语义等同真机），不使用
`__gevLc.open()` 之类旁路；`api.dispatch` 在全脚本只有 **3 处**，全部是 teardown（把上一组留下的
展开卡按 ESC 收回 mini 基线），不参与任何判据。截图只作人工证据，判对错靠数值。

前置：`http://127.0.0.1:4173` 在跑（`npm run dev` 或已有 dev server）。

| 脚本 | 覆盖 | 产物 |
|---|---|---|
| `phase2-accept.mjs` | **T1–T20 全量验收**：初始全 mini、8 卡开/关/切换、互斥矩阵 21 组、快速连点、pp 滚轮归属、dock 单张与贴合、Esc/Enter/Space、地图空白点击、逐卡时长与峰值、GPU/软件降级、材质零描边、4x/8x 边缘剖面、FPS | `.gev-logs/lc/phase2-accept.json`、`edge-*-4x/8x.png` |
| `verify-single-owner.mjs` | `.collapsed` 唯一写入者：`port.writes` 增量 === 观测到的 class 变更数、`direct===0`、`appApiMissing===0`、语音卡零写入 | `.gev-logs/lc/single-owner.json` |
| `verify-topbar.mjs` | 死代码退役后复核：无 `#lg-glass-trigger/-menu`、无 `#gev-lg-svg`、无 `/gev-lg-filter.js`、`/gev-lg-dispmap.jpg`、`/gev-gl-glass.js` 请求、顶栏按钮无重叠、console error 0 | `.gev-logs/lc/topbar/` |
| `_diag/*` | 一次性诊断脚本（历史上的定位用，保留但不在验收链上） | — |

跑法：

```bash
node scripts/lc/phase2-accept.mjs                     # 全量
node scripts/lc/phase2-accept.mjs --only=T7,T13       # 单项
node scripts/lc/verify-single-owner.mjs
node scripts/lc/verify-topbar.mjs
```

单项 ID 速查：T1 初始态 · T2/T3 展开与归位 · T4/T5 同组让位 · T6 跨卡互斥 · T7 dock 形态 ·
T8 快速连点 · T9 滚轮归属 · T10/T11/T12 Esc/键盘/空白 · T13 逐卡时长峰值 · T14 21 组矩阵 ·
T15 GPU 判定 · T16 FPS · T17 卡壳材质 · T18 4x/8x 边缘剖面 · T19 软件降级 · T20 data→scene 并行切换。

单元测试（纯函数层，无浏览器）：`node --test src/lc/*.test.mjs`
