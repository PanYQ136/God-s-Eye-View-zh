# Phase 3 实施报告：旧 App UI/CSS/布局退场，`src/lc` 成为唯一所有者

- 日期：2026-10-29
- 卡片：`t_35c3cbfa`（Kanban / design 板）
- 工作区：`D:\Hermes\gods-eye-view`（唯一 canonical，另一份工程副本未触碰）
- 依据：《上帝之眼-旧代码冲突清单-20261029.md》《上帝之眼-新问题P表3-20261029.md》《上帝之眼-未解决P表-20261029.md》
- 未提交 git（按要求）

---

## 一、删除了什么（不是隐藏，是退场）

| 旧物 | 处置 | 位置 |
|---|---|---|
| 折叠按钮 DOM（`+ / ◀ / ▶`） | 模板里整行删除，4 个模板零残留 | `src/ui/templates/{layer-panels,context,display-controls,command-dock}.html` |
| `_syncPanelCollapseButton` / `_restorePanelCollapsedState` 的 7 卡部分 | 方法改名 `_syncPanelDisclosureState`，只同步 dock 把手 aria；7 卡不再被 App 查询/写 DOM | `src/ui/panelChrome.js` |
| `bindPanelDisclosure` 绑定层 | 整个函数删除；只留 `collapsePanelOnEscape` / `createHoverDisclosure` | `src/ui/panelDisclosure.js` |
| 旧自由拖拽 / 缩放 / z 轴提升 / 位置持久化 | `panelPositionControls.js` 从 12,350 字符重写为 85 行，只剩披露持久化 + 一次性重置提示 | `src/ui/panelPositionControls.js` |
| 旧轨道对 7 卡写几何 | `leftPanelRail` / `rightPanelRail` 过滤 `.gev-lc`，只剩 lc 卡时直接 return，不写 `--*-stack-safe-*` | `src/ui/leftPanelRail.js`、`rightPanelRail.js` |
| 旧轨道把 lc 卡当 obstacle | 从 obstacle 列表移除 `#location-bar`/`#control-panel`/`#gev-voice-control`/`#pp-toggles` | `src/ui/panelLayoutController.js` |
| 旧玻璃材质 | `lg-glass.css` 删除 + `style.css` 的 `@import` 删除 + `.lg-glass-menu` 规则删除 | `src/ui/styles/lg-glass.css`（已删）、`style.css`、`mobile-portrait.css` |
| 旧折叠按钮样式 | `controls.css` / `command-dock.css` / `cyber.css` 里 `.panel-collapse-btn`、`.pp-collapse-btn` 全清 | 同上 |
| 旧命名/注释 | `gev-liquid-cards`、`gev-gl-glass`、`lgGlass` 全部清除 | `viewer.js`、`lc/morph.js`、`gev-panel-win.js` |
| 旧边缘折射 | `gev-edge-lens.js` 收敛成单层极淡上沿高光（`dispPx:0 / innerDark:0 / gain:0 / blurPx:0`） | `public/gev-edge-lens.js` |

App 侧只剩一个最小兼容面：`window.__lcPanelApi.setPanelCollapsed(id, collapsed, options)`，供 `CollapsePort`（Esc、旧入口、分享恢复）调用。

---

## 二、这一轮真正修掉的 4 个 bug（都是实测打出来的）

### 1. 展开盒比槽位低 96px（左轨）

- 现象：`data-panel` 展开落在 `y=190`，而 mini 槽位在 `y=94`；scene 被推开、T2/T4 直接失败。
- 根因：把 `liftRails` 从 `translate` 改成写 `--left-stack-safe-top`。轨道有 `transition: top`，变量改写让轨道用 200–300ms 从 190 滑到 94，而 `src/lc` 的**槽位测量正好发生在过渡中间**，`slotCache` 把 190 记成槽位并长期复用。
- 改法：`liftRails` 回到瞬时 `translate`（不参与布局、无过渡），按当前 rect 求差保持幂等；并在 translate 真的变化时 `slotCache.clear()`（这是软件渲染轮 T19 也会踩的同一个坑：SwiftShader 下第一帧测量早于 lift，pp 槽位被写成 190 → cctv 槽位 248 → 点不中）。
- 验证：T2 `320×380@(52,94)` PASS；T4 PASS；T19 软件渲染轮 PASS。

