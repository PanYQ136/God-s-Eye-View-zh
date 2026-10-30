# t_3e129970 · iOS 连续圆角（squircle）：所有卡片 / 托盘

## 结论（实测）

- **9 张卡全部改成 iOS 连续转角**：`corner-shape: squircle` = 超椭圆 `|x|^n+|y|^n=1`，实测 **n≈4**（不是圆弧 n=2）。
- **半径一个都没动**：卡壳 16px、展开卡内层 8px（16−padding8，同心）、dock 托盘 6.72px（0.42rem）、`location-bar` 托盘 0px —— 改前改后 `border-radius` 完全相同，靠「角形」而不是「更大的半径」变柔和。
- **布局零变化**：9 卡 + 托盘的 `getBoundingClientRect` 在 A/B 两态**逐项完全相同**（`identical: true`）。
- **交互全部正常**：5 卡展开/收起高度精确复原，滚动生效，按钮命中并改变状态，展开卡滚到底最后一个子元素完全可见。
- 边缘折射环的 SDF 同步换成超椭圆，**角上不再出现「圆弧环 vs squircle 卡」的错位**（`cornerN` 由 computed `corner-shape` 推导，改回圆角时自动退回 n=2）。

## 改了哪两个文件

| 文件 | 改动 |
|---|---|
| `public/gev-liquid-cards.css` | 新增 §10（约 50 行）：`@supports (corner-shape: squircle)` 内给 `.gev-lc` / 内层（`.panel-inner` `.data-panel-inner` `.scene-panel-inner` `.cctv-panel-inner` `.global-context-panel-inner` `.location-inner` `.pp-panel-body`）/ `.gev-lg-warp` / `.gev-lc-ghost` / `.dock-popover-content` 加 `corner-shape: squircle`；`#gev-gfx-fab` 显式 `round`；外加 `@supports not (...)` 的同值 16px 回退。**没有一行改尺寸/材质/玻璃参数。** |
| `public/gev-edge-lens.js` | 新增 `sdShape()`（直边沿用圆角矩形 SDF，角区用超椭圆，一阶归一化成近似真距离）、`uniform float uCornerN`、`cornerExponent(cs)`（`superellipse(p)` → `n = 2^p`；无该属性/`round` → 2）、`stats().surfaces[].cornerN` 供验证。Snell/IOR/色散/带宽常量**一个没动**。 |

新增验收脚本（都在 `scripts/`，不影响产品路径）：
`qa-squircle-probe2.mjs`（隔离探针测角形指数）、`qa-squircle2.mjs`（审计 + A/B + 交互回归）、
`qa-squircle3.mjs`（展开卡 A/B）、`measure-squircle-raw.mjs`（真卡角轮廓采样）、`compose-squircle.mjs`（合成对比图）。

## 覆盖范围 & computed 实测

| 元素 | border-radius（前=后） | corner-shape |
|---|---|---|
| `#data-panel` `#scene-panel` `#pp-toggles` `#cctv-panel` `#global-context-panel` `#location-bar` `#control-panel` `#gev-voice-control` | 16px | `superellipse(2)` = squircle |
| 同上的内层（`.panel-inner` / `.data-panel-inner` …） | 16px（折叠）/ 8px（展开） | `superellipse(2)` |
| `.dock-popover-content`（control-panel 托盘） | 6.72px（0.42rem，原值） | `superellipse(2)` |
| `.dock-popover-content`（location-bar 托盘） | **0px（原生直角）** | `superellipse(2)`（对直角无效，也不给它加半径） |
| `#gev-gfx-fab`（正圆按钮） | 50% | `superellipse(1)` = round（保持正圆） |

## 证据

### 1) 角形指数（隔离探针，200px 块 / r=40 / 4×）
`probe-squircle.json`：`corner-shape: squircle` 轮廓拟合 **n = 4.09（RMSE 0.12px）**；`round` 拟合 **n = 2.02（RMSE 0.11px）**；
`superellipse(3)` → n = 8.32 → Chrome 的参数化是 **n = 2^p**（computed 里 squircle 显示为 `superellipse(2)`）。

### 2) 真卡角（16px + AA，白卡黑底、关环，逐行扫首个亮像素，30 行/角）
| 角 | 改动后拟合 n | RMSE | 同数据用「圆模型」RMSE |
|---|---|---|---|
| data-panel 左上 | **4.78** | 0.22px | 3.394px（差 15×） |
| cctv-panel 左上 | **4.24** | 0.122px | 3.117px |
| global-context-panel 左上 | **4.78** | 0.22px | 3.394px |

同样方法测「改动前」：n = **2.24 / 2.10 / 2.24**（RMSE 0.20–0.30px，圆模型 RMSE 0.34–0.71px）。
→ 见 `cmp-shape-math.png`：蓝点（改后）贴 squircle 曲线，红点（改前）贴圆曲线。

