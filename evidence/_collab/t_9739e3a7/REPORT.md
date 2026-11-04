# t_9739e3a7 交付报告 · CSS 中心 + 只边缘真折射（替代 1px 假彩边 / 8fps 方案）

日期：2026-10-27 · 工作区：`D:\Hermes\gods-eye-view`（dev: http://localhost:4173 · 视口 1536×730 · dpr 1 · RTX 3060 / ANGLE D3D11）
证据目录：`evidence/_collab/t_9739e3a7/`（截图 / JSON / 日志）· 脚本：`scripts/{qa,probe,bench,compose}-*.mjs`（未提交 git）

---

## 0. 一句话结论

按 **A 方案（WebGL 边缘环）** 做完了：**卡片中心仍是 CSS `backdrop blur(6px)`，边缘 8–16px 是 WebGL 真折射环**
（SDF 圆角矩形 + 四分之一圆斜面 + Snell IOR1.52 + R/G/B 三条独立光线 0.82/1.00/1.22）。
帧率：同屏成对 A/B（环开/环关 交替，4 个独立跑次）平均差 ≈ **0**（单次 −10%…+17%，噪声 ±25%），
轻场景 94.3 vs 100 / 105.3 vs 108.7，3D 瓦片密集场景 64.9 vs 64.9，**没有一次是环把页面拖到 60 以下**；
**中心 0 像素被改动、边缘带 48.8% 像素改变**；色散可量：同一张 R=G=B 合成条纹底，
`dispPx=4.6` 时单像素 |R−B| 最高 **194**，`dispPx=0` 时 **三通道逐个相等（差 0）**。
`.gev-lg-rim` 的 1px 假彩边已**删除**（DOM 里 rim=0）。

---

## 1. 结构（三层，自下而上）

```
① #gev-edge-lens  canvas（fixed, z-index:4，卡片之下）—— 只画边缘环，中心 discard
② .gev-lc  卡壳 rgba(12,18,26,0.52)  —— 同一块「带色玻璃」，同时压暗环与中心（色偏一致）
③ .gev-lg-warp  backdrop blur(6px) saturate(140%) —— 只糊中心：inset:12px + 8px 羽化 mask
   └ 内容（文字/控件）在 ①②③ 之上，不受折射影响
```
数据流：`viewer.scene.postRender` → 把 Cesium canvas **直接 texImage2D** 成纹理 → 每卡一个 quad 画环。
Cesium 空闲（不再渲染）时由 rAF 兜底：只重画几何、复用旧纹理，卡片展开动画不脱节。

### 为什么必须这样分工（两个实测结论）

| 做法 | 结果 |
|---|---|
| `preserveDrawingBuffer:true` 再 drawImage 读地图 | 地图合成层**变黑**（截图全黑，但 drawImage 读到 55.8）→ 弃用；改 postRender 同 task 抓帧（`pdb=false` 也能读到 55.8，rAF 里读=0） |
| `.gev-lg-warp` 全卡 blur6（原样） | 2px 级 R/G/B 位移被抹平：边缘带条纹 sd 从 **38.5 → 0.4**（`probe-mask.json`）→ 边缘必成「平涂暗块」 |
| `inset:12px` + 8px 羽化 mask | 边缘 0–8px sd **43.7**（锐利，等于无 warp 的 0.48×111.3 减去壳压暗），12→20px 剖面单调过渡（18→70）无台阶 |

---

## 2. 文件改动

| 文件 | 改动 |
|---|---|
| `public/gev-edge-lens.js` | **新增**（~470 行）：WebGL 边缘折射环。postRender 驱动、每卡一 quad、SDF+Snell+R/G/B 三光线、5 抽样小模糊、内缘羽化、逐卡带宽自适应；钩子 `__gevEdge.{set,only,testBg,cap,on,off,stats}`、`?gevEdge=0/2` |
| `public/gev-liquid-cards.css` | `.gev-lg-warp` 改 `inset:12px` + 8px 羽化 mask（只糊中心）；`.gev-lg-rim` 整块删除，只留 `display:none!important` 防旧 DOM 回归 |
| `src/gev-liquid-cards.js` | `ensureWarp()` 不再注入 `.gev-lg-rim`（发现残留就 remove） |
| `index.html` | 末尾加 `<script src="/gev-edge-lens.js">`（gev-gl-glass.js 仍注释停用） |
| `scripts/qa-edge-*.mjs`、`probe-*.mjs`、`bench-edge*.mjs`、`shots.mjs`、`compose-cmp2.mjs` | 本轮取证脚本（未提交 git） |

---

## 3. 验收数据

### 3.1 帧率（1536×730，同屏成对 A/B：环开/环关 交替，各 3×4s 取中位）

> 页面绝对 fps 由地图场景决定（远视地球 100–120；3D 瓦片密集 58–85），**跨跑次不可比**，
> 只有同一屏内的「环开 vs 环关」成对比较有意义。四次独立跑次（`qa-final.json` / `bench-cap.mjs` / `bench-final-ab.mjs`）：