### 2. mini 高度 41/74 破坏槽位节奏（删按钮的副作用）

- 现象：`data-panel` mini 从 48 掉到 41（T3「逐像素回原位」失败）；给标题条加 `min-height:48` 后又涨到 74（卡里还有 App 的 `.*-panel-inner` 24px 正文）。
- 根因：过去是折叠按钮把标题条撑到 20px+间距=48；按钮删掉后没人定高，卡高由内容决定。
- 改法：`src/lc/material.css` 给 5 张轨道卡的标题命中面 `min-height:48px`，左轨两张卡 mini 相位 `height:48px; overflow:hidden` + 标题 `margin-bottom:0`。**不给 dock 三卡加**——语音卡 mini 是 86px 的 grid 芯片行，强行 48 会把「关」状态挤到卡外（实测 y=604 vs 卡顶 616）。
- 验证：T1/T3/T4 PASS；语音卡「关」回到卡内 y=621。

### 3. 中/EN 被 GPU chip 盖住点不动（P0-6）

- 现象：`#gev-lang-toggle` 在 `[846,575]`，`#gev-perf-wrap` 在 `[688,575,394,31]`，lang 的 z-index 151 < wrap 的 2147482000 → `elementFromPoint` 命中的是 GPU chip，中/EN 完全点不到。
- 根因：三个控件用 `left:50% + 固定 margin-left` 定位，而 perf wrap 加了 GPU chip 后从 ~230px 涨到 394px，`margin-left:78px` 就落进 chip 盒子里了。
- 改法（两轮，都留了注释）：
  1. 先改右锚定链式排布 → 性能条右端伸到 x≈1213，压进右轨展开卡矩形（右轨 x≈1144），Layout 把 cctv 顶上去 15px → 反过来压住 pp 的 mini（`mini-overlap 1214`，T6/T14 红）。**这就是「修一个 P0 引出另一个 P0」的真实例子。**
  2. 最终：整排待在右轨左侧 8px，从右往左 `中/EN → 性能 → 定位`，性能条 `max-width:560px`、GPU chip `max-width:320px` 超长省略号；≤720px 时性能条独立成第二行（原来 375 下 wrap 353px 溢出视口、`left/right` 同时生效把中/EN 拉成 347×670）。
- 验证：G5 在 1536 / 1280 / 375 三档 `overlap=false` 且两个控件 `elementFromPoint` 都命中自己；T6/T14 恢复零违规。

### 4. 显示卡（pp）行距 6px、拥挤（P0-5）

- 现象：`.pp-toggle-group` gap 6px，`G4` 判定「行 gap≥8」不达标。
- 改法：open 相位 `gap: 8px`（分组 + 两列表内行），行 `min-height:30px` 保持。
- 验证：G4 PASS（17 行、7 组、零重叠、滚到底末项可见）。

---

## 三、护栏测试（新增 `scripts/lc/phase3-guards.mjs`）

全部用真指针 / `getBoundingClientRect` / 文本扫描，截图只作人工证据。

| 项 | 判据 | 结果 |
|---|---|---|
| G1 | `.panel-collapse-btn / .pp-collapse-btn / [data-collapse-target]` = 0 | PASS |
| G2 | 卡片与侧轨内可见文本不含 `+ ◀ ▶`（地图版权、性能条 `+10` 属正文，已按可见性 + 内容白名单排除） | PASS |
| G3 | 点开位置面板前后，左右 rail 卡 rect 差 ≤1px（P0-3） | PASS |
| G4 | pp 展开：同组行 gap ≥8、零重叠、滚到底末项可见（P0-5） | PASS |
| G5 | 中/EN 与 GPU chip 不重叠且各自可点（1536/1280/375，P0-6） | PASS |

