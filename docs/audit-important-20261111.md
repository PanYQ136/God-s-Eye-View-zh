# #9 `!important` 分类登记（收口裁定）

> 依据：`D:\Hermes\backups\gev-important-audit-20261110\DECISION.txt`（#9 收口裁定）、`important-audit.mjs` v2（只读分类审计）、`BASELINE.txt`（2026-11-11 实测复跑）。
> 方法：只读扫描 `src` + `public`（1239 文件，排除 `*.test.*`），逐处取 `file:line` + 属性 + 选择器锚点，按测试契约 / 合规语义 / 层叠竞争三级分类。
> 日期：2026-11-11 · 范围：全仓 `!important` 分类登记，**本轮不改任何 CSS**。
> 原则：这份文档是**登记**，不是欠债清单。LOCKED 与 PROTECTED 永久保留并注明理由；REDUNDANT 只是静态低风险候选，禁止据其批量删除。

---

## 0. 结论

1. 清单里「`!important` 168 处清到个位数」这个目标**不成立**，本轮正式废止。
2. `!important` 在 GEV 里承担三种不可移除职能：**测试契约的可见性契约**（27 处）、**合规/a11y/状态语义**（64 处）、**unlayered 压 layered 的层叠机制**（部分落在 REVIEW/REDUNDANT）。
3. 剩余 `!important` **不是技术债**，是既有层级机制的显式声明。数量不再作为指标。
4. 若将来仍要减数量，只走 §8 的窄流程（每批 1-3 处 + 说出被压制的具体声明 + 双主题 computed-style 前后对比 + 单测全绿），三者缺一不得提交。

---

## 1. 实测基线（2026-11-11 复跑）

命令（PowerShell 5.1 无 `??`，日志统一走 `cmd /c` 重定向，不要用 `*>`）：

```
"C:\Program Files\nodejs\node.exe" D:\Hermes\backups\gev-important-audit-20261110\important-audit.mjs D:/Hermes/gods-eye-view > BASELINE.txt 2>&1
```

| 项 | 实测值 |
|---|---|
| 退出码 | `EXIT=0` |
| 扫描范围 | src + public，1239 个文件（已排除 `*.test.*`） |
| 总计 | **167 处 / 28 文件** |
| LOCKED（测试锁定） | **27** |
| PROTECTED（保留） | **64** |
| REVIEW（逐处核） | **54** |
| REDUNDANT（候选） | **22** |
| 测试断言中与 `!important` 同段的选择器锚点 | 37 个 |
| BASELINE.txt 校验 | `SHA256 80549884BD82E7849C59E4137FFE877610D5313812282B50E51B2449F3CCE61C`，8810 B |

计数口径说明：全仓 grep 口径为 173 处（`src/ui/styles` 146 + `public` 22 + JS 内联 5）；审计工具口径 167 处，差值 6 处是 `*.test.*` 里的断言文本，不是产品声明。**两个数字都对，口径不同，不要混用。**

---

## 2. 分类口径（important-audit.mjs v2）

| 分类 | 判据（源码位置） |
|---|---|
| LOCKED | 值级硬约束 `outline: 2px solid var(--text-primary)` / `z-index: 200`，或选择器命中测试断言锚点且属性为 `display|visibility|opacity|pointer-events`（`important-audit.mjs:90-95`） |
| PROTECTED | 选择器命中合规/a11y/状态语义词表（`important-audit.mjs:58`）、或属性为 `outline|z-index`（`:59`）、或位于 `@media`/`@layer` 内（`:97`） |
| REDUNDANT | 同文件内该属性仅 1 次出现且不属于 `display|visibility|opacity|pointer-events`（`:98`） |
| REVIEW | 其余，必须逐处确认层叠竞争者（`:99`） |

v2 相对 v1 的关键修正：v1 用「测试正则含属性名」判 LOCKED，误标 112 处；v2 改为**选择器锚点 + 值级硬约束**。工具已定版，**不要再"优化"口径**。