### 3) 视觉对比（同位置、同时刻、只改 corner-shape）
- `cmp-corners-4x.png` —— 4 张卡 × 前/后，44 CSS px 区域 4×（含右栏 `cctv-panel` 右上、`global-context-panel` 左下、`control-panel` 左上）。
- `cmp-corner-8x.png` —— `data-panel` 左上 30 CSS px 8× 特写：左边直边直接切进圆弧，右边直边→圆角连续过渡、转角更「满」。
- `cmp-expanded-4x.png` —— 展开卡（320×380，padding 8，内层 8px 同心）角部 4×。
- `cmp-full-1536x730.png` —— 1536×730 全屏 A/B（上=前，下=后）。单帧文件：`before-1536x730.png` / `after-1536x730.png` / `after-expanded-1536x730.png`。

### 4) 布局零变化
`squircle-report2.json → phases.layout`：两态 10 个矩形（9 卡 + `__tray`）**完全相同**，`identical: true`
（例：data-panel `[52, 93.9, 176, 42.8]`、pp-toggles `[1308, 93.9, 176, 50]`、location-bar `[530, 632, 168, 86]`）。

### 5) 角部命中区（渲染层真的换了形状）
在每张卡左上角 45° 方向、内缩 3.6px 处做 `elementFromPoint`（此点：squircle 内、同半径圆弧外）：

| | 改前 | 改后 |
|---|---|---|
| data-panel / scene-panel / pp-toggles / cctv-panel / global-context-panel | 卡外 | **卡内**（`.gev-lc-edge-nw`） |
| location-bar / control-panel / gev-voice-control | 卡内 | 卡内（这几个角原本就有子元素溢出，未受裁切影响） |
| gev-gfx-fab（圆） | 卡外 | 卡外（仍是正圆，符合预期） |

### 6) 交互不回归（`phases.interactions`）
- 5 卡 `open()` 后 `floating: true`，高度 380 / 340 / 430 / 412 / 354，`close()` 后回到 42.8 / 42.8 / 50 / 50 / 50 —— 与展开前**完全一致**（`restored: true`）。
- 滚动：data-panel / scene-panel / cctv-panel / global-context-panel `scrollTop` 均随滚轮变化；`pp-toggles` 内容不溢出（`canScroll: false`，无需滚动）。
- 按钮：`#pp-toggles` 里第一个可见控件 `centerHit: true`，点击后 className/`aria-pressed` 变化（`changed: true`）。
- 展开卡：`scrollable: true`，滚到底最后子元素 `bottomReachable: true`；横向越界 A/B **完全相同**（各 1 个 / 20px，改前就有，不是本次引入）。

### 7) 边缘折射环跟得上
`stats().surfaces[].cornerN`：9 卡全 **4**、FAB **2**；注入 `corner-shape: round` 后全变 **2**（= 旧行为，像素级不变）。
所以环的 SDF 与卡壳 CSS 轮廓同一条曲线，角上不会出现错位空档。

## 边界与说明

- **`#gev-gfx-fab` 保持正圆**：`border-radius: 50%` + `corner-shape: squircle` 会把圆压成「圆角方块」，它是按钮不是卡片，所以显式 `round`。
- **`location-bar` 的托盘原生 `border-radius: 0`**（直角，DOM 上它不在 `#command-dock` 内，所以没有 0.42rem 那条规则）：squircle 对直角无效，也**没有**给它加半径（加半径就是改设计）。`control-panel` 的托盘 6.72px 已生效。
- **不支持 `corner-shape` 的浏览器**：整块声明在 `@supports` 里，未知属性本身也会被丢弃；再给 `@supports not` 的**同值** 16px 回退 → 视觉零变化。`cmp-corners-4x.png` 的「前」列就是这条回退路径的实际渲染（+ 环自动退回 n=2）。
- **自动化环境的坑（与本次改动无关）**：puppeteer 里若放任性能模式把 Cesium `resolutionScale` 自动抬到 ≈1.46，全屏边缘环逐帧上传大纹理会把上下文拖垮（Cesium 报 fragment shader 失败、渲染停止）。本报告所有截图都在固定 `gev.gfx res=0.75` + 关闭性能模式自适应下拍（`dialogs 0`、`console errors 0`）；同一配置下 round / squircle 都正常，真机日常使用不受影响。

## 回滚

- 圆角回退：删掉 `public/gev-liquid-cards.css` 里 `/* ── 10) iOS 连续圆角 …` 到 `@supports not (corner-shape: squircle)` 块结束的整段 → 立刻回到普通圆弧，其它一切不动。
- `gev-edge-lens.js` 即使保留也能正确工作（读不到 squircle 就走 n=2 原路径）；要完全回旧版就把 `sdShape` / `uCornerN` / `cornerExponent` 相关几处去掉。
- 未提交 git（按要求）。

## 文件清单（`docs/_collab/t_3e129970/`）

`cmp-full-1536x730.png`、`cmp-corners-4x.png`、`cmp-corner-8x.png`、`cmp-expanded-4x.png`、`cmp-shape-math.png`、
`before-1536x730.png`、`after-1536x730.png`、`after-expanded-1536x730.png`、
`probe-squircle.json`、`probe-boxes-4x.png`、`squircle-report2.json`、`measure-raw.json`、`raw-*-2x.png`、`qa3.json`。
