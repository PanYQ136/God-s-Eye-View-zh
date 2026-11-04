# t_8cf06356 交付报告 · 3:25 rdev SVG 玻璃复原 / 关 9 卡 WebGL / 修展开-收缩

日期：2026-10-26 · 工作区：`D:\Hermes\gods-eye-view`（dev server: http://localhost:4173 · 视口 1536×730）
证据目录：`evidence/_collab/t_8cf06356/`（截图 / JSON / 日志）· 回滚备份：`evidence/_collab/t_8cf06356/before/`

---

## 0. 一句话结论

9 卡 WebGL 玻璃已彻底关闭；卡片改回「`.gev-lg-warp` 一层玻璃 + rgba(12,18,26,0.52) 卡壳」的 3:25 结构，
卡内 App 自带的 0.72+blur18 内层已清掉（否则实测 87% 不透明、看不见地图）；滚动条全隐藏仍可滚；
7 张卡的展开/收缩改成「贴自己 header 锚点生长」，**重叠面积全部 0、收缩回原位 100% 复原**。

有一处必须请你拍板（详见 §5）：**真·SVG 位移滤镜与 60fps 不可兼得**。
所以默认走「blur6 + 1px CSS 光谱边」（≈95fps），真 SVG 折射留成一行开关（≈8fps）。

---

## 1. 改了哪些文件（diff 摘要）

| 文件 | 改动 |
|---|---|
| `index.html` | 注释掉 `<script src="/gev-gl-glass.js">`（WebGL 9 卡 shader 不再加载）；保留 `gev-lg-filter.js` + `gev-liquid-cards.js` |
| `public/gev-liquid-cards.css` | 整文件重写（862 行 WebGL 版 → 192 行 3:25 版）：`.gev-lc` 0.52 底色 / `.gev-lg-warp` blur6+saturate140 / `.gev-lg-rim` 1px 光谱边 / 卡内二层玻璃清零 / 滚动条 / 锚点浮层 / `.gev-lc-hid` / 亮底档补强 / 测试钩子 |
| `src/gev-liquid-cards.js` | ① 恢复每卡 `.gev-lg-warp` + `.gev-lg-rim` 注入；② 展开定位重写：`RAIL` 锚点生长 + `placeExpanded()` 收缩避让（删掉 28px 级联搜索）；③ 同组兄弟被压到才 `visibility` 隐藏；④ 修 `translateX(-50%)` 造成的 -260/-190px 位移 bug；⑤ 每 2s 亮度探针（亮底切 0.62→0.72 档）；⑥ CDP 钩子 `lensSvg()/nofilter()/_place()/_obs()/_sibs()` |
| `public/gev-lg-filter.js` | 重建：位移图从 `feImage href="data:image/jpeg;base64,…"` 改为外链静态图 `/gev-lg-dispmap.jpg`（滤镜图本身不变） |
| `public/gev-lg-dispmap.jpg` | 新增（4.4 KB，从原 data URI 解出来的位移图） |
| `scripts/qa-gev-*.mjs`、`scripts/dbg-*.mjs`、`scripts/sum-*.mjs` | 本轮取证脚本（未提交 git） |

---

## 2. 玻璃材质取证

`final-report.json → material`：

```json
{ "gevGlOn": false, "glCanvas": false, "glScript": false,
  "warpCount": 9, "warpBackdrop": "blur(6px) saturate(1.4)",
  "warpFilter": "none",                // 默认；<html class="gev-lens-svg"> 时 = url("#gev-lg-filter")
  "cardBg": "rgba(12, 18, 26, 0.52)", "cardBackdrop": "none", "svgFilter": true }
```

* 页面**不再出现** `#gev-gl-glass`，`html` 上**不再有** `gev-gl-on`，`gev-gl-glass.js` 不加载 → 9 卡 shader 彻底关闭。
* 每张卡只有一层玻璃（`.gev-lg-warp`）+ 一层 0.52 卡壳；卡内不再有任何 `backdrop-filter`（App 原生 `rgba(12,12,20,.72)+blur(18px)` 内层已清零，这是「看得见地图」的前提：条纹底图实测标准差 1.8 → 65）。
* 卡壳 0.52 是 3:25 原值；`data-gev-glass-lum="bright"`（雪地/盐湖）时 0.72。