---

## 3. LOCKED 27 处 —— 永久保留

删除即破测试，除非同步改测试契约。逐条：

| # | 位置 | 属性 | 值 | 选择器（截断） |
|---|---|---|---|---|
| 1 | `src/ui/styles/bhote-koshi.css:333` | display | none | `#right-context-rail.bhote-event-active > :not(#bhote-koshi-event-p…)` |
| 2 | `src/ui/styles/cockpit.css:1997` | display | none | `body.cockpit-mode #left-panel-stack > #scene-panel` |
| 3 | `src/ui/styles/cockpit.css:2002` | display | none | `body.cockpit-mode #utilities-panel .utilities-tools` |
| 4 | `src/ui/styles/cockpit.css:2005` | display | none | `body.cockpit-mode #right-context-rail` |
| 5 | `src/ui/styles/cockpit.css:2074` | display | none | `body.cockpit-mode .cockpit-signal-window` |
| 6 | `src/ui/styles/cockpit.css:2077` | display | none | `body.cockpit-mode #right-context-rail` |
| 7 | `src/ui/styles/command-dock.css:235` | display | inline-flex | `#cesium-credits a[style]` |
| 8 | `src/ui/styles/command-dock.css:251` | opacity | 0 | `body.recording-mode #command-dock` |
| 9 | `src/ui/styles/command-dock.css:252` | visibility | hidden | `body.recording-mode #command-dock` |
| 10 | `src/ui/styles/command-dock.css:253` | pointer-events | none | `body.recording-mode #command-dock` |
| 11 | `src/ui/styles/controls.css:1182` | opacity | 0 | `body.ui-clean-view #scene-panel` |
| 12 | `src/ui/styles/controls.css:1183` | visibility | hidden | `body.ui-clean-view #scene-panel` |
| 13 | `src/ui/styles/controls.css:1184` | pointer-events | none | `body.ui-clean-view #scene-panel` |
| 14 | `src/ui/styles/foundation.css:151` | outline | `2px solid var(--text-primary)` | `…:focus-visible` |
| 15 | `src/ui/styles/foundation.css:426` | z-index | 200 | `.cesium-credit-lightbox-overlay` |
| 16 | `src/ui/styles/layers.css:320` | opacity | 0 | `body.recording-mode .gev-panel-rail` |
| 17 | `src/ui/styles/layers.css:321` | visibility | hidden | `body.recording-mode .gev-panel-rail` |
| 18 | `src/ui/styles/layers.css:322` | pointer-events | none | `body.recording-mode .gev-panel-rail` |
| 19 | `src/ui/styles/layers.css:1296` | opacity | 0 | `body.recording-mode #right-context-rail > [data-panel-id]` |
| 20 | `src/ui/styles/layers.css:1297` | visibility | hidden | 同上 |
| 21 | `src/ui/styles/layers.css:1298` | pointer-events | none | 同上 |
| 22 | `src/ui/styles/recording.css:20` | opacity | 0 | `body.recording-mode #scene-panel` |
| 23 | `src/ui/styles/recording.css:21` | visibility | hidden | `body.recording-mode #scene-panel` |
| 24 | `src/ui/styles/recording.css:22` | pointer-events | none | `body.recording-mode #scene-panel` |
| 25 | `src/ui/styles/weather.css:245` | opacity | 0 | `body.recording-mode .gev-wind-inspection-marker` |
| 26 | `src/ui/styles/weather.css:246` | visibility | hidden | 同上 |
| 27 | `src/ui/styles/weather.css:247` | pointer-events | none | 同上 |

**保留理由（永久）**：

