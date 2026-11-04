# t_834a621c — GEV 首页帧率专项：可见窗口 28fps → 51fps

时间：2026-10-28 · 环境：Ego Lite（ego-browser 0.6.1.13）· 1536×730 CSS / dpr 1 / 窗口 normal 可见且聚焦
复现协议：`?s1=1792949514406&welcome=0` 冷启动，等 17s，`requestAnimationFrame` 量 1.5s

## 结论（先看这四条）

1. **审计窗口的口径上限不是 60fps，是 ~40fps。** 同一个 Ego 窗口里，一个 **20×20 的红方块**
   加一条 transform 动画就只有 **39.7fps**；空白页（无任何动画）73.8fps。也就是说这个窗口
   每次「真的提交一帧」要 ~25ms —— 只要页面在持续产帧，谁也别想超过 40fps。所以卡片里
   「目标 60」在 Ego/iGPU 这个环境里物理不可达（同一页面在用户自己的 Chrome + RTX 3060
   上，同视口实测 **58.5fps**）。
2. **28fps 的主因不是 JS、不是 Cesium、不是某一张卡。** 1.8s trace：50 次 BeginMainFrame
   (=27.8fps)，主线程每帧 `BeginMainFrame` 7.9ms、`ExecuteFrameCallbacks` 5.3ms（0 long task），
   合成 `DrawFrame` 2.2ms，而 **GPU 进程 `SwapBuffers` 23.2ms / `Present` 22.6ms /
   `ScheduleOverlays()` 22.6ms（每帧）** —— 36ms 的帧预算 2/3 花在呈现路径上。
   `#world-overlay-*` / `#scope-mask` / `#gev-edge-lens` 叠了 5 张全屏 canvas，
   每多一张全屏合成层实测 ≈ **-2.5fps**（1 张全屏 canvas 46.2 → 5 张 36.3）。
3. **真正的浪费：空闲时还在整屏重画 + 整屏合成。** rAF 工作普查（1.5s / 44 帧 / 29fps）：
   Cesium `render2` 2.17ms/帧、`gev-edge-lens` 的 rAF 兜底 0.38ms/帧，而
   **`scene.postRender` 在 1.5s 内触发 0 次**（requestRenderMode 下 Cesium 本来就空闲），
   可边缘折射环的 rAF 兜底仍在每帧 `clear + drawArrays` 一张 1536×730 的 canvas →
   画布每帧变脏 → 合成器每帧重合成一次全屏层。**像素一个都没变，帧率却全赔进去。**
   另外 `#scope-mask` 这张全屏 canvas 在 scope 关闭（默认态）时是空的，但它照样作为一层
   参与每一帧合成。
4. 逐层隐藏的旧归因（父卡 round-13）没错，但结论要修一句：**隐藏 DOM 不涨帧，不是因为
   「整页合成开销无法定位」，而是因为呈现路径本身就 25ms/帧 —— 只有把「每帧必做的整屏工作」
   真正去掉，才拿得到那 25ms 里的一部分。** 本轮就是按「去重」做的。

## 改动（最小、不动视觉口径）

### 1. `public/gev-edge-lens.js` —— 空闲去重（主因，+~20fps）
按「纹理版本号 + 每个玻璃面的几何」算签名：

```js
if (capture) { uploadMap(map); } else if (!texValid) { return; }
var sig = TEX_STAMP + '|' + W + 'x' + H + '|' + scale + 每个面的 x,y,w,h,band,cornerN,radius;
if (!capture && sig === lastSig) { stats.skip++; return; }   // 不 clear、不 drawArrays
```

* 签名没变 → 完全不动 GL，画布保留上一帧 → **屏幕像素一致**（已用截图对账，见下）。
* 地图重绘（postRender）、卡片动画/布局变化、缩放、`resize()`、`off()/on()`、`testBg`
  都会让签名变化 → 照常重画。相机移动实测 `frames` 82→109，不会冻住。
* `stats()` 新增 `skip` 计数，作为「这一帧被去重掉」的取证口。

### 2. `src/scopeMask.js` —— 空的整屏 canvas 退出合成树（约 +2~3fps）
scope 默认关闭，`_painted` 已经是「画布有没有墨」的既有判据。补一层：
没墨时 `_canvas.style.display = 'none'`，要画之前再恢复 `'block'`。
空的全屏 canvas 不会因为「全透明」就不花钱 —— 它仍然是一层参与每帧合成的全屏层。

## 验证（同一窗口、同一视口、同一视觉口径 = 性能模式关闭 / res 1.0）

| | 帧率 | 帧间隔中位数 | p90 | longtask |
|---|---|---|---|---|
| 改前（父卡 27.6–28.2 / 本轮 round-04 29.6·27.7 / round-10 27.5·26.6） | **27.6–29.6** | 33–36ms | 40–47ms | 0 |
| 改后（round-15，冷启动 17s，连测 3 次） | **50.5 / 53.2 / 49.2** | 18.5–20.3ms | 22.5–24ms | 0 |

* 去重生效取证：5s 内 `__gevEdge.stats()` → `frames` 冻结在 66，`skip` 353→626
  （= 掐掉 273 次「整屏重画但像素不变」的提交）。
* 相机 `setView` 后 `frames` 82→109 → 交互时照常重画。
* 折射环还在：`lens count=9`，把折射环层关掉后同帧截图有 **6.09% 像素**变化
  （= 边缘色散环确实在出像素），关掉再打开回到 0.35%（≈ 地图重新渲染噪声）。
* scope-mask 回归（真实按钮 `#scope-toggle`）：默认 `display:none`/300×150 未绘制 →
  点开 `display:block`/1536×730/`aria-pressed=true` → 再点回 `display:none`。
* `node --test src/scopeMask.test.mjs` → **22/22 通过**。

## 环境侧必须记一笔（否则下轮还会被 28fps 骗）

* Ego Lite 的 Chromium WebGL 渲染器 = **`ANGLE (Intel, Intel(R) UHD Graphics (0x9BC4) Direct3D11)`**
  —— 核显。同一台机同一视口，用户自己的 Chrome = `ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU)`
  实测 58.5fps。**Ego 窗口没吃到独显**（`FPS优化方法.md` §0 的老坑，这次是 ego.exe/ego-browser.exe 没有注册表 GPU 偏好）。
* 想把审计口径对齐真实用户体验：给 `ego.exe`、`ego-browser.exe` 加
  `HKCU\Software\Microsoft\Windows\CurrentVersion\DirectX\UserGpuPreferences` → `GpuPreference=2;`（= 高性能）。
  这是**环境改动**，本轮未做（不在代码范围内），但它是「60fps 目标」能不能谈的前提。

## 没做 / 已知限制

* 没到 60：审计窗口对「持续产帧」的硬上限 ~40fps（20×20 动画 39.7fps 已证）；
  要 60 只能换独显环境，或降渲染分辨率（= 视觉口径，本卡禁止）。
* 相机拖拽/瓦片加载期间仍会掉到 ~20–28fps（fill-rate 上限），本次改动只清掉空闲期的浪费。
* 没动玻璃材质 / 圆角 / 颜色；没提交 git。
* `#world-overlay-detection-surface`（另一张空闲期全屏 canvas，实测隐藏 +9fps 的单点峰值，
  但那是加性噪声区间上限）没动：它的绘制由 `worldOverlay.js` 的自定义画道驱动，
  要改「有没有墨」的判定得动那个 2843 行模块，超出本卡最小改动边界，留给后续卡。