### 中心透明（纯条纹底 vs 卡内同区）

| 采样区 | 卡内亮度 / 条纹亮度 | 比值 |
|---|---|---|
| data-panel 展开卡中心（条纹底） | 93.8 / 154.9 | **0.606** |
| data-panel 展开卡边缘带 | 88.3 / 166.9 | 0.529 |

0.606 ≈ 理论上「0.52 卡壳 + 52% 底图透出」，即中心确实半透、能看见地图（对照 `live-data-expanded.png`：街道纹理透过卡片可见）。

### 边缘色散（真 SVG 模式，`gev-lens-svg`）—— 灰阶底图 A/B

底图换成**纯灰阶**条纹（R=G=B），此时卡边出现 RGB 不等只能来自位移图的 R/G/B 三通道分离：

| 距边框 | meanAbsΔR | meanAbsΔG | meanAbsΔB | 通道间差 |
|---|---|---|---|---|
| 0–1px | 15.80 | 17.69 | 19.59 | **3.79** |
| 2–3px | 12.81 | 14.36 | 15.96 | 3.15 |
| 4–8px | 10.53 | 10.59 | 11.28 | 0.76 |
| 9–30px | 23.85 | 24.53 | 25.86 | 2.01 |
| 中心 >30px | 15.79 | 16.79 | 18.00 | 2.21 |

通道间差在边框带最大（3.8）、向内迅速衰减 → 「边缘 R/G/B 分开、中心基本不动」与 rdev EDGE_MASK 的行为一致（放大图 `dispA-on-3x.png`）。
默认模式没有真位移，彩边由 `.gev-lg-rim`（1px 虹彩描边，纯 GPU）提供：`live-collapsed.png` / `card-*.png`。

---

## 3. 7 卡展开 / 收缩表（重叠面积目标 0 → 实测全 0）

`audit.json → expansions` / `afterAll`（1536×730，单位 px；shift = 展开后左上角 − 折叠时左上角）

| 卡 | 折叠 rect | 展开 rect | shift | 与任何可见卡/安全件重叠 | 内部 header 被裁 | 收缩回原位 |
|---|---|---|---|---|---|---|
| data-panel | (52,94,176×45) | (52,94,320×380) | **(0,0)** | 0 | 无 | ✅ (52,94,176×45) |
| scene-panel | (52,147,176×45) | (52,147,320×340) | **(0,0)** | 0 | 无 | ✅ |
| pp-toggles | (1308,94,176×52) | (1184,94,300×430) | (-124,0)¹ | 0 | 无 | ✅ |
| cctv-panel | (1308,154,176×52) | (1144,154,340×410) | (-164,0)¹ | 0 | 无 | ✅ |
| global-context-panel | (1308,214,176×52) | (1164,214,320×350) | (-144,0)¹ | 0 | 无 | ✅ |
| location-bar | (530,632,168×86) | (530,478,380×240) | **(0,-154)** | 0 | 无 | ✅ |
| control-panel | (838,632,168×86) | (838,338,465×380) | **(0,-294)** | 0 | 无 | ✅ |

¹ 右栏三卡贴右边锚点、宽度变大 → 左边界左移；**上边界完全不动**（原来的 94→270 跳位消失）。
数据卡与场景卡不再互相压：展开哪张，另一张在它下面且被压到才整块 `visibility:hidden`（不 `display:none`、不重排、不留 ghost）。

全部收起后：`hid=0  placeholder=0  floating=0`，7 张卡 rect 与折叠基线逐一 `SAME` → **ALL RESTORED**。

互斥组各开一张（3 张同屏）实测：

| 组合 | 三卡 rect | 两两重叠 |
|---|---|---|
| data + pp + control | (52,94,320×380) / (1184,94,300×430) / (838,338,338×380) | 0 / 0 / 0 |
| scene + cctv + location | (52,147,320×340) / (1144,154,340×410) / (530,478,380×240) | 0 / 0 / 0 |
| data + gcp + location | (52,94,320×380) / (1164,214,320×350) / (530,478,380×240) | 0 / 0 / 0 |
| scene + pp + control | (52,147,320×340) / (1184,94,300×430) / (838,338,338×380) | 0 / 0 / 0 |