- 第 2-6 条对应 `cockpitMarkup.test.mjs` 的 7 处 `display:none !important` 断言（座舱模式必须隐藏 chrome）。
- 第 8-13、16-27 条对应 `cyberTheme.test.mjs` / `panelStackLayout.test.mjs` / `mobileShell.test.mjs` 的录制/净屏隐藏态断言：录制与净屏模式下元素必须**同时**不可见、不可点、不进无障碍树，三者缺一就会被"看到但点不到"或"点到但看不到"破坏。
- 第 14 条被 `keyboardFocusStyles.test.mjs:35` 断言：全局焦点环不得被任何局部 `outline:none` 擦除，a11y 硬约束。
- 第 15 条被 `firstRunExperience.test.mjs:348` 断言：Cesium credit lightbox 的合规层序。
- 第 1、7 条为测试锚点命中（`important-audit.mjs:93`），动之前须先读出对应测试断言，不能凭静态判断。

---

## 4. PROTECTED 64 处 —— 永久保留

判据见 §2（`important-audit.mjs:58-59,97`），四类理由：

1. **合规**：`cesium-credit` / `credit-lightbox` —— Cesium 版权署名必须始终可见可交互。
2. **a11y**：`focus-visible` / `screen-reader` / `sr-only` / `visually-hidden` / `prefers-reduced-motion` / `prefers-contrast` —— 焦点环、屏读文本、减动效偏好不得被局部位级覆盖。
3. **状态语义**：`recording-mode` / `ui-clean-view` / `cockpit-mode` / `scene-playback-mode` / `mobile-shell` / `data-rail-measuring` —— 模式切换的可见性契约。
4. **层叠机制**：`outline`、`z-index` 属性本身，以及任何位于 `@media` / `@layer` 内的声明 —— 未分层（unlayered）要压过 `@layer` 的既有设计，去掉 `!important` 等于放弃压制。

按文件分布（合计 64）：

| 文件 | PROTECTED |
|---|---|
| `src/ui/styles/mobile-portrait.css` | 22 |
| `src/ui/styles/mobile-shell.css` | 12 |
| `src/ui/styles/layers.css` | 9 |
| `src/ui/styles/foundation.css` | 6 |
| `src/ui/styles/ai-chat.css` | 5 |
| `src/ui/styles/cyber.css` | 4 |
| `src/ui/styles/first-run.css` | 4 |
| `src/ui/styles/command-dock.css` | 1 |
| `src/ui/styles/command-dock-trays.css` | 1 |

`mobile-portrait.css` 的 22 处（实测行 28-136）全部位于文件内**唯一**的媒体查询作用域：

```css
@media (max-width: 760px), (max-height: 480px) and (pointer: coarse) {
```

即"窄宽 或 矮高+粗指针"两类移动端形态共用一套竖屏布局，必须压过桌面态声明。这是移动端形态判定的集中作用域，不是散落的补丁。

---

## 5. REVIEW 54 处 —— 待逐处核实，不是欠债

54 处分布：`cockpit.css` 7、`mobile-shell.css` 6、`gev-cn.css` 5、`layers.css` 4、`panel-surfaces.css` 4、`command-dock-sliding.css` 3、`gev-fix.css` 3、`command-dock.css` 2、`bhote-koshi.css` 2、`weather.css` 2、`command-dock-compact.css` 2、`rtl.css` 2、`gev-panel-win.css` 2、`cyber.css` 1、`foundation.css` 1、`ai-chat.css` 1、`gev-material-override.css` 1、`recording.css` 1、`annotations.css` 1、`embed.css` 1、`recent-imagery.css` 1、`scenes.css` 1、`src/gev-cn-weather.js` 1。

含义：**该属性在同文件内存在多个声明或属于状态类属性**，静态无法判定谁是真实竞争者。要动必须走 §8。

---

## 6. REDUNDANT 22 处 —— 不可批量删（含 4 处已核实反例）

静态判据是"同文件内该属性仅出现 1 次"，**判不出跨文件、跨 `@layer`、跨 `@media` 的竞争者**。已核实其中至少 4 处是有意层叠压制：

