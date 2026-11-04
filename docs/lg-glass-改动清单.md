# Liquid Glass 组件接入改动清单（2026-10-24）

> 任务来源：`Desktop\LiquidGlass-项目\官方LiquidGlass-CSS与上帝之眼适配任务包-合并版-20261024.md`
> 项目：`D:\Hermes\gods-eye-view`（Vite + 原生 JS + Cesium）

## 1. 改动文件

| 文件 | 类型 | 内容 |
|---|---|---|
| `src/ui/styles/lg-glass.css` | 新增 | 官方材质类 `.lg-glass` / `.lg-glass-btn` / `.lg-glass-menu` / `.lg-glass-backdrop`，含明暗变体、hover、按下、降级 |
| `src/ui/lgGlass.js` | 新增 | 组件挂载与交互（按钮插入 `#top-center-actions`、菜单浮层、遮罩、Esc/失焦关闭、明暗切换）；暴露 `window.__gevLiquidGlass` |
| `style.css` | 追加 1 行 | `@import './src/ui/styles/lg-glass.css';`（末尾，不改任何既有 import 顺序） |
| `index.html` | 追加 1 行 | `<script type="module" src="/src/ui/lgGlass.js"></script>`（含「删掉本行即完全还原」注释） |

**未改动**：`foundation.css`（z-index 区间 + 设计令牌）、`status.css`、`cockpit.css` 及任何既有组件样式与链路。

## 2. 材质参数落地对照（参数锁定，未改数值）

| 官方参数 | 本实现位置 | 值 |
|---|---|---|
| 磨砂 Frost 16 ≈ blur | `.lg-glass` `backdrop-filter` | `blur(22px) saturate(1.9)`（基准 160） |
| 罩层 Fill#2 | `.lg-glass` 背景第一层 | Light `rgba(255,255,255,.70)` / Dark `rgba(255,255,255,.35)` |
| 灰底 Fill#1 | `.lg-glass` 背景第二层 | Light `rgba(191,191,191,.10)` / Dark `rgba(255,255,255,.14)` |
| 内阴影 #1/#2 | `box-shadow` inset Y±40 Blur10 Spread-40 | `rgba(40,40,40,1)`（Dark 变体 alpha .5） |
| 内阴影 #3 | `box-shadow` inset Y40 Blur30 Spread-40 | `rgba(230,230,230,1)`（Dark 变体 alpha .5） |
| 投影 ×4 | `box-shadow` X±1.25 Spread.75 / Spread.5×2 | `rgba(219,219,219,1)`（Dark 变体 alpha .5） |
| 圆角 | `--lg-radius` | 面板 34 / 按钮 `--radius-md(12)` / 菜单 `--radius-lg(16)`（按任务第 4 条令牌化） |
| 描边 | 无 `border` | 官方描边=内阴影，实测 `border-width: 0px` |

### 缩放系数（仅缩放 px，不改材质）
| 组件 | 尺寸 | `--lg-scale` |
|---|---|---|
| 按钮 | 44×44 | 0.275 |
| 菜单 | 320×N | 2.0 |

### 新增变量（均为 `--lg-*` 前缀，未污染全局令牌）
`--lg-scale` / `--lg-radius` / `--lg-glow`

### 明暗模式说明（与任务包假设的差异）
项目实际**只有暗色主题**（`body` 上不存在 `.dark/.light` 类，foundation.css 亦无对应规则）。因此：
- 默认采用任务包第四节 **Dark（官方 Clear 变体）**：罩层 .35 + 底 .14 + 光晕/描边浓度减半；
- 提供 `.lg-glass--light` 修饰类承载 **Light 变体**（.70 罩层 + .10 灰底 + 全浓度光晕），菜单内「切换明暗变体」可实时切换，便于双变体验收；
- 未新增 `body.light/.dark` 全局主题机制（属底层主题链路，任务要求不动）。

## 3. z-index 归层