---

## 4. 滚动条证据（数据卡展开态）

```json
{ "pageScrollWidth": 1536, "innerWidth": 1536, "classicScrollbarPx": 0,
  "cardScrollWidth": 320, "cardClientWidth": 320, "cardScrollable": true,
  "listSbWidth": "0px", "listScrollbarWidthProp": "none", "cardScrollbarWidthProp": "none",
  "wheelWorks": { "before": 0, "after": 300, "moved": true } }
```

* 页面 `scrollWidth == innerWidth`（1536），探针量出经典滚动条宽度 **0px**。
* 展开卡 `scrollWidth == clientWidth == 320`（无横向溢出、无竖条），卡内 `::-webkit-scrollbar` = 0px。
* 滚轮仍生效：`scrollTop 0 → 300`。
* 右侧特写：`live-data-right-edge.png`（无青色竖条）。

---

## 5. 性能：这里有个必须你拍板的取舍

同一台机器（RTX 3060 / Chrome，headed + headless 各测一遍，结论一致）：

| 状态 | 帧时长中位数 | 折算 |
|---|---|---|
| 关掉整个 `gev-liquid-cards.css`（App 原生内层） | 12.0 ms | 83 fps |
| **默认（warp 只 blur6 + CSS 光谱边）** | **10.2–10.7 ms** | **≈95 fps** |
| warp 上再挂 `filter:url(#gev-lg-filter)`（真 rdev SVG 位移） | **93–132 ms** | **≈8 fps** |
| 同上，但只给 1 张卡挂 | 93–111 ms | ≈9 fps |

* 只挂 1 张卡也一样慢 → 不是面积问题，是 Chromium 对「`backdrop-filter` + SVG 滤镜 + 实时 WebGL 画布」组合**每帧重跑滤镜链**（把 data URI 位移图改成外链静态图只省掉解码，仍 100ms；`backdrop-filter: url(#…)` 同样 107ms）。
* 也就是说：**真 SVG 位移 ≠ 60fps**，这条在 Chrome 里当前无解（除非把 Cesium 停帧）。
* 因此默认 = **blur6 + 1px CSS 光谱边**（中心透明、边缘细彩边、≈95fps）；
  真 SVG 折射保留为一行开关：

```js
window.__gevLc.lensSvg(true)   // 真 rdev SVG 位移（3:25 原始滤镜，≈8fps）
window.__gevLc.lensSvg(false)  // 默认：CSS 光谱边（≈95fps）
// 或 <html class="gev-lens-svg">，偏好会记在 localStorage
```

对照截图：`mode-lens-svg-collapsed.png` / `mode-lens-svg-data-expanded.png`（真 SVG 模式）
vs `live-collapsed.png` / `live-data-expanded.png`（默认模式）。

展开动画：中位 12.9 ms、p95 23.2 ms、>33ms 长帧 **0**（90 帧采样）；动画仍是 CSS/WAAPI，无 rAF 重绘。
亮度探针：每 2s 一帧 8×8 drawImage，无常驻 rAF。

---

## 6. 已知取舍 / 待你决定

1. **SVG 折射 vs 60fps**（上面 §5）—— 默认取 60fps，一行切回。
2. **亮底可读性**：0.52 单层玻璃在纯白底上 11px 白字只有 ~1.9–2.0:1（3:25 原始观感就是这样，当时靠 App 自带 0.72 内层兜底）。
   现在只在 `lum=bright` 时给标题行补 `rgba(6,10,16,.55)` 浅底 + 白字厚投影；真实地图（默认地貌）实测 6/7 张 ≥4.5:1，`cctv 3.64:1`（那一刻它背后正好是一块亮屋顶）。
   若要「雪地/盐湖也稳过 4.5」，把卡壳亮底档提到 0.86 或把 App 原生内层加回来（一行），都会牺牲通透感 —— 等你选。
3. 同组兄弟（右栏三卡、dock 三块、左栈两张）在展开时会**整块隐去**（原来只是收起成 header）。这是「贴锚点不跳位 + 不压住可见 header」两个要求同时成立的唯一解；收起时 100% 复原。