| 位置 | 属性 | 该 `!important` 实际压制谁 |
|---|---|---|
| `public/gev-cn.css:27` | `border-color` | 压 Cesium 未分层样式（`.first-run-launcher`） |
| `public/gev-material-override.css:55` | `flex-basis: 0` | 压补丁层（`#command-dock .dock-popover-content .style-btn`） |
| `public/gev-cn.css:74-75` | `scrollbar-width` / `-ms-overflow-style` | 全局隐藏滚动条（`.rail-card`） |
| `src/ui/styles/cyber.css:1475-1477` | `--hud-color` / `--hud-glow` / `--hud-border` | cyber 主题变量覆盖（`#intel-hud[data-variant='cyber']`） |

结论：**禁止据 REDUNDANT 22 处批量删 `!important`**。这是 Step A「数值相等 ≠ 语义相同」教训的直接延伸。

---

## 7. 一个必须纠正的误读

`src/creditAttribution.test.mjs:613` **不是"全仓禁 `!important`"**。它只审 `style.css` 里 `GUARDED_PROPS` 盯上的**版权行 keep-out 规则**，其 `!important on <prop>` 是 fail-closed complaint（宁可报错也不放过）。据此推断"仓库不允许 `!important`"是错的，也不会因此去清其他文件的声明。

---

## 8. 将来若仍要减数量：窄流程（缺一不得提交）

每批 **1-3 处**，一次提交，且必须同时给出：

1. **压制对象**：该 `!important` 压制的**具体声明**是谁，写到 `文件:行号`（不是"应该没人竞争"）。
2. **浏览器证据**：改前/改后 `getComputedStyle` 逐元素对比，覆盖 **双主题（default / cyber）× 座舱 / 录制 / 净屏模式**。探针元素必须挂到 `document.body` 再取样式，挂未入文档容器读到空串。
3. **单测**：相关定向单测全绿。

优先可试（纯排版值，**仍需实测**，不是直接删）：

| 候选 | 属性 | 注意 |
|---|---|---|
| `src/ui/styles/cjk.css:13` | `letter-spacing: 0.02em` | 中英混排字距，需比对 CJK/拉丁两端 |
| `src/ui/styles/cockpit.css:1701` | `font-size: var(--fs-sm)` | 座舱信号卡箭头，token 可能被主题覆盖 |
| `src/ui/styles/cyber.css:619` | `font-size: 0` | **有主题覆盖，必须双主题都测** |

---

## 9. 复现与工具

| 项 | 说明 |
|---|---|
| 审计命令 | `node important-audit.mjs <repo-root>`（只读，不改文件） |
| 工具位置 | `D:\Hermes\backups\gev-important-audit-20261110\important-audit.mjs`（v2，已定版） |
| 基线快照 | 同目录 `BASELINE.txt`（167 / 27 / 64 / 54 / 22，SHA256 见 §1） |
| 裁定原文 | 同目录 `DECISION.txt` |
| Node | v26.13.0（`.gev` 全量单测亦要求 26.13.0；26.7.0 会出 2 fail / 28 cancelled 假失败） |

---

## 10. 与 #11 的关系（避免互相误读）

`#11`（z-index 阶梯）已收口：12 条 `--z-*` 定义、22 处引用 0 错配，剩余 **114 处 `z-index` 字面量是有意保留**，不是欠债，理由见 `D:\Hermes\backups\gev-z-audit-20261110\STEP3-CLOSURE.txt`。

本文档 §4 把 `z-index` 属性本身列为 PROTECTED 理由之一（层序由 12 条 `--z-*` token 与新语义共同治理），两处口径一致：**字面量保留 ≠ 未迁移完成**。

---

## 11. 变更记录

| 日期 | 内容 | 回滚 |
|---|---|---|
| 2026-11-11 | 本文档首建：登记 167/27/64/54/22 基线，废止"清到个位数"目标，固化窄流程门槛。**未改任何 CSS** | 删除本文件，并在 `PROGRESS.md` 删除 2026-11-11 条目 |
