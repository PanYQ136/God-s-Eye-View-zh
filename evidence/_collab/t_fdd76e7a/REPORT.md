# t_fdd76e7a · Figma iOS 27 Liquid Glass（Regular · Medium）材质层落 GEV

日期：2026-10-27 · 分支状态：**未提交 git**（`public/gev-liquid-cards.css` 仍是未跟踪文件，只在其尾部新增 §12）

---

## 0. 结论（先看这个）

- 已把 Figma `Liquid Glass - Regular - Medium` 的 CSS（Dark / Light 两套 fill、stroke、outer shadow、inset highlight）映射成 GEV 的 `--lgm-*` 变量 + §12 材质类，应用到 **9 张 `.gev-lc` / dock 托盘 / 按钮开关 / 悬浮 chip / FAB**。
- **只改绘制**：卡片、托盘、按钮、chip 的几何（14 个 UI 元素 + 9 张卡）在「材质开 / 关」两种状态下逐字段相同（maxDelta 0，`mismatches 0`）；`backdrop-filter: blur(6px) saturate(140%)`、`corner-shape: squircle`、边缘折射环（`gev-edge-lens.js`）全部保留未动。
- 交互零回归：7 张卡单独展开 + 18 个组合展开，与改材质**之前**的那次审计结果逐字段完全相同（overlap=0、restore 精确复原、`console errors 0`）。
- 可读性：暗场卡片文字 **10/10 ≥4.5（最差 5.24）**；亮底走探针 bright 档 **10/10（最差 6.28）**；纯白 worst-case 人造场景标题仍 ≥4.5，只有 App 青色强调小字 3.1–4.2（记录在 §7 取舍）。
- 没照抄 `border-radius: 34px`（半径归 t_3e129970 的 squircle 管，一个没动），也没照抄 Figma 的 `0.9 alpha 渐变层`（叠出来就是不透明，会把玻璃盖成实色）。

---

## 1. Figma → GEV 变量表（`public/gev-liquid-cards.css` §12）

| Token | Dark（默认） | Light（`html[data-gev-mat="light"]`，默认关） | Bright 亮底兜底（`html[data-gev-glass-lum="bright"]`） |
|---|---|---|---|
| `--lgm-fill` | `rgba(26,26,26,.62)`（Figma .72，−.10 保通透） | `rgba(255,255,255,.70)` | `rgba(14,14,16,.76)` |
| `--lgm-stroke`（0.5px 全圈） | `rgba(166,166,166,.55)`（Figma `#A6A6A6`） | `rgba(219,219,219,.80)`（`#DBDBDB`） | `rgba(200,200,200,.62)` |
| `--lgm-hi`（±1.25px 侧高光） | `rgba(166,166,166,.55)` | `rgba(219,219,219,.90)` | `rgba(210,210,210,.62)` |
| `--lgm-drop`（外阴影） | `0 8px 48px rgba(0,0,0,.45)` | `0 8px 48px rgba(0,0,0,.25)` | 同 Dark |
| `--lgm-in-a / --lgm-in-b`（Glass Effect 顶/底内影带） | `rgba(26,26,26,.55)` | `rgba(40,40,40,.55)`（Figma `#282828`） | 同 Dark |
| `--lgm-band` | `10px`（Figma 40px@160 ≈ 25% 高 → 43px 卡取 10px≈23%，blur 等比 3.5px） | — | — |
| `--lgm-tray-band` | `18px`（托盘体量大） | — | — |
| `--lgm-glare`（顶沿 1px 内高光） | `inset 0 1px 0 rgba(255,255,255,.10)` | `…rgba(255,255,255,.55)` | 同 Dark |
| `--lgm-btn-fill` / `-hover` | `rgba(26,26,26,.38)` / `.46` | `rgba(255,255,255,.60)` / `.72` | `rgba(14,14,16,.46)` / `.56` |
| `--lgm-btn-stroke` | `rgba(166,166,166,.38)` | `rgba(219,219,219,.85)` | 同 Dark |
| `--lgm-chip-fill` | `rgba(26,26,26,.62)` | `rgba(26,26,26,.62)`（chip 恒浮于地图，light 下也保持深色） | `rgba(14,14,16,.78)` |
| `--lgm-chip-stroke` / `-hi` | `rgba(166,166,166,.55)` | 同 Dark | 同 Dark |
| `--lgm-chip-drop` | `0 4px 20px rgba(0,0,0,.38)`（Clear 变体：小投影，无内影带） | 同 Dark | 同 Dark |
| `--lgm-tray-fill` | `rgba(26,26,26,.76)` | `rgba(255,255,255,.78)` | `rgba(14,14,16,.82)` |

