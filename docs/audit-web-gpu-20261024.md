# 网页版上帝之眼 · GPU/渲染性能深度优化清单（P 分级）

> 依据：MD 规范第 8 章（性能自适应）+ 第 15 章（网页端）+ `performance-optimization` Skill（measure→fix→re-measure）+ CesiumJS/WebGL2 官方性能最佳实践。
> 环境：RTX 3060 6GB / Win11；网页端 Cesium 1.124（WebGL2）；本地 4173。
> 方法：只读扫描 `src/app/viewer.js|scene.js|tools.js`、`src/gev-graphics.js`、`src/gev-perf.js`、`src/renderGovernor.js`、`src/ui/frameRateMonitor.js`、flights 层，逐项 file:line 取证。
> 本轮只出清单；每项执行走「测基线 → 改一项 → 重测 → 留/回滚 → 写日志」。

## 0. 现状基线（实测 / 配置层）
- **gev-perf.js 头注实测（本机 RTX3060）**：航班 billboard 是最大单项成本（**关整层 +57 FPS**）；后处理 +10；瓦片 LOD +6；分辨率 +2。
- **默认叠加（冲突）**：
  - `gev-graphics.js:37-58` 桌面 DEFAULTS = `res:-1`(原生) / `fxaa:true` / `sharpen:40` / `msaa:4` / `pdb:true` / `tileMSE:2` / `fps:60` / `gpuPref:high-performance`。
  - `gev-perf.js:173-181` **默认开启「性能模式」** → 覆盖为 `resolutionScale=0.7` / `globeMSE=6` / `tilesetMSE=48` / 后处理关 / `targetFrameRate=30`（封顶 30fps）。
  - 净效果：**在 RTX3060 上默认画面偏糊(0.7) + 锁 30fps + 粗地瓦片 + 无后处理** —— 与"充分挖掘 GPU / 提升流畅度"目标相悖。
- **已达标（勿重复做）**：`renderGovernor`（idle→`requestRenderMode`+`maximumRenderTimeChange=Infinity`）、`visibilitychange` 停渲染循环、Bloom 默认关、radio 层聚类、`prefers-reduced-motion`、`powerPreference:high-performance` 强制独显、GPU 厂商探测（`WEBGL_debug_renderer_info`，gev-graphics.js:244）。

## 1. 清单表