`=== 5/5 PASS ===`

## 四、既有验收回归

- `node scripts/lc/phase2-accept.mjs` → **20/20 PASS**（真指针开合、互斥、让位、Esc、键盘、滚轮、21 组跨组双开、8x 边缘剖面、GPU/软件双轮、FPS、动画时长/峰值）。
  收尾时同一份代码再跑是 **19/20**，唯一红项是 T16 的 FPS 门槛（实测 18–25fps / p50 54ms）：同期 `nvidia-smi` GPU 利用率 **0%**、显存 100MB、可用内存仅 **2.06GB/15.78GB**——是宿主内存紧张导致的 rAF 掉帧，不是渲染回归（同一构建早前实测 63.7 / 111.1fps、p50 6.2–12.2ms）。这一点已如实记录，不做粉饰。
- 本轮为了让现实验收在「忙机器」上稳定，改了 `scripts/lc/phase2-accept.mjs` 的**测量**部分（不动任何产品断言）：`waitPhase/waitQuiet/waitSettled` 3s→8s、`armMeasure` 2s→8s、`waitSettled` 额外要求 DOM `data-lc-phase` 与状态机相位一致（T7 曾因差一帧假红）、开跑 `page.bringToFront()`、加 `--disable-features=CalculateNativeWinOcclusion`（Windows 遮挡检测会把被盖住的窗口降到 ~18fps）。
- `npm test` → **5148 tests / 5104 pass / 34 fail**；34 条全部落在 10 个服务端 provider 测试文件（`proxyErrorResponses`、`transitProvider`、`liveProviders`、`firmsProxy`、`spaceProviders`、`nominatimSearchRoute`、`environmentProviders`、`regionalProxy`、`cyclonesProxy`、`viteBuild`）。**已用 `git stash` 在干净基线上复跑同一批文件，同样失败 → 与 Phase 3 无关（仓库自带问题）。**
- `npm run check:boundaries` → 仍有 `live-observations imports an unowned module: src/sources/live/resilientFetch.js`（基线同样存在，未触碰该文件）。
- `npx prettier --check` 对本轮改动的 22 个文件 → 全部通过；仓库全局 `npm run format:check` 仍红（58 个未触碰文件，基线问题）。
- 8x 边缘剖面（T18）：顶沿 1 条 1px 高光，底/左 0 条亮脊，色散 0 → P0-1 / P0-4 达标。
- GPU（T15/T16）：真实 renderer `ANGLE (NVIDIA GeForce RTX 3060 Laptop GPU)`、`tier=high`、FPS 63–111、p50 6.2–12.2ms；软件轮 `SwiftShader → tier=software + chip「GPU 未启用」+ 不建 edge canvas`（P0-7）。

## 五、未做 / 留给后续

- `P1-5 两个工程副本`：按要求没动 `D:\Hermes\上帝之眼工程\gods-eye-view`，只把 `D:\Hermes\gods-eye-view` 当唯一工作区。
- `P2-2 Hermes source-update 锁 / 旧 dashboard`：属于 Hermes 运行时，不在本仓库范围；本轮任务能正常跑完，不再阻塞。
- 仓库自带的 34 条服务端测试失败 + 全局 format/boundary 红灯：历史遗留，建议单独开卡。
- 未提交 git。

## 六、产物

- 护栏脚本：`scripts/lc/phase3-guards.mjs`（可重复跑）
- 证据脚本：`scripts/lc/_diag/shoot-phase3.mjs`
- 截图：`.gev-logs/lc/p3-{mini,data-open,pp-open,loc-open,status-band}.png`、`.gev-logs/lc/edge-*-{4x,8x}.png`
- 结构化结果：`.gev-logs/lc/phase2-accept.json`、`.gev-logs/lc/phase3-guards.json`