box-shadow 的**层序照抄 Figma**（卡 / 托盘）：
`inset 顶带, inset 底带, 1.25px 左高光, -1.25px 右高光, 0 0 0 .5px 描边, inset 顶沿 glare, 0 8px 48px 外阴影`。

---

## 2. Figma 图层 → GEV 元件映射

| Figma 层 | GEV 落点 | 说明 |
|---|---|---|
| Dark · Fill + Shadow | `.gev-lc`（9 张：data/scene/pp/cctv/global/location/control/voice/fab） | `background: var(--lgm-fill)`；尺寸相关的内影带按 `--lgm-band` 缩，不自造新层 |
| Dark · Glass Effect | 同上（同一个 `box-shadow` 里） | 不额外加元素 —— 卡里已经有 `.gev-lg-warp` 承接真实磨砂，第二层会重复压暗 |
| Regular Dark | `.dock-popover-content`（control-panel ≈544×169、location-bar ≈544×119 两种托盘） | 填充 .76（Figma .72 + 托盘内小字可读性余量）；**边框只把颜色透明化，不删边框**（1px 盒尺寸不变） |
| Regular「轻量」 | `.pp-toggle-btn / .data-toggle-btn / .style-btn / .pp-mode-btn / .context-mode-button / .map-stack-chip / .search-toggle-btn / .lg-glass-skin / #gev-voice-button / .gev-voice-tier-btn / #control-panel-toggle` | 只取 fill + 0.5px 描边 + 1.25px 侧高光，**不加大阴影**；`:not(.active):not(.on):not([aria-pressed="true"])` 保护强调态 |
| Clear 变体 | `#gev-locate-btn / #gev-perf-fps / #gev-perf-btn(:not(.on)) / #gev-lang-toggle / #key-setup-chip` | 无内影带、`0.5px` 细描边、`4/20` 小投影；比托盘透（.62 < .76），比卡亮底档透 |
| 圆形 FAB | `#gev-gfx-fab` | 保持正圆（`corner-shape: round` 由 §10 保证），内影带 8px |
| — 不照抄 | `border-radius: 34px`、`background-blend-mode`、`.9 alpha` 渐变层 | 半径归 squircle 任务；blend 在浏览器里不可靠；.9 alpha 等于不透明，违反「不得覆盖成不透明」 |

---

### 2.1 一个必须单独修的坑：voice 卡（第 9 张）被 `gev-fix.css` 压住

`public/gev-fix.css:37` 有一条 `#command-dock > #gev-voice-control { box-shadow: 0 4px 14px … !important }`
（**双 ID** + !important）。单类 `.gev-lc` 的 !important 阴影赢不了它 → 首轮审计里这张卡仍是旧的
`rgba(8,31,42,.94)` + 旧阴影，等于「9 张卡只做了 8 张」。

修法：补一条同样双 ID + 类的覆盖

```css
#command-dock > #gev-voice-control.gev-lc { background: var(--lgm-fill) !important; box-shadow: …7 层… !important; }
#command-dock > #gev-voice-control.gev-lc:hover { …drop-hover 版… }
```

复验（`scripts/qa-final-invariants.mjs`）：9 张 `.gev-lc` 背景全为 `rgba(26,26,26,.62)`，阴影同为
`inset 0 10px 3.5px -10px rgba(26,26,26,.55) … 0 8px 48px rgba(0,0,0,.45)`；FAB 单独 `--lgm-band: 8px`
（其阴影确实是 8px 带，见下条注释）。

> 顺带发现：`--lgm-band` **不能**塞进 `--lgm-shadow-card` 这类自定义属性里 —— 内层 `var()` 会在声明处
> （`html`）就用 10px 算死，FAB 的 8px 覆盖失效。所以卡壳的 box-shadow 保持就地展开写法。

---

## 3. 实测：可读性（对比度）