| P | 编号 | 问题描述 | 现状/证据(file:line) | 优化方向 | 依赖 Skill / 技术方案 |
|---|---|---|---|---|---|
| **P0** | G1 | 航班 billboard/label 数量是最大单项成本（关层 +57FPS） | `gev-perf.js:4-6`(实测)；`src/layers/flights/*`(§billboard/label 全量) | `EntityCluster`/聚类 + `distanceDisplayCondition`（远景不画）+ `scaleByDistance`/`translucencyByDistance` + 高频项用 `PointPrimitiveCollection` 取代 billboard；按相机高度控量 | Cesium `BillboardCollection`/`EntityCluster`、Chrome DevTools GPU/Performance |
| **P0** | G2 | `preserveDrawingBuffer` 桌面默认 `true` → 每帧多拷一次整帧缓冲 | `gev-graphics.js:53`(pdb:true)、`viewer.js:132,167-168`(注释自认每帧整帧拷贝) | 默认 `false`；截图/录屏时同帧 `scene.render()`→`canvas.toDataURL()` 同步抓取，或仅在录制态重建上下文开 pdb | WebGL `preserveDrawingBuffer` 语义、Cesium `scene.render`+`toDataURL` |
| **P0** | G3 | 默认「性能模式」= res0.7 + 30fps 封顶 + 关后处理，且与 gev-graphics 默认冲突 | `gev-perf.js:55-67,173-181`；`gev-graphics.js:52-58` | 取消默认强制降质：改为**自适应目标 60fps**，GPU 有余量保 `resolutionScale≈1.0`/清晰，仅在掉帧时渐进降；"性能/省电"降为可选档，不默认 | `renderGovernor` + 自适应控制器；`performance-optimization`(measure-first) |
| **P0** | G4 | 缺 GPU 帧时间度量（仅 postRender FPS 计数） | `src/ui/frameRateMonitor.js`(仅计数)、无 `EXT_disjoint_timer_query` | 加 `EXT_disjoint_timer_query_webgl2` GPU 计时 + rAF delta EMA，作为自适应分辨率/质量的输入信号，并暴露到调试 HUD | WebGL2 `EXT_disjoint_timer_query_webgl2`、GPU timer |
| **P1** | G5 | MSAA4 + FXAA 同开 + `resolutionScale=DPR(≤2)` 三重 AA/填充叠加 | `gev-graphics.js:52-53`(msaa4,fxaa true)、`viewer.js:126-133,188-191` | AA 二选一（`msaa:2` 或 `msaa:0`+FXAA），大画布按像素预算封顶 `resolutionScale`，引入动态分辨率 | `msaaSamples`/`scene.postProcessStages.fxaa`、dynamic resolution |
| **P1** | G6 | 3D Tiles 显存/细节调优缺失（全无相关参数） | grep 无 `maximumMemoryUsage`/`cacheBytes`/`skipLevelOfDetail`/`preferLeaves`；tileset 来自 `loadPhotorealisticTileset` | `skipLevelOfDetail:true` + `cacheBytes`/`maximumMemoryUsage≈1400MB`（6GB 预算）+ `dynamicScreenSpaceError` + `preferLeaves`，治飞越抖动/爆显存 | Cesium `Cesium3DTileset` 调优 |
| **P1** | G7 | 两套画质系统重叠（gev-graphics 预设 vs gev-perf 运行时覆盖）→ 冲突、不可预期 | `index.html:48,52` 均加载；`gev-perf.js` 覆盖 res/MSE/fps | 统一为**单一画质控制器**（gev-graphics 为真源，gev-perf 归并为其中一档），共享状态 | 状态收敛（对齐小程序 `_sigOf` 单源思路） |
| **P1** | G8 | label/billboard 纹理与 overdraw 成本高 | `src/layers/flights|cctv|radio` label 无统一距离裁剪 | 全层接入 `distanceDisplayCondition` + `scaleByDistance` + `translucencyByDistance`；远景剔除 | Cesium `distanceDisplayCondition` |
| **P1** | G9 | 后处理管线常驻风险（虽默认 enabled=false） | `gev-perf.js:63-66,78-83`(仅切 enabled) | 后处理仅在开启时 `add` stage，关闭即 `remove`，默认零成本；确认不是只 `enabled=false` 仍占采样 | Cesium `PostProcessStageCollection` |
| **P2** | G10 | 4K/高 DPR 屏 `resolutionScale` 到 2 会填充爆炸 | `viewer.js:188-190`(DPR 封顶 2) | 按画布**像素预算**（如 ≤2.3MP）换算封顶 `resolutionScale` | WebGL viewport 预算 |
| **P2** | G11 | 未按 GPU 画像自适应档位 | `gev-graphics.js:244-246`(已探测 UNMASKED_RENDERER) | iGPU→自动低档、独显→高档但封顶；渲染厂商名做默认档决策 | `WEBGL_debug_renderer_info` + 画像表 |
| **P2** | G12 | 常驻 rAF 循环静态空转 | 全局 126 处 `requestAnimationFrame` | 非可视/无动画态挂起；复用 `holdContinuousRender` 语义 | rAF 治理（对齐 renderGovernor） |
| **P2** | G13 | 图标/贴图未做纹理压缩 | 资源加载未见 KTX2/Basis | 图标图集化 + KTX2/Basis 压缩，降纹理上传与显存 | KTX2/Basis 纹理管线 |
| **P2** | G14 | tileset MSE 固定，未随相机高度/速度动态 | `viewer.js:191` 单一 `tileMSE` | 飞越时放宽、静止时收紧的 `maximumScreenSpaceError` 动态策略 | Cesium3DTileset 动态 LOD |
| **P2** | G15 | 缺统一 GPU 遥测进自检 | FPS 仅临时徽标；`gev-perf`/`frameRateMonitor` 各自为政 | FPS/帧时/GPU% 汇总进开机自检与调试 HUD，作为"执行前基线" | `performance-optimization` Step1/Step5 |

## 2. 建议执行顺序（measure-first，一次一项）
1. **先测基线**（G4+G15 的最小版）：在 4173 用 Chrome（RTX3060）记录当前默认 FPS/帧时间/分辨率/MSAA/pdb 实际值，写进 PROGRESS。
2. **P0 逐项**：G2(pdb) → G3(去默认降质+自适应60fps) → G1(航班聚类/距离裁剪) → G4(GPU 计时)。
3. **P1**：G5 → G6 → G7 → G8 → G9。
4. **P2** 打磨。
- 每项：改一项 → 同法重测 → 提升超过噪声才留、否则回滚 → 记录（含回滚项）。
- 视觉保真与低配降级双保险；不破坏现有功能与小程序 4173 联动。

---

## 3. 第二轮补充扫描（越细）新增项 G16–G24