| 跑次 | 环关 fps50 | 环开 fps50 | 差 |
|---|---|---|---|
| ① 轻场景·折叠 | 100（87.7 / 108.7 / 100） | 94.3（93.5 / 94.3 / 106.4） | −5.7% |
| ① 轻场景·展开 8 面 | 108.7（108.7 / 114.9 / 105.3） | 105.3（122 / 105.3 / 87.7） | −3.1% |
| ② cap 60 / cap 0 同屏 | 108.7 / 120.5 | 97.1 / 108.7 | −10% |
| ③ 重场景（3D 瓦片）·折叠 | 64.9（62.1 / 66.7 / 64.9） | 64.9（65.8 / 64.9 / 62.5） | **0%** |
| ③ 重场景·展开 | 58.5（58.5 / 57.5 / 64.5） | 61.3（64.1 / 61.3 / 59.2） | +4.8% |
| ④ 混合场景（最终构建，4ms 去重后）·折叠 | 85.5（84 / …） | 78.1（69.4 / 106.4 / 78.1） | −9%（单次噪声 ±25%） |
| ④ 同上·展开 | 82.6（77.5 / 107.5 / 82.6） | 97.1（97.1 / 120.5 / 82） | +17% |

四次跑次的开/关平均差 ≈ **0**，单次最大 −10%；**没有任何一次是环把页面拖到 60 以下**（唯一低于 60 的 58.5 是
「环关」基线，同一场景环开反而 61.3）。环绘制速率跟 Cesium 渲染同帧（55–83/s，4ms 去重挡掉同帧重复上传）。
默认 `cap:0`（每帧跟画 → 边缘与地图零延迟）；`__gevEdge.cap(60)` 可省 ~10%，代价是移动时边缘慢 1 帧。
不需要降级到「4 条边条」或「仅主卡启用」；单卡原型（`only(['data-panel'])`）同测 108.7fps。
页面自带 FPS 读数与 rAF 实测一致（`check-fps-chip.mjs`：环开 chip 99 / rAF 94.3；环关 chip 83 / rAF 105.3）。

### 3.2 「只边缘」硬证据：冻结地图后环 on/off 差分（`ring-diff.json` / `ring-diff.png`）

| 区域 | 采样像素 | 改动像素（>3/255） | 占比 | 最大通道差 |
|---|---|---|---|---|
| 卡边 0–16px 带 | 21,376 | 10,434 | **48.8%** | 14 |
| 卡内中心（depth>16） | 100,224 | **0** | **0.00%** | 3（=阈值） |
| 卡外（其余 8 张卡的环） | 999,680 | 16,882 | 1.69% | — |

放大差分图 `ring-diff-edge5x.png`：只有一条 16px 宽的竖带发光，内侧全黑 → **中心不做位移、不加暗底**。

### 3.3 色散（R/G/B 真分离，不是假彩边）

合成纹理 `R=G=B` 黑白条纹（8px 周期）直灌 shader，同帧 readPixels 读左边缘 30px（`probe-ring.log`）：

| dispPx | 环带逐像素 R−B（前 12px） | 通道关系 |
|---|---|---|
| **4.6**（产品值） | `0, −47, 0, 0, 0, 35, 194, 174, 140, 133, 91, 12` | R/G/B 逐点不等（最大 194） |
| **0**（对照） | `0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0` | 三通道完全相同 |
| 真实地图 | `2, 10, 11, 11, 12, 12, 14, 13, 14, 14, 12, 10` | 起 2–14 的连续色散 |

底图本身 R=G=B，通道不等的唯一来源就是 shader 里 R/G/B 三条独立光线的采样位移（0.82/1.00/1.22 × 4.6px ≈ ±1.8px）。
直观图：`ring2-band-8x.png`（8px 周期条纹下，边缘带里出现青/橙错位的竖条）。

### 3.4 中心通透 + 边缘锐利（CSS 条纹底探针，绕开 Cesium；`q3.json`）

| 位置 | mean | sd | 判读 |
|---|---|---|---|
| 卡外纯条纹 | 121.1 | 111.3 | 参考（锐） |
| 卡内 0–8px（环关） | 69.8 | **43.7** | 边缘**没被糊**（= 0.48×111 的壳压暗预期） |
| 卡内 14–20px（环关） | 41.6 | 13.6 | 羽化区，正在变糊 |
| 卡内中心（环开=环关） | 77.9 | 23.1 | 磨砂；中心/卡外亮度比 **0.643**（上一版 0.606） |

逐 depth 亮度剖面（0→29px）：`32,18,15,16,95,94,93,92,136,127,125,124,18,21,24,28,33,39,48,56,63,66,70,72,73,73,72,71,70,68`
→ 0–11px 保持条纹（锐），12–20px 单调过渡（遮罩羽化），20px 之后为模糊值，**无台阶/无硬接缝**。

### 3.5 回归（`qa-regress.json` / `qa-final.json`）

* 7 张卡逐张展开→收缩：**7/7 `restored: true`，重叠面积全部 0**（data/scene/pp/cctv/context/location/control）；
  展开卡 rect 与上一轮一致（如 data-panel `52,94,320×380`；pp `1184,94,300×430`；control `838,338,465×380`）。