方法：同一帧截图 + 每个文字盒内亮度中位数当底色，与声明色算 WCAG 对比度（`(max+.05)/(min+.05)`，与明暗顺序无关）。
「改造前」= 同一帧注入改造前的填充/描边/阴影（SIM_CSS，值取自首轮 `evidence/_collab/t_fdd76e7a/after/` 的 computed 实测），保证相机/位置/帧完全一致。

### 3.1 卡片文字（9 张卡内 ≤10 字的叶子文本）

| 场景 | 改造前 pass / worst | 改造后 pass / worst |
|---|---|---|
| 暗场（圣保罗，lum=dark） | 8/10 · **3.02** | **10/10 · 5.24** |
| 亮底·盐湖 + 探针 bright 档 | 5/10 · 3.03 | **10/10 · 6.28** |
| 纯白底 + 探针 bright 档 | 0/10 · 2.43 | **10/10 · 5.75** |
| Figma Light 变体（opt-in） | 0/10 · 0.55（白字白玻璃） | **10/10 · 5.23** |
| 亮底但探针未触发（冻结帧） | 7/10 · 3.58 | 9/10 · 4.25（仅 cyan「关」） |
| 纯白且探针未触发（人造） | 2/10 · 2.43 | 7/10 · 3.14（cyan 图标/小字，见 §7） |

### 3.2 悬浮 chip（定位 / FPS / 性能 / 中EN / 密钥，直接压地图）

| 场景 | 改造前 worst | 改造后 worst |
|---|---|---|
| 暗场 | 6.43 | **5.46**（6/6 ≥4.5） |
| 亮底 + bright 档 | 4.76 | **5.85**（6/6） |
| 纯白 + bright 档 | — | **5.58**（6/6） |
| 亮底但探针未触发 | 4.76 | 2.95（青色「定位 / EN」，记录于 §7） |
| 纯白且探针未触发 | 3.08 | 2.76（同上） |

### 3.3 dock 托盘内文字（展开态，压在盐湖亮底上）

| 托盘 | 改造后 | 改造前（同帧 SIM） |
|---|---|---|
| control-panel | **33/33 ≥4.5，最差 4.94**（`3D` cyan） | 33/33，最差 6.84 |
| location-bar | 7/8，唯一「不过」是黑色 emoji 字形 `🔎`（1.58，emitter 无关的 emoji 渲染） | 7/8，1.22（同一个 emoji） |

> 托盘比改造前**明显更透**了（旧 `.94` 近实色 → 新 `.76`，能看见底图），代价是 cyan 小字从 6.84 降到 4.94 —— 仍 ≥4.5。

---

## 4. 布局 A/B：只改绘制，不改几何

同帧测 9 张卡 + 14 个 UI 元素（卡壳/托盘/各类按钮/chip）的 rect、scrollWidth/clientWidth/scrollHeight/clientHeight，材质开 ↔ 关各测一遍（`report.json` 的 `ui` 数组逐元素比对）：

| 对比 | 卡片 rect 差异字段 | UI 元素 rect/溢出差异 |
|---|---|---|
| dark vs dark-before | **0 / maxDelta 0** | **14 个元素，mismatches 0** |
| bright vs bright-before | **0 / maxDelta 0** | — |
| white vs white-before | **0 / maxDelta 0** | **mismatches 0** |

关键设计（保证几何不动）：
- 按钮/托盘**不删边框**，只把 `border-color` 设透明（border-box 下删 1px 会让 auto 宽按钮缩 2px）；
- `box-shadow` / `background` 都参与布局以外的绘制，`backdrop-filter: none` 只对按钮（它们已叠在卡的磨砂上，多一层只会更糊更贵）；
- chip 的 `blur(20px) saturate(1.4)` **保留**（那是它自己的玻璃），只换 fill/描边/阴影。

---

## 5. 交互回归（展开 / 收起 / 滚动 / 命中）

`scripts/qa-expand-audit.mjs` 在**最终落盘的 CSS** 上重跑（`evidence/_collab/t_fdd76e7a/interact3/`），与改材质前的那次（`interact/`）逐项比对：

| 项 | 结果 |
|---|---|
| 7 张卡单独展开（overlap / hitOk / covered / cut / btnX / scrollable / bottomOk） | **7/7 状态、0 差异** |
| 18 个组合展开（同一 tick 连开，2 左栏 × 3 右栏 × 2 dock，正反序） | **18/18 状态、0 差异，overlap 全 0** |
| 全部收起后 rect 复原 | **restore 逐字段 identical = true** |
| 控制台错误 | **0** |
| 截图 | `combo-*.png` ×3（control 收窄到 298/318/338 的组合） |