| P | 编号 | 问题描述 | 证据(file:line) | 优化方向 | 依赖 Skill / 技术方案 |
|---|---|---|---|---|---|
| **P0/P1** | G16 | **大量 `CallbackProperty` 逐帧回调**驱动 tracking/注解（每帧重算几何 + 常驻渲染，**抵消 idle 治理器**） | `bhoteKoshiLocator:16`、`flights/tracking:8`、`military/tracking:5`、`localAdsb:5`、`launches/rendering:3`、`worldAnnotationRenderer:6`(§CallbackProperty) | 轮询驱动改 **`SampledPositionProperty`/静态值 + 拉取时 `requestRender`**；仅"正在跟踪的目标"用逐帧回调；标签脉冲改 CSS/节流 | Cesium Property API、`governorRequestRender` |
| **P1** | G17 | **默认双全屏后处理 pass**：`sharpen`(默认 40 启用) + `FXAA`(true) 每帧两道全屏着色 | `applicationShell.js:44,486,1192`(setSharpen)、`gev-graphics.js:52-54`(sharpen:40,fxaa:true) | 默认关 sharpen 或与 FXAA 二选一；高 DPR 降强度；空闲不渲染时本就 0（依赖 G3 idle） | Cesium `PostProcessStage` |
| **P1** | G18 | 航班 billboard 有 `scaleByDistance` 但**缺 `distanceDisplayCondition`**（远景不裁，仍绘制） | `flights/rendering.js:135,151`(scaleByDistance)；全层无 distanceDisplayCondition | 加 `distanceDisplayCondition` 剔除超远 billboard/label，配合聚类（G1） | Cesium `distanceDisplayCondition` |
| **P1** | G19 | 玻璃 `backdrop-filter` **模糊半径 24–28px 偏大**且多层叠加 | `command-dock.css:25`(28px)、`cockpit.css:1291`(24px)、`cctv.css:40` 等 | 半径降到 12–16px；静态面板预烘焙模糊；限制同屏叠层数 | CSS compositing、pre-baked blur |
| **P1** | G20 | CCTV **视频纹理按源分辨率上传** + 多路并发解码/上传 | `cctv/projection.js:217,228-229`(video.width=videoWidth)、`291`(ImageMaterialProperty)、`413`(play) | 限并发路数、纹理降采样（≤1280）、切走 pause+destroy（已有，`416/336`） | video texture downsample |
| **P2** | G21 | `cockpitCloudEffects` 是**独立第二 WebGL 上下文** + rAF 常驻（启用时） | `cockpitCloudEffects.js:378,546`(rAF)、`start()`、`cockpitCloudRenderSize:167` | 共享主上下文或降分辨率（有 `cockpitCloudRenderSize`）；仅"可见且启用"跑（有 `setSuspended`） | WebGL 上下文/离屏合成 |
| **P2** | G22 | 多处**自定义 `Cesium.Material` 着色器** + `scopeMask` 屏幕空间遮罩（曾由 6 个后处理合成） | `worldAnnotationRenderer:373,384`、`contactTrailRenderer:31,39`、`scopeMask.js:7,435` | 材质/ShaderProgram 缓存复用；仅可见时启用实例；scopeMask 确认单 stage 且静止不自增 | Cesium Material/程序缓存 |
| **P2** | G23 | 内联 `data:image` 21 处 + 主线程 `JSON.parse` 251 / GeoJSON 35（大解析阻塞风险） | grep 计数 | 大 GeoJSON 移 Web Worker / 流式；内联大图外置+压缩 | Web Worker、流式解析 |
| **P2** | G24 | **GPU 上下文数量**：主 Cesium + cloud + 临时探测 | `atmosphereCompat.js:128-164`(探测 ctx) | 探测 ctx 及时 `WEBGL_lose_context` 释放（已有）；cloud 按需 | WebGL context 管理 |

### 复核为"已达标 / 无需改"（避免误报）
- **SDR 数字信号在 Web Worker**：`sdr/controller.js:391` → 不阻塞主线程/渲染。
- **cyberSonar 事件驱动**：`cyberSonarScene.js:175,190` 条件 `scene.requestRender()`，非常驻。
- **CCTV 视频切换清理**：`projection.js:416/336` 有 `destroyProjectionRuntime`+`pause`，无泄漏。
- **无 globe 光照/阴影**：未开 `enableLighting`/`shadows` → 无阴影贴图开销（省）。
- **高频事件多已 passive**：`logoGaze:170`(passive)、wheel/resize 限流。
- **无外部 @font-face 阻塞**：系统字体栈。

### 结论（两轮合并）
- **P0 核心杠杆未变**：G2(pdb) / G3(去默认降质+自适应60fps) / G1(航班 billboard 聚类+裁剪) —— 其中 G1+G18(远景裁剪)+G16(去逐帧回调恢复 idle) 是提升"真实流畅度"的三件套。
- 新增 G16/G17/G19/G20 属**上一版遗漏的实际 GPU/CPU 成本**，已补齐。