| 元素 | 层级 | 依据 |
|---|---|---|
| 玻璃按钮 | `--z-hud: 100` | 挂在 `#top-center-actions` 内，继承其 `z-index:100` |
| 点击关闭遮罩 | `199` | 面板(110) 之上、菜单(200) 之下，区间内数字，不抢层 |
| 玻璃菜单 | `var(--z-popup, 200)` | 二级弹窗区间 |
| 地图 | 未触碰 | 无任何 filter/backdrop-filter 作用于 `#cesiumContainer` |

不遮挡校验（CDP 实测）：`control-panel` z=100、`command-dock` z=145、`left-panel-stack` z=100 全部保持原值，菜单浮于其上但不覆盖 `--z-toast:1000`。

## 4. 降级策略（仅渲染能力，不改材质数值）

```css
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .lg-glass { /* 保留双层填充，另加不透明兜底 */ }
}
@media (prefers-reduced-transparency: reduce) { .lg-glass { backdrop-filter:none; ... } }
@media (prefers-reduced-motion: reduce)    { .lg-glass* { transition:none; } .lg-glass:active{transform:none} }
```

**折射/景深/色散**：Figma Glass 的 Refraction 70 需 `feDisplacementMap` + 位移贴图 PNG 资源方可近似，仓库内无该贴图。本次按任务包「降级仅限渲染能力」条款，采用 `blur(22px) saturate(1.9)` 等效磨砂 + 饱和提升，**材质数值未改**；后续若要折射，只需补 `displacement.png` 并在 `.lg-glass` 追加 `backdrop-filter: url(#lg-glass)`。

## 5. 验证（实测取证）

环境：系统 Chrome 155（headed，非 headless）+ CDP，窗口 1600×900，`http://127.0.0.1:4173/`

| 断言 | 实测值 |
|---|---|
| 按钮尺寸 | `44 × 44` |
| 按钮圆角 / 边框 | `12px` / `0px` |
| 按钮 backdrop-filter | `blur(22px) saturate(1.9)` |
| 按钮 box-shadow 层数 | `7`（4 投影 + 3 内阴影） |
| 菜单宽度 / 圆角 / z | `320px` / `16px` / `200` |
| 菜单 backdrop-filter | `blur(22px) saturate(1.9)` |
| 横向溢出 | `overflowX = 0` |
| 其他层未变 | control-panel 100 / command-dock 145 / toast 仍是原值 |
| 控制台/渲染错误 | 菜单开合全程 `errPanel: 0`（无 Cesium 报错） |

截图：
- `D:\Hermes\tmp\lg-shots\headed-01-dark-baseline.png`（首页 + 玻璃按钮，暗）
- `D:\Hermes\tmp\lg-shots\headed-02-menu-dark.png`（菜单打开，暗/Clear 变体）
- `D:\Hermes\tmp\lg-shots\headed-03-menu-light.png`（菜单打开，Light 变体）
- `D:\Hermes\tmp\lg-shots\headed-04-menu-with-panel.png`（菜单 + 图层面板同屏，无遮挡）

## 6. 已知现象 / 排查记录

- **headless Chrome（`--headless=new --disable-gpu`）下打开菜单会触发** `DeveloperError: Expected width to be greater than 0, actual value was 0`（Cesium 渲染错误面板）。原因：软件渲染 + `backdrop-filter` 强制整页重绘，Cesium 画布瞬间被测量为 0。**headed Chrome 实测无该错误**，canvas 尺寸变化来自项目既有「自适应分辨率」逻辑，与本组件无关。核验请用 headed Chrome。
- 顶栏既有 `status.css` 的 `#top-center-actions button`（ID 选择器）会压过类选择器，故 `lg-glass.css` 内用同等 ID 上下文重声明材质（`#top-center-actions > .lg-glass-btn`），**未修改 status.css**。
- `node --test src/tooling/*.test.mjs` 有 17 项失败，全部是服务端 provider/middleware 用例（FIRMS、military、transit、CelesTrak 等），与本次 UI 改动无文件交集；`applicationHtml` / `browserModuleBoundary` / `npm run build` 均通过。

## 7. 还原方式

删除 `src/ui/styles/lg-glass.css` + `src/ui/lgGlass.js`，并移除 `style.css` 末行的 `@import` 与 `index.html` 中的 `lgGlass.js` 脚本行即可完全还原（两处均带注释标记）。