---

## 6. 亮底自适应（真运行时，不冻结渲染循环）

`scripts/qa-lum-probe.mjs` → `evidence/_collab/t_fdd76e7a/probe-runtime/lum-probe.json`：

| 步骤 | 观测 |
|---|---|
| 暗场（圣保罗） | 3 次采样全部 `lum=dark`，卡 `rgba(26,26,26,.62)` / 托盘 `.76` / chip `.62` |
| 飞到乌尤尼盐湖 | **2.1s 内自动切 `bright`**：卡 `.76` / 托盘 `.82` / chip `.78` |
| 飞回暗场城市 | 10 次采样全部回 `dark`（卡 `.62` / 托盘 `.76` / chip `.62`） |
| 控制台错误 | 0 |

→ 亮底抖档是真实生效的，不是只写在 CSS 里。

---

## 7. 取舍记录（可读性优先，逐条说明）

1. **卡壳 Dark 用 `.62` 而不是 Figma `.72`**：.72 在暗场太实（看不见底图），.62 是「能看见底图 + 白字 ≥5」的交点。
2. **卡壳 Bright 用 `.76`（比 Figma .72 更实）**：雪地/盐湖白压白，.76 实测 10/10 ≥4.5（最差 6.28）；`.72` 没有单独再跑一轮（按 alpha 差估算约 4.0–4.3，余量不够），所以留 .76。
3. **托盘 `.76` 而不是 Figma `.72`**：托盘是密集小字 + cyan `3D` 标，.72 时 cyan 只有 4.37，.76 抬到 4.94。
4. **chip 用 `.62`，不是「更透的 .58」**：`.58` 在亮底把 cyan「定位 / EN」压到 2.4–2.6（改造前 `.72` 是 4.76）。Clear 变体靠「无内影带 + 0.5px 细边 + 4/20 小阴影 + 比托盘透」表达，不靠继续降 alpha。
5. **Figma Light 变体默认关**：GEV 是暗场 UI，白玻璃上 11px 白字只有 1.2:1。开启时同时翻转墨色（§12e：标题/按钮/voice 标签→`#0b1420`，图标→`#2a3a4a`），实测 10/10 · 5.23。仍保留的品牌 cyan（如 pp 头 `3D`）在 light 上偏低，属于 App 强调色体系，本次不改；`html[data-gev-mat="light"]` 需显式开启。
6. **探针读不到画面的场景**（QA 冻结渲染循环 / 人造纯白）：bright 档不会触发，此时 cyan 强调小字落在 2.8–4.2。改造前同一场景更差（2.43–3.58），且真实运行时探针 2.1s 内切档 —— 记录为已知边界，不为了人造 worst-case 把 chip 做成不透明。
7. **不照抄的 Figma 值**：`border-radius:34px`（胶囊化）、`background-blend-mode`（浏览器渲染不可靠）、`.9 alpha` 渐变层（=不透明，违规）。

---

## 8. 修改 / 新增文件

**改**：
- `public/gev-liquid-cards.css` —— 末尾新增 **§12 Figma Material**：
  - §12 token 三套（Dark / Light / bright 兜底）+ 应用块 12a 卡、12b 托盘、12c 按钮开关、12d chip（Clear）、12e Light 墨色、12f reduced-transparency 实色回退；
  - §2.1 的 voice 双 ID 覆盖（只在 §12 里新增，没去改 `gev-fix.css`）；
  - 未动 §1–§11（壳层、warp 磨砂、squircle、展开浮层、收窄 chip 自保等）。
- `scripts/qa-mat-audit.mjs` —— 审计脚本升级：chip/托盘文字也量对比度、加 14 个 UI 元素的 box/溢出快照、加 `bright-probe` / `white-probe`（MutationObserver 锁死 `data-gev-glass-lum`，等价「探针判定亮底」）、修对比度公式的明暗顺序 bug（旧版把深墨浅底的 12:1 报成 0.08）。