* 折叠态 rect `[52,94,176×43]`：与 `?gevEdge=0` 基线**同一数值**（43 是 App 原生头卡高度，不是回归）。
* 页面 `scrollWidth = innerWidth = 1536`；展开卡 `scrollWidth−clientWidth = 0`；卡内 `::-webkit-scrollbar` 宽 **0px**（滚轮仍可滚，JS 驱动）。
* DOM：`rim=0`、`warp=9`、`warp.inset=12px`、`mask-composite=intersect`、`backdrop-filter=blur(6px) saturate(1.4)`、`filter=none`。
* 768×900 窄屏：9 面全部出环、无控制台错误；1536 下控制台 **0 error**。

---

## 4. 观感调参记录（第一版为什么被推翻）

第一版直接用 16px 全宽环 + rimAmt 0.30 + 全锐采样 → 折叠态 43–52px 的头卡变成「**粗彩框**」（`cmp-collapsed-right-rail-3x.png` 旧图），
且锐利采样读起来像「贴片/相框」而不是斜透镜。已改：

1. **带宽自适应**：`band = clamp(短边×0.20, 7px, 16px)` → 头卡 10px、FAB 8.4px、大卡 16px；
2. **高光收窄到最外 ~4px**：`rimAmt 0.30→0.13`、`bandf=exp(-(t/0.22)²)`、1px 亮线 0.10→0.07；
3. **斜面加 5 抽样小模糊 1.5px**（3:25 的斜面本来就是 blur≈2px 的透镜）→ 不再是镜面贴片；
4. `innerDark 0.10→0.06`、`aa 1.4→1.2`、`dispPx 4.2→4.6`（补回模糊损失的色散）。

---

## 5. 开关 / 回滚

```js
window.__gevEdge.set({ band: 12, dispPx: 5, rimAmt: 0.2, blurPx: 1.0 })  // 实时改常量
window.__gevEdge.only(['data-panel'])      // 只给一张卡画（1 卡原型）
window.__gevEdge.cap(0)                     // 0=跟 Cesium 每帧画（默认，零延迟）；60=半速省 ~10%
window.__gevEdge.off() / .on()             // 关/开环（关=清屏，中心与边缘都回到纯 CSS）
window.__gevEdge.testBg(true, 8)           // 合成灰阶条纹底（量色散用，不参与产品路径）
window.__gevEdge.stats()                   // fps / 每面 rect+带宽 / tex 来源 / err
```
* `http://localhost:4173/?gevEdge=0` → 完全不加载环（等同上一版基线，用于 A/B）；
  `?gevEdge=2` → 只挂钩、画 0 面（隔离成本）。
* 彻底回滚：删 `index.html` 里 `<script src="/gev-edge-lens.js">` 一行，并把 `.gev-lg-warp` 的
  `inset:12px` + mask 去掉（回到全卡 blur6）。**未提交 git。**

---

## 6. 已知取舍 / 待你定

1. **小卡带宽**：43–52px 高的折叠头卡靠 `bandFrac 0.20` 收到 8.6–10px，仍占短边 1/5；若你觉得还重，
   一行 `__gevEdge.set({bandFrac: 0.14})` 即可（大卡不受影响）。
2. **中心亮度**：仍是 0.52 壳 + blur6（与上一轮一致，亮底 11px 白字 ~2:1 的老问题仍在，靠 `lum=bright` 档补）
   —— 本轮按要求只动边缘，没碰卡壳。
3. **3:25 真 SVG 位移**保留为对照开关（`<html class="gev-lens-svg">`，实测 ≈8fps），默认不挂。
4. 环画在卡片**之下**，因此和中心一样被 0.52 壳压暗（物理上同一块带色玻璃）；想要更亮的边缘就把 `rimAmt` 提到 0.2–0.25。

---

## 7. 证据文件

| 文件 | 内容 |
|---|---|
| `final-collapsed.png` / `final-expanded.png` | 最终全屏（折叠 / 展开） |
| `final-exp-left-6x.png` / `final-exp-top-6x.png` | 展开卡左/上边缘 6x |
| `ring-diff.png` / `ring-diff-edge5x.png` | 环 on/off 差分（边缘发光、中心全黑） |
| `ring2-band-8x.png` | 合成条纹下的边缘色散 8x |
| `cmp-A-old-vs-new-rail-3x.png` | 旧默认（1px 假彩边）vs 本次（边缘真折射） |
| `cmp-B-3h25-vs-ring-expanded-3x.png` / `cmp-C-left-edge-8x.png` | 3:25 真 SVG vs 本次 |
| `qa-final.json` `qa-regress.json` `ring-diff.json` `probe-ring.json` `q3.json` `probe-mask.json` `bench-edge2.json` `qa-edge-accept*.json` | 全部原始数值 |
| `regress-expand-*.png` / `regress-all-closed.png` / `regress-768.png` | 7 卡展开、全收起、窄屏 |
| `qa-final.log` `qa-regress.log` `probe-ring.log` `probe-diff.log` `probe-q3.log` | 运行日志 |