## 5. 验收结果（逐条，2026-10-24 CDP 实测）

| 验收项 | 结果 | 证据 |
|---|---|---|
| 材质逐参数一致（blur22/saturate1.9、Light .70/.10、3内阴影+4投影） | ✅ | computed: `backdrop-filter: blur(22px) saturate(1.9)`；`borderWidth: 0px`；box-shadow 含 rgba(219,219,219,.5) 缩放项 |
| 无四周矩形硬边框 | ✅ | `borderTopWidth: 0px` + 目视无硬边框 |
| z-index 走变量/区间，无抢占 | ✅ | 菜单 `z-index:200`(--z-popup)、遮罩 `199`、command-dock `145`、left-panel-stack `100` **均未变** |
| 深/浅模式截图 | ✅ | evidence/lg-glass-shots/{btn-dark,menu-dark,menu-light,btn-light}.png |
| 图层面板叠加无遮挡 | ✅ | menu-over-panel.png（菜单 z200 浮于面板上层） |
| console 错误 | ✅ 0 | 运行期 error 计数 0 |
| 构建 | ✅ | `npm run build` 52.71s 通过 |

玻璃质感（GLM-4V 视觉复核）：深/浅两版均为「半透明磨砂玻璃，能透出背后地图并模糊，无硬边框，圆角明显，文字清晰」。

截图清单：
- `btn-dark.png` / `btn-light.png` — 44×44 玻璃按钮（深/浅）
- `menu-dark.png` / `menu-light.png` — 320×N 玻璃菜单（深/浅）
- `menu-over-panel.png` — 菜单叠于图层面板之上（无 z-index 抢占）

兼容降级：`@supports not(backdrop-filter)` → 双层填充+不透明兜底（不改材质数值）；`prefers-reduced-transparency` 关 backdrop-filter；`prefers-reduced-motion` 关过渡。均已在 lg-glass.css 落地。

## 6. 回滚

删除 index.html 的 `<script src="/src/ui/lgGlass.js">` 一行 + style.css 的 `@import lg-glass.css` 一行，即完全还原（组件为纯新增，不侵入既有链路）。

---

## 扩展（第二批）：指令坞 / 右栏玻璃化 + 全屏穿透消除 + 全站层级复测
时间：2026-10-24

1. **全屏穿透修复**：玻璃菜单原有全屏 `lg-glass-backdrop`(z199, pointer-events:auto) 会整屏挡住地图/Cesium 拾取。改为 **document capture `pointerdown` 监听**，点菜单/触发按钮外即关闭 → **零全屏元素**。实测开菜单时全屏 `pointer-events!=none` 元素仅 `cesiumContainer`(地图本体)。
2. **玻璃扩展到指令坞与右栏按钮**：新增 `.lg-glass-skin`（官方 Dark/Clear 材质按 `--lg-scale` 等比缩放、圆角用 token；`!important` 仅限 skin 内覆盖表面，**不改尺寸/定位/交互行为**）。
   - 指令坞：`.dock-tray-toggle`(位置/视觉预设) + `#gev-voice-button`(ON/OFF) + `.gev-voice-tier-btn`(标准) = 4 枚
   - 右栏：`.pp-toggle-btn`(HUD/密集/3D/取景/绘制/天球/清爽/泛光/锐化/画面设置 共 10) + `.pp-collapse-btn` = 11 枚
   - **MutationObserver**（childList+subtree，200ms 去抖）对动态渲染/展开后新出现的按钮持续补挂；`window.__gevLiquidGlass.skin()` 可手动触发。
3. **全站层级实测**（1600×900，菜单开 + 右栏展开）：全屏遮挡 **0**、同 z 交互重叠 **0**；分区严格 map<world<hud100<panel110<dock145<popup200<toast1000<devtools。
4. **5 分辨率回归**（2560/1920/1600/1366/1280）：横向溢出 **0**、指令坞与右栏均视口内、无越界高 z 元素。
5. **视觉复核**（GLM-4V）：坞/右栏/菜单均「磨砂统一、无错位/重叠/截断、协调美观」。
截图：`evidence/lg-glass-shots/{dock-glass,rail-glass-expanded,menu-dark-v2}.png`