**新增（QA 脚本，均未进产品路径）**：
`scripts/qa-lum-probe.mjs`（真运行时探针验证）、`qa-voice-mat-probe.mjs`（voice 卡材质链路）、`qa-voice-css-why.mjs`（定位 gev-fix.css 双 ID 覆盖）、`qa-final-invariants.mjs`（9 卡不变量终检：bg/阴影/FAB 8px 带/warp blur/折射 canvas 在）、`qa-bright-check.mjs`、`mat-report-summary.mjs`、`mat-report-summary2.mjs`、`mat-tray-stats.mjs`、`mat-styles-dump.mjs`、`mat-cmp-interact.mjs`、`mat-compose-cmp2.mjs`、`mat-voice-cmp2.mjs`。

**未改**：`index.html`、`src/**`、`public/gev-edge-lens.js`、`public/gev-lg-filter.js`（折射/色散/位移图参数一字未动）。

## 9. 回滚

1. 删 `public/gev-liquid-cards.css` 第 12 节整段（从 `/* ══ 12) Figma iOS 27 · Liquid Glass` 到文件末尾 `@media (prefers-reduced-transparency: reduce)` 块结束）→ 立刻回到改造前的 0.52 壳 + 旧按钮/托盘材质，其它层（squircle / warp / 边缘折射 / 展开逻辑）不受影响。
2. 只想退一部分：删 §12a/12b/12c/12d/12e 中对应块即可（各块独立，互相不依赖）。

## 10. 证据文件（`evidence/_collab/t_fdd76e7a/`）

| 文件 | 内容 |
|---|---|
| `final3/report.json` + `final3-run.log` | 最终审计原始数据（9 个 phase 的 computed、对比度行、chip/托盘文字、14 元素的 box 快照、ring），`errorCount 0` |
| `final3-summary.json` / `final3-tray.json` / `final3-styles.json` | 上面数据的汇总（pass/worst、托盘、computed 样式） |
| `final3/v9-*-full.png`、`v9-*-left/right/dock/chips/fab.png` | 暗 / 盐湖 / bright 档 / 纯白 / Light 五种场景整页与局部截图（DSF=2） |
| `cmp/*.png` | 改造前 ↔ 改造后 上下对照：`card-left-dark`、`card-right-dark`、`tray-control-panel`、`tray-location-bar`、`chip-dark`、`chip-bright-probe`、`chip-white-probe-off`、`card-left-bright-probe`、`card-left-white-probe`、`fab-dark`、**`voice-card`**（第 9 张卡的双 ID 修复前后） |
| `interact3/expand-audit-after.json` + `interact3.log` | 交互回归（7 单开 + 18 组合 + restore，跑在最终 CSS 上）；`interact2/` 是同一脚本早一轮的存档 |
| `probe-runtime/lum-probe.json` + `runtime-salt-full.png` | 真运行时亮底探针（2.1s 切 bright，回暗场 10/10 dark） |
| `after/`、`before/` | 首轮基线（含改造前整体截图与数值），用于 §3 的「改造前」列 |

复现命令：
```bash
node scripts/qa-mat-audit.mjs evidence/_collab/t_fdd76e7a/final3 v9     # 材质审计（~3min）
node scripts/qa-expand-audit.mjs evidence/_collab/t_fdd76e7a/interact2  # 交互回归（~2min）
node scripts/qa-lum-probe.mjs                                       # 亮底探针（~1min）
node scripts/qa-final-invariants.mjs                                # 9 卡不变量
node scripts/mat-report-summary2.mjs evidence/_collab/t_fdd76e7a/final3/report.json
node scripts/mat-compose-cmp2.mjs evidence/_collab/t_fdd76e7a/final3 evidence/_collab/t_fdd76e7a/cmp v9
node scripts/mat-voice-cmp2.mjs
```
> 审计跑的就是当前落盘的 CSS（`final3` 在最后一次 CSS 修改之后跑的，跑完没有再改过规则）。

## 11. 已知遗留（不在本任务范围）

- cyan 强调色（`#00d4ff`）在亮底/纯白上天然偏低（4.2 / 3.1），要彻底解决得改 App 强调色体系或加不透明 scrim，会破坏 Figma 玻璃观感 —— 未做。
- `location-bar` 托盘里的 `🔎` 是 emoji（黑色字形），不受文字色控制。
- `#style-buttons` 预设条在 465 宽下第 5 个之后仍不可滚（t_f8d97c1c 记录的既有行为，与本次无关）。
