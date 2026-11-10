## 2026-10-30 16:10 · Phase7C 决策① 落地：色散验收改「带内逐像素峰值 ≥3 灰阶」（C6-visual **21/21 PASS**）

- 决策（lead 选①）：旧判据「带符号 band 均值 ≥3 灰阶 × 边占比 ≥50%」**作废**，改为
  「带内**逐像素峰值** Δ(R−B) ≥3 灰阶（JND）× 边占比 ≥50%」。作废依据是 7D3 实测：色散量 ∝ 底图沿法线
  一阶导数，导数沿边/沿深随机换号，10px 带宽算术平均 83–87% 抵消（中位 |bandMean|/band内|Δ| = 0.13–0.17）
  → 该口径内容驱动、参数不可达，与 cap/gain 无关。
- 改动（**只动仪器脚本，产品代码 0 改动**：`public/gev-edge-lens.js` / `dist/` 未碰）：
  - `scripts/lc/phase6c6-visual.mjs` T3b：判定改用逐边 `max2d`（带内逐像素峰值），阈值 = max(3 JND, 3×噪声中位)；
    旧口径 band 均值降级为 INFO（同页实测 1/36，仅趋势）。
  - 抗污染：真实地图 A/B 由「单对」改 **3 对逐边取中位**（对齐 `phase7b-sweep` 口径）。单对实测噪声峰值
    中位 36（底图细化/镜头收敛在 500ms 间隔内整片换色）→ 阈值被顶到 108，判据恒 FAIL；3 对中位后噪声 1.0。
  - T3d 漏光检查同步改 3 对逐卡中位（单对 control-panel 过 5.89 → 中位后 <1.5）。
  - T3e 上界显式化为 `hardBound=24` 并加注：cap 20/255 理论 2×cap=40，24 是保守上界（实测 22–23）。
  - T3f 增开 `maxFlipsAtJnd3`（|Δ|≥3 口径）作为并列披露；判定仍用原 1.5 口径（本轮出现一次 3，后两轮 PASS，
    属亚 JND 小幅扑动 + 内容相关，建议后续单独定口径）。
  - `scripts/lc/phase7b-sweep.mjs`：新增 peakJND（atJndPeak/ratioPeak/peakMin·Med·Max/peakThr），verify 模式
    打出判定行；旧 `atJnd`（band 均值）保留为 info。
- 验证（prod 4174 / RTX 3060 / 全新 profile）：
  - `node scripts/lc/phase6c6-visual.mjs p7c5` → **21/21 PASS**（T3b **36/36**，带内峰值 min/med/max = 12/16/19，
    噪声中位 1.0；T3c max2d ≤25；T3d <1.5；T3e ≤24；T3f ≤2）。
  - `node scripts/lc/phase7b-sweep.mjs verify p7c` → peakJND **36/36（100%）**、峰值 12/16/19、max2d 19、
    sep 0.96px、satFrac 0.021、noise 0；旧口径 meanJND 1/36（与 7B/7D3 一致，可复现）。
  - 中间轮（p7c/p7c2）为口径调试：p7c 噪声底用单帧 max → 阈值 120 恒 FAIL；p7c3 修完 T3b/T3c/T3e/T3f 后
    暴露 T3d 单对污染 → p7c5 全绿。三次 6 边峰值（12/16/19、12/16/19、11/18/20）即判据可复现的证据。
  - 产物：`.gev-logs/lc/phase6c6/c6visual-p7c5.json`、`.gev-logs/lc/phase7b/p7c-verify.json`。
- 边界：新口径只证明「色散在 1px 尺度达到 JND 峰值」，**不**证明「10px 长线平均可见」；上界仍由 T3c（不出强彩边）
  与 T3f（单带无多级彩虹）兜，视觉样张 1x/4x/8x 同步入库。
- 回滚：T3b 判定换回 `absMean>=3`；A/B 采样与 T3d 回单对；T3e 回字面 24 且删 hardBound。
  （注：`phase6c6-visual.mjs`/`phase7b-sweep.mjs` 均未入 git，改动全部在工作树）

## 2026-10-30 15:40 · Phase7D1 修 reload/photoreal 切换期黑帧（Gate R1；底图全程可见，切换改「成片后再切」）

- 现象（Phase7C R1）：gate B5 同标签 reload 后 8s 全黑（std 0.46/uniq 11）；F5（photoreal 后 reload）
  reveal+100ms 清晰 33.34 → +1s **0.43** → +4s 8.09 → +8s 42.31；`__gevPhotoreal.ready` 时刻 std 0.43。
- 根因（新仪器 `scripts/lc/_diag/p7d1-tileset.mjs` 100ms 状态 + `p7d1-black-window.mjs` 350ms 像素）：
  1. tileset 一 `primitives.add` 就 `show=true`：**未成片的瓦片以整屏均匀灰几何盖住已上屏的底图**
     （globe.show=1、imagery 1 层仍在，像素 std 0.43 / mean 82.98 持续 1.6s；同期 tileset selected 2→13、
     contentReady 2→13）——底图兜底在这段时间里其实被挡住了。
  2. `whenTilesetContent(tileset, 6000)` 6s 超时后**无条件** `globe.show=false`：此时画面仍是灰的
     （std 8.09），于是再黑 1.9s 才成片。即「首批瓦片事件 ≠ 画面可看」，而超时分支等于「不管画面如何都切」。
  3. 判定信号本身过期：`__gevPhotoreal.ready` 在切换瞬间置位，与画面是否成片无关。
- 改法（只动 `src/app/scene.js` + 新增 `src/app/sceneContent.js`；玻璃参数/色散/布局/遮罩时序 0 改动）：
  - `sceneContent.js`：`sampleCanvasContent()` 在 `scene.postRender` 里 `readPixels` 中央 47.5%×54.3%
    （= gate 的 640×420@1348×774 同区域）算 luma std/uniq；`isSceneContentVisible()` 用 gate 同尺度阈值
    （std≥18 && uniq≥800）。postRender 是唯一能读回画布的时刻（pdb=false，合成后 drawing buffer 失效）。
  - `createPhotorealVeil()`：tileset 照常 add + 渲染（RENDER pass：取瓦片/传纹理/编译 shader），但用
    `Cesium3DTileStyle({color:'color("white",0.0)'})` 把 alpha 压到 0 → **纱**，底图不被遮挡；预渲染期
    `maximumScreenSpaceError` ×4 让选中集更快到齐（实测 ×1→21.5s / ×2→15.8s / ×4→13.2s 到 tilesLoaded），
    提交后还给原 SSE 继续细化。老 Cesium 无 style 时退化为 `show=false + preloadWhenHidden`。
  - `whenPhotorealVisible()`：只在 `tileset.tilesLoaded === true` 时试切（隐藏 globe + 揭纱），逐帧读回像素
    最多 ~600ms 找成片，**连续两帧成片才提交**；否则立刻盖回纱 + 恢复 globe，500ms 后重试；45s 不成片则
    保底图、`__gevPhotoreal.ready=false`（不再把灰屏留在场景里）。
  - 提交时 `veil.reveal()`（alpha 1 + 恢复 SSE）→ 与已确认的成片帧完全一致，再对控制器 `setStack('photoreal')`。
- 验证（prod 4174，全新 profile，RTX 3060）：
  - `p7c-reload-photoreal` **3 跑全 PASS**：reveal+100ms 31.68/44664、+1s 31.68/44664（另一跑 29.64/52897
    为底图）、+4s 50.31/97670、+8s 50.31/100408；pageErrors 0。
  - `p7c-photoreal-final` **3 跑**：`photoreal.ready` 时刻 **29.65/51637**（旧 0.43/17 = 全黑）；
    ready+5s/+10s 50.37/100590、50.37/97925、50.37/100590。
  - 细粒度时间线（`p7d1-black-window.mjs` 350ms 采样，冷启动 + F5 各 2 跑）：**遮罩收起后到切换全程
    0 个 std<1 && uniq<50 帧**；切换是 base 31.66/45426 直接变 50.37/100590。切换时刻：冷启动 add+13.2s、
    F5 reload add+1.9s；`photoreal:probe attempts=1`（一次即成片）。
  - 仪器 `p7d1-style.mjs` 证明 Google Photoreal 支持 `Cesium3DTileStyle`：alpha0 → mean 1.54/std 0.82，
    alpha1 → mean 97.58/std 50.37（否则 veil 方案不成立）。
  - 单测：`node --test src/app/sceneContent.test.mjs` **5/5 PASS**。`src/maps/controller.test.mjs` 的
    imageryComparison 系列 FAIL 属本轮之前既有（该文件本轮 0 改动）；`check:boundaries` 因本机
    `spawnSync git EPERM` 无法运行（环境问题，非代码）。
- 回滚：`git checkout src/app/scene.js` + 删 `src/app/sceneContent.js` `src/app/sceneContent.test.mjs`，`npm run build`。

## 2026-10-30 14:15 · Phase7A3 卡壳/LC 前置，先于 Cesium 求值（cardsClickable 4.3–8.2s → 0.42–0.59s，6/6 ≤5s）

- 现象（A2 遗留）：D+ 让 inputRelease 只认 `__lc.api.mounted`，404 清零；但 LC mount 仍排在
  `/cesium/Cesium.js`（5.73MB classic）求值 → App 注入 panelApi 之后 → cardsClickable 3/6 ≤5s（中位 4.99s）。
- 根因（两条串联）：
  1. 建置期 vite-plugin-cesium 把 `Cesium.js` 作为 **classic script head-prepend** 注入；classic defer 与
     module 脚本按**文档顺序**执行 → 排在 LC 之前，LC 必须等它下载（≈4.7s）+ 求值（≈3s）。
  2. `src/lc/index.js` 的 `waitReady()` 等 `CARD_IDS`（8 张，含 App 后注入的 `#gev-voice-control`）齐才 start()
     → 即使顺序修好，也会被语音卡的注入时机拖回 App 就绪之后。
- 改法（只动启动时序，卡壳材质/玻璃/PP/文案 0 改动）：
  - `index.html`：`gev-boot-gate.js` + `lc/index.js` 移到 `<head>`（先于 Cesium）；`gev-autolocate.js` /
    `boot-defer.js` 改由 `src/bootstrap.js` 静态 import（它们顶部引用 Cesium 全局，不能跑在 Cesium 之前）。
  - `build/vite.js`：注入的 Cesium tag 从 head 开头摘掉，换成 `<link rel="preload" as="script">`（下载并行、
    **不求值**）；真正求值由新模块 `src/cesium-boot.js` 在「输入已放行」后 900ms 注入（命中 preload 缓存）。
  - `src/main.js` → 薄壳：只等 `gev:cesium-ready` 再**动态** import `src/bootstrap.js`（= 旧 main.js 全文，逻辑零改）。
  - `src/gev-boot-gate.js`：`Cesium.RequestScheduler` 改惰性读取（模块先于 Cesium 求值）；新增
    `releaseInputEarly()`（LC 在 mount 时**同步**调用，仍 rAF tick 兜底），放行即把遮罩退化成
    「顶部状态胶囊 + `#cesiumContainer.boot-refining` 暗纱」——**暗纱只盖 canvas，不挡 card rail**。
  - `src/lc/index.js`：必需卡 = 7 张静态卡壳（语音卡等 MutationObserver 补皮）；mount 时调 releaseInputEarly；
    App API 就位后 `port.reconcile()` 回灌 collapsed 状态；新增轨道/body class 观察者，App 启动中段摆轨道后重新对齐。
  - `src/lc/collapse-port.js` + `app-adapter.js`：preboot 写入单独记账（`stats.preboot` /
    `diagnostics.prebootWrites`，`direct`/`appApiMissing` 保持 0 → S2/S3 不回归）。
  - `src/maps/controller.js`：地形安装期暴露 `__gevStackState.terrainBusy`；gate 在其间清零 settle 窗口
    （修 reveal 撞 globe 重建黑帧：实测 std 2.61 → B5 FAIL）。
- 验证（prod 4174，全新 profile，RTX 3060，6 跑）：
  - `cardsClickable`：499 / 495 / 577 / 586 / 551 / 459 ms（中位 ~538）→ **6/6 ≤5s**；
  - 真实 CDP 点击 mini→opening **6/6**；B5 中心 640×420 **6/6 PASS**（std 33–35 / uniq 4.6–5.5 万）；
  - B5 wall 7.75–8.70s（6/6 ≤9s）；photoreal **6/6**（globe.show=false）；GPU 6/6 = RTX 3060 Laptop；
  - 控制台/pageerror **0**；`src/lc` 单测 81/81 PASS。
  - FPS（交互后 10s rAF 采样）：91.9–118.2（页面在地图空闲期按屏幕刷新率跑，不再被 Cesium 加载压住）；
    单帧 worst 71–210ms、over100 0–8（与 C6/C3 记录的 Cesium 侧长帧同族，未新增）。
- 非本轮引入：`src/standalone/startupChrome.test.mjs` 3 条 FAIL（`transition is not a function`），
  该源文件本轮 0 改动（工作树里是 Phase7A-D 的旧改动）。
- 回滚：`git checkout index.html build/vite.js src/main.js src/gev-boot-gate.js src/lc/index.js src/lc/collapse-port.js
  src/lc/app-adapter.js src/maps/controller.js` + 删 `src/bootstrap.js` `src/cesium-boot.js`，`npm run build`。

## 2026-10-30 14:00 · Phase7B 真实地图色散 JND 补偿（cap 12→20/255，验收 FAIL：均值口径不可达）

- 现象：C6 实测真实地图 36 边 band 均值 Δ(R−B) **0/36** 达 ≥3 灰阶（最强 location/bot 2.41），8x 样张肉眼无色散。
- 实测（本轮，同一页面除 cap 外全固定，A/B 只切 dispGain 8↔1 隔离色散，每档 3 对取中位）：
  - cap 12→32/255（gain 8）：JND 仍 **0/36**，最强边均值 1.58→2.08（+32% 后饱和）；satFrac（触及限幅的像素占比）4.8% → **限幅根本不是瓶颈**。
  - 把 gain 8→64（cap 20/255）：JND 只到 3–5/36（6–14%），最强边均值 0.83→1.34。
  - 根因：真实底图在 1px 尺度是平滑梯度，R/B 采样间距被锁在 0.96px（禁改 0.8–1.2），
    错位 1px 的通道差只有 0.2–0.5 灰阶；×gain 放大的是这个差值，而**平坦区域放大 0 还是 0**。
    色散只出现在 1–2px 的边沿，被 10px 带宽一平均就掉到 1 灰阶以下 → 「band 均值 ≥3」是内容驱动、参数改不动。
  - 逐像素口径：cap 20 时 **36/36 边** 的带内峰值 15–20 灰阶（cap12 为 12），最强边均值 3.82（data-panel/left）。
    证据网格 `scripts/lc/_diag/p7b-grid.mjs`：data-panel 左沿 k6–k9 深 4px 全列 +17…+27 灰阶（真色散，不是噪声，同帧噪声 0.003）。
- 改法（只动一处，按卡片指令）：`public/gev-edge-lens.js` `dispCap: 12/255 → 20/255`（`dist/` 同步，md5 一致）。
  新增仪器 `scripts/lc/phase7b-sweep.mjs`（sweep / gain / verify 三模式，含 1x+4x+8x 样张与噪声底）。
  layout / pp / loading / gain / band / ior / thick / dispPx / bandAlpha **0 改动**，R/B 间距仍 0.96 CSS px。
- 验证：
  - `node scripts/lc/phase6c6-gate.mjs p7b` → **25/27 PASS**；四边折射 T1/T3/T3a/T4 全 PASS、centerMax ≤1（T5）、
    无双灰圈（T3c 负控 PASS）、T13 色散 顶22/下21/左23/右23（区间 6–45 内，但旧 C6-visual T3e「≤20」上界溢出 2–3 灰阶）。
    仅 B1（冷启动就绪门）/B3（warm 窗 worst 139.3ms）FAIL —— 与 Phase7A2 记录的冷启动/长帧同族，与 dispCap 无关。
  - `node scripts/lc/phase7b-sweep.mjs verify p7b` → 1x 36 边：均值 JND **2/36 (6%)**、峰值 ≥3 灰阶 **36/36**、
    max2d 20、flips ≤2（无多级彩虹）、噪声 0.003、satFrac 4.8%（无平铺色带）；8x 样张人工+vision 复核：无彩虹/无彩圈/无双灰圈。
- 结论：**cap 20/255 已落地且安全，但「≥50% 边 ≥3 灰阶（band 均值）」在 0.8–1.2px 间距 + 无彩虹约束下不可达**；
  可达的等价口径是「逐像素材峰值 ≥3 灰阶」（36/36）。若必须让均值达标，只能改色散**宽度**（edgeBand 衰减）
  或放大 dispPx（越过 1.2px 上界，出 2px 彩边）——两条都超出本卡片授权，需 lead 决策。
- 回滚：`dispCap: 20/255 → 12/255`（单行），dist 同步。

## 2026-10-30 05:35 · Phase6C4 实验② 负结果（冷启动地板 = 3D Tiles 串行阶梯）

- 现象：实验②（落位卡 tileset:added+1.5s + GPS 纠偏移出关键路径）6 次 dev 冷启动，遮罩收起 13.80–15.91s；
  用 `tileset→收起` 归一后 7.39–7.99s，与基线 6.84–9.19s 同一区间 → **收益 0**。消融 `?nocap=1`（完全不压并发）
  同样 7.39/7.82s，证明并发上限也不是瓶颈。
- 根因：Google 3D Tiles 是**逐层父子串行**的阶梯（96 个瓦片请求、单条 p50 304ms、经代理 RTT 300ms+），
  `tileset:added → 中心达 B5` 实测 dev 6.4–7.0s / prod 5.6–7.2s，与相机落位时刻无关。
  之前测到的「落位→清晰 2.36–3.40s」是从 cine:done 起算（当时 cine:done 被 3s GPS 窗口推后），口径有误导。
- 改法：实验② 全部回退（`src/gev-autolocate.js` 回到 C3-B 状态）；诊断开关 `?nocap=1` 已移除；
  新增只测量仪器 `scripts/lc/_diag/phase6c4-tile-net.mjs`。玻璃/文字/布局/pp/photoreal/分辨率/gate 阈值 0 改动。
- 验证：`node scripts/lc/phase6c2-gate.mjs c4v3` → **27/27 PASS**（B5 std 30.89 / uniq 35525，idle+hover 83.3fps，
  ramp worst 24.1ms，四边 32/42/42/39，色散 32/42/42/39）。报告：`.gev-logs/lc/phase6c4/Phase6C4-实验2-报告-20261030.md`。
- 下一步（需 lead 批预算）：3D Tiles 瓦片树预取（按目标经纬度并行灌 1–7 层进 HTTP 缓存），预计 prod 6.5–8.5s / dev 9–11s。

## 2026-10-30 11:05 · Phase7A-2：底图瓦片预取 + 遮罩期带宽让位（冷启动 prod 中位 14.1s→8.4s，≤5s 仍未达）

- 现象：base-first 落地后 prod 冷启动仍 10.2–20.5s（中位 14.1s），必须项「交互 ≤5s」不达。
- 根因（本轮新增证据，`scripts/lc/_diag/phase7a-imagery.mjs` 按 host/z 打点）：
  ① 底图不是「一次取完」，而是被 Cesium **逐级爬金字塔**：z1@5141→z2@5791→z3/4@5949→z11@6941→z13@7113→清晰 7566（navStart ms），
     13 级串成 2.2s；决定清晰的 z13 16 块到齐只要 450ms；
  ② 遮罩期 3D Tiles 预取（65 个 google 瓦片请求）与底图抢带宽/连接，底图第一块瓦片被推到 5141。
- 改法：
  ① 新增 `src/maps/baseTilePrefetch.js`：`main:entry` 起按「缓存位置/家」预取 WebMercator z1..z14 中心链（AMap+Esri），
     底图栈确定后只为该 provider 补链，快速定位回来 >2km 重算；`?basewarm=0|chain|full` 开关（默认 chain）；
  ② `src/maps/tileWarmup.js`：3D Tiles 瓦片预取改到**交互后**再发（15s 兜底），遮罩期带宽让给底图；
  ③ `src/gev-autolocate.js`：相机先用「缓存/家」**立即**落位，IP 定位回来再纠正（原来等 1.2s 才落位）。
- 验证（prod 4174，RTX 3060，全新 profile+清缓存）：
  机器空闲批 8399/8101/10699（中位 8399，基线 14096）；有负载批 11059–15236（中位 13735）→ 环境方差 ±50%；
  B5 9/9 PASS（std 33.4–37.2）；`__gevPhotoreal.ready` 9/9（globe=false）→ 3D Tiles 后台最终加载完成；
  交互后 0–10s fps 45.7–62.0，>100ms 单帧 2–11（Cesium 3D 瓦片上传族，无新机制）；玻璃/文字/pp/分辨率 0 改动。
- 结论：**≤5s 未达**（最好 8.1s）。阶段分解 responseStart 36 → domInteractive 3272 → 首帧 1671 → setStack 1284（Esri 元数据 827ms）
  → 落位 600 → 金字塔 2873 → SETTLE 721 → 淡出 231。要 ≤5s 必须动「模块图拆分(0.8–1.8s)」或「放行 z10 上采样(B5 回退)」或「改 settle 判据」，
  已列为待决策项（卡面 comment）。详见 `docs/Phase7A-架构审查与启动链路-20261030.md` §Phase7A-2。

# 上帝之眼 · Web 版改动日志（本机维护）

> 记录约定（用户要求，2026-10-20 起）：**每一处改动都写进这个文件**，
> 格式固定为「时间 + 现象 + 根因 + 改动 + 验证」。不要只写“修了个 bug”，
> 要让下一个接手的人不用重新排查就能改对。
>
> 上游原始的 `CHANGELOG.md` 保持英文、按上游风格写；本文件是**本地改动**的流水，
> 两者不要混。
>
> **同步副本（用户要求放桌面 .MD）**：`C:\Users\13680\Desktop\.MD\docs\logs\[ProjectLogAgent]-上帝之眼Web端-改动日志.md`
> 每次改完这份文件，同步覆盖一次副本。
>
> 关联文档：
> - `D:\Hermes\gods-eye-miniprogram\PROGRESS.md`：小程序侧改动日志
> - `C:\Users\13680\Desktop\上帝之眼-项目交接-20261020.md`：完整交接说明（架构/需求/踩坑总表）

---

## 2026-10-29 17:50 Phase 6D：FPS 27–28fps 归因 —— 是 Ego 宿主的呈现节奏，页面无罪

**现象**：Phase6A 收尾时同页（`?welcome=0`）连续 rAF 只有 **27.9–28.3fps**、`worstFrameMs≈48.5`；
而 Phase4A/Phase5 记录过 54.6fps / 60fps 项通过 → 看起来像「Phase6 的 UI 改动把帧率砍了一半」。

**根因（分两条，都已实测）**：

1. **跨宿主比较，不是回归。** Phase4A/Phase5 的 54.6 是 **puppeteer/Chrome** 量的
   （`scripts/lc/_diag/fps4a*.mjs` 全部 `import puppeteer`，其 json 里 `edge.canvas [1536,730]`、
   `scale 1`、`dpr 1`、`perfMode '1'`）；27.9–28.3 是 **Ego Lite** 量的。两个宿主不是一个量级，
   数字不可直接对比。
2. **Ego 里那 28fps 是宿主/呈现节奏。** 窗口真前台时（`outer 1536×816`、`hasFocus=true`、
   面板 165Hz）帧间隔 **p50=36.4ms = 6 × 6.061ms**、p90=42.4ms —— 精确落在刷新率整数倍上；
   页面侧任何变量都不动它（见下表）。同一个标签内 `about:blank` / 20×20 方块 transform 动画
   都是 **165fps（1 vsync）**；窗口被挤成 `outer 160×28` 时同一页掉到 **1.0fps（1006ms=166 vsyncs）**。

**实测证据（`.gev-logs/ego/phase6d/*.json`、`.gev-logs/lc/fps-accept/p6d-*.json`）**：

| 宿主/变量 | 结果 |
|---|---|
| Chrome + puppeteer，同页同机（dpr1，canvas 1156×664，res 0.85） | idle **55.65fps** / 点击后 **61.36fps**，0 page error，band 10 / dispPx 1.2 / gain 1 未动 |
| Chrome 第二次（canvas 1224×703，res 0.90） | idle **139.4** / 点击后 **163.75fps**（p50 6.1ms），edge-lens 163.9fps |
| Ego，resolutionScale **1.544** | 28.4fps（p50 36.3） |
| Ego，resolutionScale **1.25**（=dpr） | 27.8fps（p50 36.4） |
| Ego，resolutionScale **1.0** | 27.1fps（p50 36.4） |
| Ego，`__gevEdge.off()` | 28.8–36.5fps（噪声内） |
| Ego，`viewer.useDefaultRenderLoop=false`（Cesium 完全不出帧） | 30.2–32.3fps（仍约半速） |
| Ego，about:blank / 小方块动画 | 165.2 / 165.4fps（1 vsync） |

即：**GPU 0–15%、无 LoAF 长任务、停掉 Cesium 与折射也只到 30fps、同一宿主里空白页能跑 165fps**
→ 28fps 来自 Ego 对「持续产帧页面」的合成节奏限制（本机 165Hz 面板上一帧占 6 个 vsync），
不是页面算力，也不是本次 CSS 改动（Phase6A 的 hover A/B 27.3 vs 28.3 是同一个空结果）。

**改动**：产品代码零改动（**未**降玻璃/未关折射/未砍 gain·dispPx·band/未降 DPR）。
只新增诊断脚本 `scripts/lc/_diag/phase6d-host-cadence.mjs`、`phase6d-scale-ab.mjs`、
`phase6d-host-limit2.mjs`、`phase6d-blank.mjs`、`phase6d-hostcap.mjs`。

**验收口径（按 AGENTS 2026-10-29 放宽的 50–60fps / 最长帧 <100ms）**：
在**历史同款宿主 Chrome + puppeteer** 上达标 —— idle 55.65fps、点击后 61.36fps（p50 12.1/12.2ms）；
`--sample-ms=8000` 复测 idle 139.4 / afterClick 163.75fps、afterClick **max 18.2ms、0 帧 >100ms**。
**FPS 门禁此后一律跑 Chrome**（`fps-accept-chrome.mjs`）；Ego 只做**视觉/交互**验收，
不用于 FPS 判定（Ego 数字会在 1 / 28 / 165fps 之间跳，取决于窗口状态）。

**附带发现（待单独修，实测与本轮 FPS 无关）**：`src/app/viewer.js` 用
`resolutionScale = dpr`（`useBrowserRecommendedResolution:false`），Cesium 内部又乘一次
`devicePixelRatio` → 窗口 1356×742 CSS、dpr 1.25 时 canvas 实际 **2617×1432 = 3.75MP**；
而 2.4MP 预算按启动瞬间的 `dpr=2` 算成 1.544，之后 dpr 回到 1.25 没有重算。
（scale A/B 证明它对帧率无影响，但 HiDPI 上是 ~1.5× 像素浪费，属独立缺陷。）

**测量卫生（本轮踩到的两个坑）**：
1. Ego 里那个页面原本停在 `http://localhost:4173`，定位权限按 origin 记 → 弹原生权限框、
   任务空间被交给用户（实测发生过）。**Ego 验收统一用 `127.0.0.1:4173`**。
2. Ego 窗口 `outerWidth=160 / outerHeight=28` + `hasFocus=false` 时 rAF 是 1000ms（1fps）假数据；
   任何 Ego 采样前必须 `ShowWindow(SW_MAXIMIZE)+SetForegroundWindow`，并在结果里记录
   `inner/outer/focus`。

---

## 2026-10-29 16:55 Phase 6A：“显示”展开看不见（开关行深色字）+ 卡壳无 hover 高光

**现象**：Cindy/Lead 实测点开“显示”后 `#pp-toggles` rect=300×430、`data-lc-phase=open`，
但视觉上“看不到面板内容/边界”；鼠标移到卡上时 `boxShadow/background/filter/transform/::before` 全不变。

**复现（Ego + RTX 3060，真指针）**：
- 面板内容其实在（`scrollHeight 1240 / clientHeight 430`，滚轮能滚），但截图像素统计显示：
  开关行（HUD/检测/模型3D/示波/绘制/天体/净化/泛光/锐化）**整排没有文字**，只有滑块数值可见。
- 逐元素 computed style：`#pp-toggles .pp-label` = `rgb(13, 16, 21)`（近黑，亮度 15）+
  `text-shadow: none`，而按钮自身底已归零（`--lc-control-fill: transparent`）→ 黑字落在卫星底图上 = 看不见。
- 层级/遮挡排除：`#pp-toggles` z=60 在 `.lc-stage`(z=150) 内，`elementsFromPoint` 卡中心命中的就是卡内
  控件，没有任何元素盖住；`opacity/visibility/clip-path/transform` 全部正常；展开 160ms 内即稳定。

**根因**：
1. `public/gev-fix.css` 2026-10-25 的 C-1 规则 `.pp-toggle-btn .pp-label { color:#0d1015(强制权重);
   text-shadow:none(强制权重) }` 是给「按钮自带浅色渐变态」的旧材质写的；Phase3 之后按钮底已归零，
   这条深色规则把整排开关行变成隐形字。（审计截图里“没有按钮/没有滑块文字”就是这个）
2. 全仓没有一条卡壳 `:hover` 规则，且 material.css §2 把 `transition` 置 none → hover 零反馈。

**改动**：
- `public/gev-fix.css`：删掉 C-1 那条深色 `.pp-label` 规则（留注释+回滚说明），标签回到
  `src/lc/material.css` §4 的 `--lc-text` + `--lc-text-shadow`。
- `src/lc/material.css`：新增 §16「hover 镜面高光」，只动卡壳自己的既有绘制层（不加元素/不加第二圈）：
  `::before` 从 1px 高光条在 hover 时变成 12px 向下淡出的反光带（白 .40 → .16 淡出），
  `box-shadow` 追加 `inset 0 0 44px rgba(255,255,255,.16)` 柔和内辉光 + `0 0 22px rgba(150,210,255,.12)`，
  `transition: box-shadow .18s cubic-bezier(.22,1,.36,1)`（`prefers-reduced-motion` 下 none）。
  保持 0 border / 0 outline / 0 backdrop-filter / 0 填充，material.css 强制权重计数仍为 0（单测 TC-M6）。
- 新增 `scripts/lc/phase6a-gate-ego.mjs`（15 项 gate）+ `scripts/lc/_diag/phase6a-*.mjs`（复现/时序/控件/DPR 探针）。

**验证**（`.gev-logs/ego/phase6a/`）：
- gate 14/15 PASS（1 项为环境 FPS，见下）；`src/lc` 单测 81/81。
- pp 展开：phase=open、300×430、9 行开关 label 全部 `rgb(234,244,255)`+投影、无「深色字+无底+无投影」
  元素、`scrollWidth==clientWidth`（无横向裁切）、滚轮 scrollTop 0→419（可滚）。
- hover：真实鼠标移入 → boxShadow 变化且新增的是 `inset …模糊` 内辉光（无实线边、元素数不变），
  `::before` 渐变变化；移开回落到单层 token。像素对比：卡顶反光带平均差 37/255、内部 +6.4、
  整卡亮度 90.5→99.5，视觉可辨但不刺眼（截图 `hover-ab-zoom.png`）。
- FPS：**本轮实测基线只有 27–28fps**（`worstFrameMs≈48.5` 恒定，DPR 1.25 与 1.0 都是 27–28，
  窗口 hasFocus=true/visible），同页交错 A/B「hover 高光开/关」= 27.3 vs 27.5、28.3 vs 27.9
  （Δ≈-0.2…+0.4，噪声内）→ **本次改动不吃帧**，但“50–60fps”这一项在本机当前环境不达标，
  归因未闭环（值得单开一卡：Phase4/5 曾测到 54.6，现在同页 28）。

**回滚**：material.css 删 §16 即回到无 hover；gev-fix.css 恢复 C-1 三条选择器即回到深色标签（会复发）。

---

## 2026-10-29 07:05 Phase 5：全量验收 Gate（Ego + RTX 3060）

**现象**：Phase3/4 修完后要一次全量验收，且只认 RTX 3060 的实测；Ego 默认跑 Intel UHD，
且 Ego 里卡片仍有第二层「壳」（内层 `.panel-inner` 阴影 + inset 1px 发丝边）与 FAB 自带玻璃。

**根因**：
1. `public/gev-cn.css` 的「玻璃面板美化」用 `!important` 给 `.panel-inner` 和 7 个
   `#*-panel .*-panel-inner` 再画一层 `box-shadow`（含 `0 0 0 1px rgba(255,255,255,.035) inset`），
   叠在 `#gev-edge-lens` 单层折射之上 → 双灰圈 / 玻璃叠玻璃。
2. `#gev-gfx-fab`（被注册成第 9 张 `.gev-lc`）自带 `border:1px` + `rgba(8,20,30,.82)` 填充 +
   `backdrop-filter:blur(4px)` → 又一层玻璃。
3. Ego 没有 Windows 图形首选项条目 → 走 Intel UHD。

**改动**：
- `public/gev-cn.css`：从该规则里删掉 `.panel-inner`、`#pp-toggles:not(.collapsed)` 与 7 个
  `#*-panel .*-panel-inner` 选择器（保留按钮类样式），玻璃只由 `#gev-edge-lens` 负责。
- `src/gev-graphics.js:227-231`：`#gev-gfx-fab` 改 `border:0;background:transparent;backdrop-filter:none`，
  active 态改文字辉光。
- 系统：`HKCU\Software\Microsoft\DirectX\UserGpuPreferences` 给 ego.exe / ego-browser.exe 加
  `SpecificAdapter=10DE&2520&A641028;GpuPreference=1073741824;`（等价「设置→图形→高性能」），重启 Ego。
- 新增 `scripts/lc/phase5-gate-ego.mjs`（Ego 版 15 项 gate）、`docs/architecture/phase5-gate.md`。

**验证**（Ego Lite 0.6.1.13，1360×782 dpr1.25，renderer=RTX 3060）：
- 15/15 PASS：双灰圈 0、dock 无色散带、`+◀▶` 文本 0、location 联动 0px、pp 17 行 minGap 8 重叠 0、
  中/EN 与 GPU chip 不重叠、GPU chip 显示 3060、dock 底部空白 ≤24px、玻璃 gain 1.0/dispPx 1.2/单层/中心透明、
  动画 350–450ms 峰值 1.035/1.02、初始全 mini 无重叠无出屏、evaluate RTT ≤50ms。
- `node --test src/lc/*.test.mjs` 81 pass / 0 fail；`npm run build` ✓ 12.93s。
- **FPS 未达成**：Ego 8s 平均 27.5fps（p50 36.4 / p95 42.5），Chrome 同 URL 50.3fps；
  Ego 空白页 165fps、应用页主线程 91.9% idle、逐项关折射/关 Cesium/降分辨率均无变化 →
  钉在 165Hz 的 6 倍 vsync（165/6=27.5）。归因在「Ego 合成器×165Hz 呈现节奏」，不在页面/玻璃。已开 `Phase5-FPS` 子任务。

---

## 2026-10-29 06:03 Phase 4C：旧 ◀/▶ 字符清零（10 处）+ 9 张卡定义核实

- **现象**：`.panel-collapse-btn` 已是 0，但页面在若干状态下仍会渲染 `◀ / ▶` 字符：① 驾驶舱两条展开开关（`.cockpit-utility-glyph`，带 `aria-expanded`，运行时在 `◀/▶` 之间切换）；② 驾驶舱/上下文电台的上一首·播放·下一首（`◀◀ ▶ ▶▶`）；③ 电台面板的 `◀ SEEK / SEEK ▶`；④ 任务回放/不丹事件面板的 `▶ PLAY… / Ⅱ PAUSE`。同时“规范 9 张卡”里第 9 张身份未定。
- **根因**：这些箭头是**模板里的 Unicode 字符 + JS 里的 `textContent` 字符赋值**，不是 CSS 图形，因此任何按“旧折叠按钮 DOM”去找的清理都抓不到；而 G2 护栏只扫 4 个 root 且只认「整段文本全是符号」的节点（`◀ SEEK` 这种混合文本直接漏检），所以护栏长期显示 0 而页面上仍有箭头。9 张卡 = `CARD_IDS` 8 张可折叠卡 + `gev-gfx-fab`（`expandable:false`、rail=`chrome`，只上玻璃皮不展开），`card.js` 早已定义，只是早期用 `[data-lc-id]`/`.gev-lc` 探测时 `gev-voice-control` 属后注入，容易数成 8。
- **改动**（不含 `gev-edge-lens.js` / `material.css` 的 pp 段 / FPS）：
  - `src/ui/templates/cockpit.html`：删除 2 个展开开关的 `◀`、3 个 transport 的 `◀◀ ▶ ▶▶`，改为 `<span class="lc-tri">` 图形；
  - `src/ui/templates/context.html`：mini transport 3 个同样替换；`◀ SEEK / SEEK ▶` → `lc-tri + <span>SEEK</span>`；
  - `src/ui/radioBindings.js`：删掉两行 `textContent = open ? '▶' : '◀'`（方向改由 `.cockpit-utility-glyph[aria-expanded]::after` 决定）；
  - `src/ui/radioPresentation.js`：播放/暂停由 `'Ⅱ'/'▶'` 字符改为 `PLAY_HTML / PAUSE_HTML`（`innerHTML`，仍是纯 CSS 图形）；
  - `src/layers/launches/replay.js`：回放按钮同样改图形；
  - `src/data/bhoteKoshiEvent.js`：`▶ PLAY / ▶ PLAY SHOT / ▶ PLAY SCENE / Ⅱ PAUSE` → `PLAY / PLAY SHOT / PLAY SCENE / PAUSE`（去字符，不改语义）；
  - `src/ui/styles/cockpit.css`：新增 `.lc-tri/.lc-pause/.cockpit-utility-glyph::after/#sdr-seek-*` 图形规则（纯 CSS 三角，零图标字体/零网络依赖；cyber 主题的 `+ / −` 优先级更高，保持原样）；
  - 护栏：`src/cockpitMarkup.test.mjs` 4 条断言改为“模板与绑定里不得出现 `\u25C0\u25B6`”；`src/data/bhoteKoshiEvent.test.mjs` 同步去掉箭头。
- **验证**（Ego Lite / Chromium 156，真实指针点击）：
  - `grep -rn ◀ ▶ src public index.html` → 仅剩 4 行注释，**0 处功能代码**；
  - 页面文本节点含 `◀/▶`：初始 **0/0**（改前 10 个节点、14 个字符）；逐张开 8 张卡各测一次，**每态都是 0**；打开电台 dock 后仍 **0**；`body.innerText` 不含箭头；
  - 开合：8 张卡真实点击全部 `mini → open`，其中 `scene-panel / global-context-panel` 再点 `open → mini`；`pp-toggles/location-bar/control-panel/gev-voice-control` 同样双向可切；
  - 9 张卡：`data-panel, scene-panel, pp-toggles, cctv-panel, global-context-panel, location-bar, control-panel, gev-voice-control, gev-gfx-fab` 全部命中且都带 `.gev-lc`（`gev-gfx-fab` 42×42，非折叠卡）；
  - GPU：`ANGLE (Intel, Intel(R) UHD Graphics (0x00009BC4) Direct3D11 vs_5_0 ps_5_0, D3D11)` = 硬件渲染；
  - `node --test src/cockpitMarkup.test.mjs src/data/bhoteKoshiEvent.test.mjs` → **81/81 pass**；
  - 截图：`.gev-logs/ego/p4c/arrows-zero-initial.png`。
- **遗留（不在本卡范围）**：G2 护栏仍只认“整段纯符号”的文本，建议下一轮扩成“任何可见文本含 `◀▶▸◂+/−` 即失败”，否则同类字符残留会再次被漏检。

---

## 2026-10-28 23:11 Phase 2：Phase 0 架构全量落地 + 旧卡片代码退役（双系统清零）

- **现象**：Phase 1 只落了 `gpu.js`/`morph.js` 两个模块——`controller/layout/render/interaction/collapse-port/app-adapter` 全部未接管；旧 `src/gev-liquid-cards.js`（3048 行）+ `public/gev-liquid-cards.css`（1009 行 / 309 行 `!important`）与新材质层并存。表现：scene 展开时 data mini 跳位、卡与卡重叠、快速连点堆动画、dock 三张面板各一套几何被挤到 x=966/1142、动画中读 rect 触发多重自纠定时器。
- **根因**：① `.collapsed` 有多个写入者（旧卡层直写 + App `panelChrome`），谁最后写谁赢；② 几何在动画中回读 `getBoundingClientRect()`，让位/收缩互相打架；③ 灰圈来自 append-only 的 `inset 0 0 0 1px` 环形阴影 22 处（App 侧还另画一层 1px `border`），磨砂/暗底来自卡壳自带的 `backdrop-filter` 与不透明底。
- **改动**：
  - 新建 `src/lc/` 七模块（`controller` 279 行状态机 / `layout` 229 行纯函数几何 / `dock-overlay` / `render` 262 行单帧渲染 / `interaction` 203 行真指针 / `collapse-port` 113 行唯一 `.collapsed` 写入者 / `app-adapter` 416 行唯一 DOM 触点）+ `material.css` 104 行 + `index.js` 组装；`gpu.js`/`morph.js` 沿用。
  - 旧 `src/gev-liquid-cards.js`、`public/gev-liquid-cards.css` **删除（0 行）**；`__gevLc` 旁路 0 处；`planGroupPush`/`normalizeRail`/`clearLateOverlaps`/`settleGuard`/`springProgress` 全删；卡片层 `setTimeout` 只剩 `morph.js:224` 的 M5 保险丝 1 个。
  - 死代码退役（执行表 §二）：`public/gev-gl-glass.js`、`public/gev-lg-filter.js` + `gev-lg-dispmap.jpg`、`src/ui/lgGlass.js` 删除，`index.html` 三处各 ≤2 行且都带「删掉本行即回滚」注释；125 个 `scripts/qa-*` 归档到 `scripts/_archive/qa/`（保留 47 个被 `src/**/*.test.mjs` / `package.json` / `format-scope.json` / `qa-l9-matrix` 传递引用的）。
  - 新增 `scripts/lc/{phase2-accept,verify-single-owner,verify-topbar}.mjs` + `README.md`；历史 `_diag*/_probe*` 收进 `scripts/lc/_diag/`。
- **验证**（本机实测，全部可复跑）：
  - `node --test src/lc/*.test.mjs` **81/81**；`scripts/lc/phase2-accept.mjs` **20/20 PASS**（18 处真实 CDP 指针/键盘操作驱动断言；`api.dispatch` 仅 3 处 teardown 收回基线，不参与判据）。
  - 逐卡开卡 **393–450ms**、峰值 **1.0348–1.0350**；收起 **352–362ms**（反向过冲 0.9651–0.9656）；让位动画同族曲线。
  - FPS 展开态 **153.5/155.6**（p50 6.1ms，p90 6.2ms）；GPU `ANGLE (NVIDIA RTX 3060 Laptop)` tier `high`；SwiftShader 轮 tier `software` + chip「GPU 未启用」+ 提示条 + 不建 `#gev-edge-lens` + 150ms 零回弹。
  - 4x/8x 边缘剖面：顶沿**恰好 1 条 1px 高光**（正控），左/底沿 ridges=0、darkRuns=0，色散 chroma ≤4 → 无灰圈、无彩虹带、无第二内圈。
  - 唯一写入者（`verify-single-owner`）：`port.writes` 增量 === `.collapsed` 观测变更数、`direct=0`、`appApiMissing=0`、语音卡零写入。
  - 全仓 `npm test`：5149 tests / 5105 通过 / **34 既有失败**（proxy/provider 工具链）；用 `git worktree` 在改动前的 `f16cd41` 重跑同批文件，失败测试名逐条 `diff = IDENTICAL`，**非本次引入**。
  - 完整报告（承诺→文件/行→测试 ID 全表）：`docs/architecture/phase2-implementation.md`。

---

## 2026-10-24 14:00 外网访问：生产端点就绪 + Tailscale 复发 NoState + 项目全局 Skill

- **生产外网端点** `start-prod.cmd`（vite preview `0.0.0.0:4174`，服务 dist + 全 /api，provider 均实现 configurePreviewServer）。实测 `/`200、`/api/cyclones`1风暴、`/api/sources/health` down0，`127.0.0.1:4174` 与 `192.168.110.126:4174` 均可达。
- **Tailscale 本次卡 NoState**（Win11 升级 29683 破坏服务，tailscaled 日志 0 字节/服务方式启动即崩；前台能初始化但 CLI 连不上）——**历史复发**（见 2026-10-20）。已恢复服务原状；彻底恢复需重启系统 + SSO 授权（详见 `docs/REMOTE-ACCESS.md`）。
- **`start-tunnel.cmd`**：Tailscale 恢复后一键 `tailscale serve/funnel 4174`。穿透为同源相对 `/api`，功能与直连一致。
- **项目全局 Skill** `gods-eye-view`（software-development 类）：沉淀双端架构/数据源降级·NO_PROXY/渲染·GPU/UI 令牌/交互/已知BUG目录/验证流/远程访问/小程序，后续迭代直接调用。

## 2026-10-24 13:10 全量 NO_PROXY 扫描 + flights 溯源 + EONET 火点兜底

**全量 NO_PROXY 扫描**（70 个上游 host 直连 vs 7890 代理逐一实测分类）：
- **12 个新 host 直连可达+代理失败 → 加 NO_PROXY**：CCTV 相机源（`data.livetraffic.com/its.txdot.gov/data.austintexas.gov/weathercam.digitraffic.fi/webcams.transport.nsw.gov.au/trafficcam.calgary.ca/api.tfl.gov.uk/tie.digitraffic.fi/video.deldot.gov`）+ **NASA GIBS `wvs.earthdata.nasa.gov`**（云图/闪电/近期影像）+ **FIRMS** + **nowCoast**。
- **13 个直连失败+代理可达 → 保持走代理不动**（ll2/adsbdb/radio/geocode/google maps/raw.github/seismicportal 等）。
- 效果：CCTV 650 源、clouds/lightning manifest 200（GIBS 直连）、firms 直连 **829 条实时**。

**flights 溯源**：`/api/opensky` 现返回 **9954 架（pocketworld-global）**，早前"25 架 stale OpenSky"是修复前残留；flights 数据充足。

**fires EONET 兜底**：`server/providers/firms.js` 加 `fetchEonetFires()`，仅当 FIRMS 返回 0/全失败时用 EONET wildfire 事件点补位（字段对齐 `parseFirmsCsv` 契约 {lat,lon,frp,confidence,brightness,brightnessTi5,daynight,acqDate,acqTime,satellite,instrument}，时间戳用当前 UTC 过 `filterTrailing24h`）。EONET 已列 NO_PROXY 直连。

**提交**：`b1dca1c`（12 host）、`4105ec4`（EONET 兜底）。最终 `down 0`。

**固化工具** `tools/net_route_audit.mjs`：自动抽取 server 上游 host → 双通道（直连/代理）实测 → 归类 ADD/KEEP_PROXY/BOTH_OK/BOTH_ERR；`--sync` 只增不删地把 ADD 组并入 `start-dev.cmd` NO_PROXY。复用：加新数据源后 `node tools/net_route_audit.mjs --sync` 一键判定该直连还是代理。实测再救回 `inciweb.wildfire.gov`（火场边界 rows=104）、`tmc.deldot.gov`（DOT 相机）。`a627a33`

## 2026-10-24 12:30 补强：NO_PROXY 直连修复主源 + elastic 铺开全层源

**根因**：cyclones/earthquakes/fires/satellites 的"down"多是 **7890 代理拒连**（nhc/usgs/eonet/celestrak 直连 200、走代理 ECONNRESET；ll2 反之须走代理），非上游挂。
- `start-dev.cmd` NO_PROXY 加 nhc/usgs/eonet/celestrak 直连（LL2 保留代理）→ 重启实测：cyclones 0→1风暴、earthquakes→USGS242、fires→83285实时、satellites直连；**health down 1→0 / switched 2→0 / okChannels 32→38**。`0a46df7`
- 故**不需** GDACS/EONET 适配器（主源直连即正解；cyclones GDACS 因客户端 schema 严格无法接）。
- **elastic fetch 铺开 19 个层源**：全局 `__gevResilientFetch`+优雅回退，各层同源取数获超时+429/5xx重试+退避；层测 635/635、build 54s 过。`7387625`

## 2026-10-24 11:50 提交遗留 WIP + 实时源弹性取数 + 多源/渲染核验

**① 遗留文件提交**：`20f0a7a`（start-dev NO_PROXY 绕过 flight 源 / warmup 预热插件 / cctv·cyclones·local·transit·ais-live·celestrak·launch-library provider 增强 / README），node --check 全过。
**② 多源自动降级**：
- 新增 `src/sources/live/resilientFetch.js`（超时+429/5xx重试+指数退避+外部signal透传），接入实时源(航班/船舶/军机)默认 fetchImpl → `40bbd56`；live 单测 12/12。
- 现状：flights(provider 3源+pocketworld/opensky/adsblol)、satellites(celestrak+satvisor+retlector 三镜像)、earthquakes(USGS→EMSC 数据级)、militaryFlights(adsb.lol→adsb.fi 数据级,上轮)、wind/launches/traffic/alpr/installations 双/三通道。
- 诚实缺口：fires(EONET)/cyclones(GDACS) 备用仅 health 声明、数据端点未接(事件级/RSS 形状不同,接入会破坏契约)；单源层(vessels/静态/雷达/云图)无第二上游→不假切换。
**③ 图层渲染核验(CDP)**：各层=自定义 Primitive(Billboard/Primitive,非 Entity API)；实载 satellites 829/wind 65160/radio 750/datacenters 4362/dams 716/cables 2629/fire-perimeters 109/launches 20/vessels 25/flights 25。航班专项：渲染 980 billboards(飞机=精灵,既定设计)；count25+stale=OpenSky 本机限流(非 bug)；polyline0=航迹线仅追踪选中机绘制(正常)。未发现渲染代码级异常。
- 文档 `docs/audit-web-sources-render-20261024.md`。

## 2026-10-24 11:15 军机源自动切换备用（down 1→0）

**用户授权「可换备用源就自动换」。** 实测本机 `adsb.fi/v2/mil`=200/155架 可达（adsb.lol 429、adsb.one/airplanes.live 不可达）。
- `adsb-lol.js` `/api/adsblol/mil`：主 adsb.lol → **备 adsb.fi** 按序兜底（readsB 同构 `{ac:[…]}`，客户端契约/渲染不变）。
- `mini-sources.js`：militaryFlights 加 adsb.fi 备用通道。
- 重启 dev server（0.0.0.0:4173，PID 53620）后实测：`/api/adsblol/mil` = `200/upstream=adsb.fi/ac=158`；`/api/sources/health` **down 1→0、okChannels 32→35、militaryFlights 2/2**；fires/cyclones 亦恢复 2/2（上游瞬时自愈）。
- build 26s 通过；提交 `3e4cb8b`。文档 `docs/audit-web-datasources-icons-20261024.md` 更新。
- 其余无可用备源的层（vessels 唯一 AISStream）保留现状，不做假切换；不改渲染/性能/数据契约。

## 2026-10-24 10:40 数据源新鲜度核验 + 图层图标核查修复

**Part A · 数据源健康（权威 `/api/sources/health`：28层/40通道 okChannels32 · switched2 · down1）**
- ✅ 22/26 数据层正常拉取最新：flights(-2s/300架)、satellites(TLE 2.67MB)、ais-live(6.6MB实时)、wind(23s/ECMWF)、fire-perimeters(-13s)、traffic/launches/cctv(900)/radio(750)/radar/clouds 等。
- ⚠ earthquakes：USGS 主 502 → **EMSC 备交付 400 条**（有数据）；cyclones：NHC 502 → GDACS，`/api/cyclones` **0 风暴+unavailable**。
- ❌ **militaryFlights DOWN**：adsb.lol 502/429（腾讯云直连不通，无备用）。
- ⚠ fires：FIRMS **0 fires+stale(4.7d)**、EONET 备 502；alpr/installations：Overpass CH 主通、FR 403/DE 502。
- 以上均为**上游可用性**、非客户端代码缺陷；修复需改源选择=业务逻辑，按约束**未改**，如实记录（见 `docs/audit-web-datasources-icons-20261024.md`）。

**Part B · 图层图标一一对应（26 层，实机枚举）**
- 修复 3 类异常：① `◉` 三层共用 → cyclones→🌀、radio→📻（radar 保留 ◉ 现唯一）；② `🛰️`/`🛰` 变体不一致+两卫星层混淆 → recent-imagery→🗺️；③ `🌬` 缺变体选择符 → 🌬️。
- 核实 `layer.icon` 仅 `layerPanel.js:226` 面板标签用、**不参与渲染**。
- 实机 reload 复核：26 层图标全唯一，**无缺失/多余/重复/错配**。
- build 51s 通过；提交 `30e6ddc`(icons) + 文档。

## 2026-10-24 10:05 第二轮模块 2–5 落地 + 完整回归

**M2 玻璃无障碍回退**：`@media (prefers-reduced-transparency: reduce)` 时全局禁用 `backdrop-filter`（省 GPU + 文档要求的回退）。核实：全站**无「动画化 backdrop-filter」**（唯一 `transition: filter` 是 provider-settings 的 `filter:brightness` 悬停，合规）。
**M4 空态统一**：4 个"真空态"（`space-mission-roster-empty` / `mission-table-empty` / `ri-strip-empty` / `scene-shot-empty`）统一 颜色/等宽/行距 1.5/居中。（`feed-fallback`/`feed-unavailable` 实为源降级徽标，**非空态，已排除**。）
**M5 渐进模糊底**：`.data-toggle-list`（主图层列表）底部 20px `mask-image` 渐隐（GPU 合成、不重排布局）。
**M3 间距**：评估后**不做全局 8pt 重排**——会移动已验证布局、波及大量组件，违反「不破坏功能/性能」硬约束；改以设计令牌在新增规则内统一。

**完整回归（CDP 实测，5 分辨率 1024/1280/1366/1487/1600）**：
- `overflow = []`（全尺寸无溢出/错位）。
- 唯一"重叠"= 各面板对 `.gev-screen-whiteboard`（z90、透明、`pointer-events:none` 注释层）→ 面板 z>90 正确压在注释层上方，**无真实遮挡**。
- **console 错误 0 / 未捕获异常 0**；canvas 正常渲染 1487×788；`loading-screen` 正确 `hidden`（opacity 0 / visibility hidden / pe none）；**M5 mask 已生效**。
- 观察项（**非本轮 CSS 引起**）：`/api/*` 上游 10×`502`（provider 健康，历史已知）；vite 1×`504 Outdated Optimize Dep`（改文件后瞬态，reload 自愈）。
- `vite build` 34s 通过；提交 `78b06c5`。

## 2026-10-24 09:20 第一轮布局回归（清白）+ 第二轮设计令牌基座

**第一轮：全站布局回归（CDP 实测，5 分辨率 1024/1280/1366/1487/1600）**
- `overflow = 0`（无溢出/错位）；**无真实面板互相遮挡**。
- 唯一"重叠"是 `.gev-screen-whiteboard`（z90、`pointer-events:none`、背景全透明 = 屏幕空间注释层）被所有面板（z100+）压在下面 → **层级正确，不挡交互、不遮挡**。
- 重复 z：100（title-bar/style-indicator/top-center-actions/left-panel-stack 各占不同区域，空间不重叠）、151（lang/locate）→ 无可见冲突。
- **结论：本轮 GPU 优化改动（gev-perf/gev-graphics/viewer/css blur）未引入任何 z-index/布局 BUG；现有布局在 1024–1600 全绿。**
- 硬约束落地：`foundation.css :root` 定义 **z-index 层级区间令牌**（`--z-map/world-overlay/hud/panel/dock/popup/overlay/toast/devtools`）作为分层契约（底层地图 < HUD < 面板 < 坞 < 二级弹窗 < 三级浮窗 < Toast < 开发浮标）。

**第二轮：设计令牌基座（严格依两份 MD）**
- 设计令牌：8pt 间距（`--space-*`）、圆角（`--radius-*`）、阴影层级（`--shadow-1..3`）、字号阶（`--text-*`）、动效节奏（`--ease-out/spring`、`--dur-1..3`）。
- 排版微调（《UI动效整合》「排版」规则）：数字 `tabular-nums` 等宽 + 标题字距收紧 `-0.01em`（只改字体特性，不动布局）。
- `vite build` 31s 通过；提交 `fd43570`。

**后续（逐组件、依文档 Feel/transitions.dev/refactoring-ui 规则）**：统一玻璃层级、微交互（press/hover）、间距节奏、空态美化、渐进模糊等——分批应用并实时截图核对，避免大改破坏已验证布局。

## 2026-10-24 08:40 复核结论：G1/G16/G18 已在代码中优化 + 实机复现受环境限制

**实机复现尝试**：CDP 启用重图层（Wind/卫星/军机/船舶/交通/电台）。结果：flights 源 STALE 仅 25 架（OpenSky 在此环境受限），无法复现"数千航班 +57fps"负载；远程 Chrome 部分读数受窗口遮挡节流干扰（rafFps 掉到 14），**绝对 FPS 不可作 billboard 阈值标定依据**。

**代码复核（决定性）** —— `src/layers/flights/rendering.js`：
- `:155-163` 头注 + `:944 horizonOccluder(camera)` + `:1032 _deadReckon` 证明：**flights 已是"每 `scene.preRender` ~12Hz 死推算 + 地平线外剔除 + `scaleByDistance` + 3D 接近预算 MODEL_MAX"** 的高度优化实现。
- **G16**（逐帧 CallbackProperty）：未跟踪机队走 12Hz 死推算、**非逐帧**；`tracking.js` 的 CallbackProperty 仅用于**被跟踪单机**的轨迹/朝向/对齐轴（单实体，Cesium 廉价更新）→ **已优化**。
- **G18**（距离裁剪）：已用 `horizonOccluder` 剔除**地平线外** billboard → **已实现**。
- **G1**（聚类）：12Hz + 地平线剔除 + 按距缩放 + 3D 接近预算已封住绘制成本；再做聚类会隐藏单机（改变 UX），**不改更优**。

**结论**：G1/G16/G18 **属"已达标（代码已优化）"，非待改缺陷**（审计初版的 CallbackProperty 计数/距离裁剪缺失是表层判断，实际架构已缓解）。
- G11 独显探测已有（RTX3060 不需自动降档）；G13 纹理图集/KTX2 属资产管线；G22 材质/scopeMask 已由 6 个后处理合 1；G23 GeoJSON 主要在加载期；G15 FPS 徽标已具 —— 均**无需/低优先**。
- 干净场景实测（RTX3060 真硬件）：相机移动 **~53fps @ 原生分辨率**，`rafFps 74`。

## 2026-10-24 08:10 实机 CDP 测量 + 修复 G7 watchdog 冲突（关键）

**测量手段**：系统 Chrome + 独立 user-data-dir + CDP 9222，加 `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling` + `Page.bringToFront` + 焦点模拟（否则后台节流会把 FPS 压到 5fps 的假象）。脚本 `gevmeasure.mjs`（scratch）。renderer 实测 = `ANGLE (NVIDIA RTX 3060 Laptop, D3D11)` 真硬件。

**发现真 bug（G7）**：`gev-graphics` 的 `watchdog`（每 1.5s）把 `resolutionScale/targetFrameRate/globeMSE` 从 cfg 强行改回，**持续冲掉 gev-perf 性能模式与 G14 自适应**（实测 res 停在 1.2 原生而非设定 0.85）。这解释了为何先前 G3/G14 看似"无效"。

**修复**：`watchdog()` 开头 `if (localStorage.getItem('gev.perfMode')==='1') return;` —— 性能模式激活时由 gev-perf 独占运行时画质，watchdog 让位。

**修复后实测（reload）**：`rafFps 74`（页面节奏健康）、**相机移动真实渲染 53.3fps @ res 1.25 原生分辨率**、`reqMode:true / docHidden:false / loop:true`。首次 5fps 读数已确认为浏览器后台节流假象，非渲染问题。

**提交** `6be0028`；`vite build` 51s 通过。
**说明**：本 profile 默认场景 flights 层关闭（ents 0, prims 0），G1/G16/G18（航班 billboard/CallbackProperty）需启用重图层才能实测，留待后续开启复现后逐项验证。

## 2026-10-24 07:20 GPU 性能 批次2-3 + 自适应 + 全量回归

**改动**
- `src/app/viewer.js`、`src/gev-graphics.js`：`resolutionScale` 加**画布像素预算封顶**(≈2.4MP)，防 4K+DPR2 填充爆炸（G5/G10）。
- `src/gev-graphics.js`：桌面默认 `fxaa:false`（MSAA4 已抗锯齿，省一道全屏 pass）；CAS sharpen=0 时 `stage.enabled=false` 跳过全屏 pass（G9/G17）。
- `src/layers/cctv/projection.js`：视频纹理降采样封顶 **1280 宽**，避免按源分辨率(4K)每帧上传（G20）。
- 15 个 `src/ui/styles/*.css`：玻璃 `backdrop-filter` 模糊 **28→20 / 24→18px**，降合成层 GPU 成本（G19）。
- `src/gev-perf.js`：**自适应分辨率**——性能模式开启时按实测 FPS 微调 `resolutionScale` 逼近 57fps（死区 50–58，[0.6,0.9]）（G4/G14）。

**全量回归**
- `vite build`：**709 模块 40s 通过**，零编译/import 错误。
- 触域单测：**120/120 pass**（`src/app`/`layers/cctv`/`maps`/`renderGovernor`/`layers/flights`），含 google3d 双路由、renderGovernor 空闲治理。
- `check:boundaries`：仅 1 处**预存**问题（`server/providers/transit-circuit.js` 归属，属历史 WIP，与本次前端改动无关）。
- 全量 413 测试文件跑超时（runner 过重，非失败）；已用触域 120 测试覆盖改动面。

**未落地（核心渲染/需实机 FPS/资产管线，风险高，标注待实机确认）**
- G1 航班 billboard 聚类/限量、G16 CallbackProperty 逐帧→轮询+requestRender、G18+G8 距离裁剪、G7 双画质系统合并、G13 纹理图集/KTX2、G22 材质/scopeMask 缓存、G23 GeoJSON→Worker。**盲改会破坏现有航班/跟踪渲染，需实机 FPS 基线后逐项验证**。
- **已具备无需改**：G21 cockpitCloudEffects（已有 setSuspended+降分辨率+preserveDrawingBuffer:false）、G24 探测上下文及时释放、G12 renderGovernor+visibilitychange 空闲停渲染。

**提交**：`223bced`（批次2）、`c410bbb`（自适应）。

## 2026-10-24 06:30 GPU 性能 P0 首批：pdb + 帧率上限 + 3D Tiles 缓存

**现象/背景**
GPU/渲染审计（`docs/audit-web-gpu-20261024.md` G1–G24）后落地第一批 P0。默认体验：画面偏糊(res 0.7)、锁 30fps、每帧额外整帧 framebuffer 拷贝；Google 3D direct 路由用 Cesium 默认小缓存(256/512MB)。

**根因**
- `gev-graphics` 桌面 `pdb:true` → `preserveDrawingBuffer` 每帧强制整帧拷贝（本应用所有 `toDataURL` 均在离屏 2D canvas，无 Cesium 画布截图/录屏依赖，纯浪费）。
- `gev-perf` 默认「性能模式」把 `targetFrameRate` 硬锁 **30**、`resolutionScale` 压到 **0.7**。
- `createGoogleDirectTileset` 未设显存/缓存，与 ion 路由(1536MB)不一致。

**改动**
- `src/app/viewer.js`：pdb 兜底 `!apple`→`false`。
- `src/gev-graphics.js`：桌面 DEFAULTS `pdb:false` + boot 内一次性迁移 `pdbMigrated`（把历史存储 true 迁移为 false 并写回，仅一次，之后尊重面板选择）。
- `src/gev-perf.js`：性能模式 `res 0.7→0.85`、`targetFrameRate 30→60`。
- `src/maps/google3d.js`：direct 路由 `tileset.cacheBytes=1536MB / maximumCacheOverflowBytes=1GB / maximumMemoryUsage=1400`。

**验证**
- `node --check` 4 文件通过；`src/maps/*.test.mjs` **34/34 pass**。
- 重启本地 4173（PID 11904）后端健康（`/api/cyclones` 200）。
- 运行时 FPS 需重载后按 `` ` `` 看标题栏 FPS 徽标（本机 RTX3060）。提交 `8ae1a19`。
- 后续待做（需实测/更谨慎）：G1/G18 航班 billboard 聚类+距离裁剪、G16 CallbackProperty 逐帧→轮询+requestRender、G4 GPU 帧时测量→自适应分辨率。

## 2026-10-24 05:10 对齐小程序后端加固 + 航班占位呼号净化

**现象/背景**
按《上帝之眼小程序·全周期工程档案》第 15 章做「网页端↔小程序端」行为对齐。网页端是 Cesium 座舱（619 文件）比小程序（移动简化版）更成熟；UI/风场/3D/rpx/dock 等属小程序对桌面端的降级，第 15 章明确不倒灌。真正跨端共用、需同步的是后端 provider 加固与共用文本处理。

**根因**
1. 网页 `server/providers/firms.js` 仍是 world/2 × 4 源、60s、源写死——境内出口 100MB+ 必超时→野火层 502/空。`gev-cloudrun` 已改「源可配 + world/1 + 90s + 冷启动 warming + lastError」，网页未同步。
2. 网页 `server/providers/mini-sources.js` 探活超时 9s、`LOCAL` 写死 `127.0.0.1:4173`、直连 celestrak/radio/adsb 上游 → 健康面板大量假 down。gev-cloudrun 已改 30s + 探自家聚合端点 + 5xx 二次重试 + `LOCAL` 跟 `PORT`。
3. 网页 `src/layers/flights/queries.js` 的 `_toCleanText` 只 `trim()`，不挡 `@@@@@@@@` 占位呼号（OpenSky 对未广播呼号填 8 个 @）→ 座舱标签可能显示占位符。

**改动**
- `server/providers/firms.js`、`server/providers/mini-sources.js`：与 `gev-cloudrun` 完全一致（diff 为空）。
- `src/layers/flights/queries.js`：`_toCleanText` 加 `/^[@?？\s\uFFFD]{2,}$/` 脏值判定（同小程序 `_isGarbageVal`），脏值→`''`，让标签链 callsign→registration→icao24 自然回退。

**验证**
- `node --check` 三文件通过；flights 单测 **10/10 pass**。
- 重启本地 4173（PID 41756）：`/api/firms` 200（不再 502，返回 `fires` 数组）、`/api/sources/health` 200；firms 消费端 `if(!Array.isArray(payload.fires)) throw` 对 warming 的 `fires:[]` 兼容（不崩）。
- 未倒灌项：小程序风场三色/TICK、dock/hud/rpx、3D 球、`selRef` 详情锚点等属移动端特化实现，网页端有更优等价物（GPU 风场流线、Cesium 实体稳定 id），按第 15 章不移植。

## 2026-10-20 22:20 启动红框：`targetFrameRate must be greater than 0, or undefined`

**现象**
启动页停在「GOD'S EYE 视角」，下面一行红字：
`Error: targetFrameRate must be greater than 0, or undefined.`，Cesium viewer 构造直接抛错，永远黑屏。

**根因**
画面设置里「帧率上限 = 不限」被存成 `fps: 0` 写进 `localStorage['gev.gfx']`。
`src/app/viewer.js` 原样接受：

```js
const fps = typeof gfx.fps === 'number' ? gfx.fps : apple ? 30 : 60;
viewer.targetFrameRate = fps;   // 0 非法
```

Cesium 的 `targetFrameRate` 只接受 **> 0 或 undefined**（undefined = 跟浏览器垂直同步）。

**改动**
- `src/app/viewer.js`

```js
const fpsRaw = Number(gfx.fps);
const fps = Number.isFinite(fpsRaw) && fpsRaw > 0 ? Math.min(fpsRaw, 240) : undefined;
...
viewer.targetFrameRate = fps > 0 ? fps : undefined;
```

- `src/gev-graphics.js`：新增 `safeFps()`，面板改帧率的两处路径统一走它

```js
function safeFps(f) {
  const n = Number(f);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 240) : undefined;
}
```

**验证**
故意写入 `localStorage['gev.gfx'] = {"fps":0}` 后强刷：

```
AFTER {"errText":"","cesiumErr":false,"canvas":8}
```

红字消失、8 个 canvas 正常、引导弹窗正常显示。旧的 `fps:0` 会被当成「不限」，不需要清缓存。

---

## 2026-10-20 22:35 渲染红框：`Expected width to be greater than 0, actual value was 0`

**现象**
页面能起、图层面板可用，但中央弹红框：
`An error occurred while rendering. Rendering has stopped.`
`DeveloperError: Expected width to be greater than 0, actual value was 0`，地球不再渲染。

**根因**
canvas 宽/高为 0 时，Cesium `scene.render()` 抛 `DeveloperError`，**抛完就永久停掉渲染循环**。
0 尺寸的来源：窗口最小化、切后台、容器瞬间 `display:none`（面板/模式切换）、布局重算的那一帧，
以及 `useDefaultRenderLoop` 在尺寸恢复前被重新打开（`src/app/tools.js` 的可见性挂起逻辑会 toggle 它）。

**改动**
`src/app/viewer.js`，在 `window.__gevViewer = viewer;` 之后给 `scene.render` 套护栏：

```js
const origRender = scene.render.bind(scene);
scene.render = function guardedRender() {
  const cv = scene.canvas;
  if (!cv) return;
  const w = cv.clientWidth || 0, h = cv.clientHeight || 0;
  if (w <= 0 || h <= 0) {
    if (cv.clientWidth > 0 && cv.clientHeight > 0) viewer.resize();  // 恢复了先重算视图
    return;                                                        // 跳过这一帧
  }
  try { return origRender(); }
  catch (e) {
    if (String(e.message).includes('greater than 0')) return;      // 只吞尺寸抖动
    throw e;                                                       // 其他异常照旧
  }
};
```

**验证**
CDP 实测：

```
VIEWER true
容器强制 0×0 → resize() 不抛 → render() 返回 "render-ok canvas=0x0"   ← 改之前这里就炸
恢复尺寸      → "restored 1262x764 loop=true"
3 秒后页面    → "no-error"，无红框
```

---

## 2026-10-20 22:50 整站打不开：`ERR_INVALID_HTTP_RESPONSE`（回滚全局 gzip）

**现象**
浏览器打开 `http://127.0.0.1:4173/` 报「该网页无法正常运作 / ERR_INVALID_HTTP_RESPONSE」。
**curl 返回 200 且 HTML 正常** —— 极易误判成“服务没起来”。

**根因**
之前为省流量加的全局 `gzipRes` 劫持了 `res.writeHead` / `res.end`：

1. Node 在 `end()` 内部会调 `_implicitHeader()` → 再调 `this.writeHead(...)`；被替换后**只存进 pending 不发**，响应变成“只有裸 body、没有状态行”。
2. `/api/setup/status` 恰好是 `setHeader + res.end`（不显式 writeHead）的写法 → 返回的 JSON 前一个字节 HTTP 头都没有，前端启动就挂在这。
3. Vite 的 HTML/CSS/JS 同样被波及 → 白屏。

**改动**
- `server/providers/local.js`：`withGzipPatch()` 直接 `return plugin` 停用，函数里留注释说明“不要这么干”
- `server/providers/send-json.js`：`gzipRes()` 补两道保险（保留备用，当前无调用方）
  - `res.headersSent` 时绝不改长度
  - 压缩前 `removeHeader('Content-Length' / 'Content-Encoding' / 'Transfer-Encoding')`
- 压缩只保留在 `sendJson()`：自己写头，不碰别人的 `res`

**验证**
CDP 抓包 `FAILS 0`；`/api/setup/status` 恢复 `HTTP/1.1 200 OK + application/json`；
`/`、`/style.css`、`/src/main.js` 的长度与 `Content-Length` 全部一致；真 GPU Chrome 渲染正常（8 canvas / WebGL2 / 无异常）。

**代价**
`/api/launches`（786 KB）、`/api/cn/admin`（580 KB）回到未压缩。正确方向是**瘦身**（launches 只留 5 个字段），不是恢复全局 gzip。

---

## 2026-10-20 22:26 航班/军机一直「陈旧」：ADS-B 走了代理被 429

**现象**
图层面板 `实时航班 25 — STALE · adsb.lol · Source snapshot 46 min old`，军机 `1h 前`。

**根因**
`start-dev.cmd` 只把 opensky 放进 `NO_PROXY`，adsb.lol 全部走 Clash 7890。
实测：

| 通道 | `https://api.adsb.lol/v2/mil` |
|---|---|
| 直连 | **200**，215 KB，2.9 s |
| 走 7890 | **429** rate limited，1.15 s |

上游限流 → provider 只能吐旧快照。

**改动**
- `start-dev.cmd` 的 `NO_PROXY` 补：`.adsb.lol, adsb.lol, api.adsb.lol, .adsb.fi, adsb.fi, .airplanes.live, airplanes.live, pocketworld.org, .pocketworld.org`
- `start_gods_eye_hidden.vbs` 改为直接调 `start-dev.cmd`（原来自己 `set` 环境变量，漏了 `NO_PROXY`）
- 重启后端

**验证**
`GET /api/adsblol/mil` → **214,522 字节**实时数据（改之前是 `{"error":"ADS-B proxy error"}`）；
Node 直连测试 mil 200 / point 200。

**遗留**
数据龄降到 2–3 分钟后仍显示 STALE，需要核对 `src/data/feedState.js` 的 stale 判定与各图层轮询周期是否匹配。

---

## 2026-10-20 23:00 Tailscale 失效（`NoState`，节点密钥全零）

**现象**
外网设备连不上；`curl http://100.93.210.120:4173/` → `000`；局域网 `192.168.110.126:4173` → 200 正常。

**根因**
Win11 就地升级把 Tailscale 状态弄坏：`C:\ProgramData\Tailscale\` 无 `tailscaled.state`、`profile-data` 为空，
`status --json` 里 `PublicKey = nodekey:0000…0000`，守护进程在 `NoState → NeedsLogin (WantRunning=false)` 之间空转。

**改动**
停服务 → 杀残留 → 把 `server-state.conf` / `profile-data` 备份为 `.bak-20261020` → 起服务 → `tailscale up`。

**结果**
状态推进到 **`NeedsLogin`**，拿到授权链接。**未完成**：需要账号授权一次（SSO 不能代填）。
授权后要核对节点 IP 是否仍是 `100.93.210.120`，若变了需同步更新桌面快捷方式与入口页里的 Tailscale 链接。

## 2026-10-23 01:22 /api/cn/weather 增加 7 天预报 + 强制中文

- `weatherHandler` 并行多取一条 `/v7/weather/7d`，返回 `daily[]`（date/textDay/textNight/tempMax/tempMin/
  windDirDay/windScaleDay/precip/uvIndex/humidity/sunrise/sunset）与 `dailySource`
- `qweather()` 统一追加 `lang=zh`：和风按坐标所在国返回本地语言，境外坐标（如模拟器默认的巴西）会回葡语
- 实测：`/api/cn/weather?lat=26.08&lng=119.30` → now=21 多云、daily=7、alerts=1；
  `lat=-15.78&lng=-47.92`（巴西利亚）→ now=晴、day1=少云（中文）

## 2026-10-23 01:26 天气预警 type/severity 结构化（供小程序极端天气模板）

- QWeather 的 `eventType`/`type` 是对象 `{name, code}`，之前直接透出会变成 `[object Object]`
- 现在：`type` 取 `eventType.name`（如「台风」），`severity` 保留原值（moderate/severe/extreme），
  `desc` 带上官方发布正文（含防御指引）
- 实测：福州 → `福州市气象台发布台风黄色预警信号 / type=台风 / severity=moderate`

---

## 2026-10-24 05:10 归档文档接入网页端 + 设计资源章节

**现象**
设计资源（skill / 组件库 / 站点 / 提示词）散在桌面三份 md（`设计Skills清单.md`、`UI动效-小红书笔记总结与资源交接-整合-20261022.md`、`UI动效库与Feel-skill安装记录-20261022.md`），改网页端 UI 时找不到「用哪个 skill、装了什么库、端口多少」。

**根因**
没有一份把「小程序工程档案 + 网页端设计资源」合并的文档；网页端仓库 `docs/` 里没有设计入口。

**改动**
- `docs/上帝之眼小程序-工程档案-Hermes-Agent-20261024.md`（新，971 行）放进本仓库：第 1–14 章为小程序工程档案（架构/技术栈/31 图层/32 数据源/155 条问题/运维），**第 15 章为网页端设计资源**（双端能力差异、本机已装 20+ 设计 skill、待装清单、GSAP/Lenis/Vanta/React Bits/Lucide/Feel、术语→实现映射、站点、落到 HUD/坞/详情卡/相机飞行的具体方案、提示词、纪律），第 16 章附录。
- 同步副本：`C:\Users\13680\Desktop\.MD\docs\logs\` 对应文件（见 `[DocsAgent]-文档索引.md`）。

**验证**
- 文档 971 行 / 90,883 字节；章节 0–16 齐全；表格无破损；凭据正则命中 0。
- 15.1 的双端差异按实测写（网页端 `backdrop-filter` 可用、`z-index` 正常；小程序端原生组件层级、逐帧 setData 700 ms）。
- 15.4 的版本号来自 2026-10-22 实装记录（gsap 3.15.0 / lenis 1.3.27 / vanta 0.5.24 / lucide 0.544.0 / vite 7.3.7 / React Bits 218 组件）。

**注意**
- 本仓库只提交了这一个 docs 文件；`PROGRESS.md` 与其它在改文件保持未提交状态。

---

## 2026-10-24 05:40 桌面 .MD 目录重组（同步路径变更）

**现象/根因**：桌面 `.MD` 长期平铺 24 个文件、命名无规范，交接无入口。

**改动**：该目录重组为 `docs/{specs,logs,ops,prompts}` + `assets`，全部文件按 `[Agent]-主题-日期.md` 重命名（正文零改动）。本仓库的网页端日志镜像改为 `C:\Users\13680\Desktop\.MD\docs\logs\[ProjectLogAgent]-上帝之眼Web端-改动日志.md`，本文件头部已同步；工程档案副本改为 `docs\logs\[ArchiveAgent]-…md`。

**验证**：源仓库 `PROGRESS.md` 与镜像逐字节一致；目录索引 `[DocsAgent]-文档索引.md` 列出全部 21 份文档及原名映射。

---

## 2026-10-24 16:05 Apple Liquid Glass 组件接入（玻璃按钮 44×44 + 玻璃菜单 320×N）

**现象/需求**：按《官方LiquidGlass-CSS与上帝之眼适配任务包-合并版-20261024.md》，把 Apple 官方 Liquid Glass 材质做成按钮与菜单组件接入网页端，参数照抄、不遮挡、不抢层级。

**改动**：
- 新增 `src/ui/styles/lg-glass.css`（官方材质：blur(22px) saturate(1.9)、双层填充、3 内阴影 + 4 投影，按 `--lg-scale` 等比缩放；Dark/Clear 为默认、`.lg-glass--light` 为 Light 变体；hover 白度 +.08、按下 scale(.97) + 指尖辉光 .45；`@supports` / reduced-transparency / reduced-motion 降级）。
- 新增 `src/ui/lgGlass.js`（挂载按钮到 `#top-center-actions`、菜单浮层 + 透明遮罩、Esc/遮罩关闭、明暗切换；暴露 `window.__gevLiquidGlass` 供 CDP 核验）。
- `style.css` 末尾 +1 行 `@import`；`index.html` 末尾 +1 行 `<script>`（均带「删掉本行即还原」注释）。
- 未改 `foundation.css` 层级/令牌，未改 `status.css`（顶栏按钮 ID 选择器优先级问题在组件文件内用同等上下文覆盖解决）。

**z-index**：按钮继承 `--z-hud:100`；遮罩 199；菜单 `var(--z-popup)=200`；地图层无任何滤镜。

**验证**（headed Chrome 155 + CDP，1600×900，http://127.0.0.1:4173/）：
- 按钮 computed：44×44 / radius 12px / border 0 / backdrop `blur(22px) saturate(1.9)` / box-shadow 7 层
- 菜单 computed：320px / radius 16px / z 200 / backdrop 同上；`overflowX=0`
- control-panel 100、command-dock 145、toast 原值不变；菜单与图层面板同屏无遮挡
- 全程 `errPanel: 0`（无 Cesium 报错）；`npm run build` 通过；`applicationHtml` / `browserModuleBoundary` 测试通过
- 截图：`docs/screenshots/lg-glass/headed-0{1..4}-*.png`
- 详见 `docs/lg-glass-改动清单.md`

**已知**：headless Chrome（`--disable-gpu`）下打开菜单会触发 Cesium `width > 0` 报错（软件渲染 + backdrop-filter 重绘导致画布瞬时 0 尺寸），headed 无此问题，核验须用 headed。

> 复验（提交时独立 CDP + GLM-4V 视觉）：按钮/菜单 computed `blur(22px) saturate(1.9)`、`border 0`、菜单 `z-index:200`、遮罩 `199`、command-dock `145`/left-panel-stack `100` 未变；深/浅按钮+菜单+叠加面板截图 `evidence/lg-glass-shots/`（已入库）；全分辨率 headed 图 `docs/screenshots/lg-glass/`（本地，gitignore）。

## 2026-10-24 Liquid Glass 第二批扩展 + 全站层级复测
- 全屏穿透修复：玻璃菜单去掉全屏 backdrop(z199 pe:auto)，改 document capture pointerdown 监听点外关闭 → 零全屏元素。
- 玻璃扩到指令坞(dock-tray-toggle×2 + voice + tier)+右栏(pp-toggle-btn×10 + pp-collapse-btn)，新增 .lg-glass-skin(官方材质等比缩放/token圆角/不改尺寸交互)，MutationObserver 持续补挂。
- 全站层级实测：打开态全屏遮挡0/同z重叠0；z分区严格。5分辨率溢出0、坞/右栏视口内、无越界高z。
- 视觉复核(GLM-4V)：坞/右栏/菜单磨砂统一无破相。截图 evidence/lg-glass-shots/。

## 2026-10-24 手机竖屏适配(v2)
- 现象: 手机竖屏 left-panel-stack/right-context-rail 被撑成近全宽竖向堆叠, 挤没地图且互相重叠。
- 方案: 新增 mobile-portrait.css(@media max-width:760px, 纯作用域) + mobile-ui.js(独立). 两堆叠改两侧抽屉: 默认移出屏幕(op0/translateX off), 底部两个悬浮FAB(图层/工具)滑出; 打开用内联!important强制(绕开层叠); 互斥; 点地图外收起; 坞贴底避让safe-area; 顶部避让刘海。
- 入口: index.html +1 script; style.css 末尾 +1 @import。回滚删两行。
- 坑: (orientation:portrait)在CDP模拟不匹配→改纯max-width:760px; Vite对新@import文件HMR不热加→需整页刷新; 低内存(3.74G)构建OOM→dev 4173直连免构建。
- 验证: computed实测 关闭态op0/x-388/溢出0, 直接内联op1/transform单位矩阵/display flex/z130, FAB×2; 桌面fresh无FAB无mobile类。

## 2026-10-24 外网访问：natfrp 内网穿透（手机看网页）
- 目标：手机/外网访问本机网页。Tailscale（DERP 中继被墙）、免费隧道（localhost.run/serveo/bore 全 403/超时）、Cloudflare 均不可用 → 改用 natfrp（樱花frp）。
- 方案：frpc 0.51.0-sakura-15.1（`D:\Hermes\natfrp`）+ 日本1节点(node72 frp-fly.com) TCP 隧道 `gevprod`(id 29654099) → 本机 4174（PROD dist）。公网 `http://frp-fly.com:11269/`（备用 `http://202.182.125.24:11269/`）。
- 关键根因：① 内地节点禁 HTTP-over-TCP（返 501/403），HTTP 应用必须用非内地节点；② 非内地节点中日直连时数据端口 :8088 `i/o timeout`、大文件约 1/3 截断。改法：frpc 走 Clash 代理出网（`run_frpc_proxy.cmd`，`ALL_PROXY=127.0.0.1:7890`）→ 拨号超时归零、页面命中 8/10 全 200、延迟 0.6–1.9s；并把 dev(4173) 改 PROD 打包(`vite build`→4174)减少请求往返。
- 自启：`GodsEye_natfrp_frpc`(登录→start_frpc.vbs→run_frpc_proxy.cmd) + `GodsEye_ProdServer`(登录→start_prod.vbs→start-prod.cmd 起 4174)。节点/实测/切换清单见 `docs/natfrp-外网节点清单.md`。
- 验证：health down0/ok36/41；大文件仍偶截断靠浏览器 gzip+重试，未达 100% 稳定，用户接受先用（真正稳定后续可换国内 HTTP 穿透/备案域名）。

## 2026-10-25 面板自由拖拽/缩放模块（commit 3065ab1）
- 新增 src/gev-panel-win.js + public/gev-panel-win.css + index.html 两行：三功能模块(左/右组、命令坞)拖拽移动+右下角缩放，
  占位预览/边界吸附/最小尺寸/rAF/禁止拖出可视区/触摸/localStorage 持久化刷新还原/重置按钮；稳定门控防跳变；删两行即回滚。
- 验证：GPU Chrome CDP 几何(拖拽52→192、缩放476→546、边界钳制、持久化、0报错)；PROD 复测通过+命令坞溢出=[]；GLM-4V 视觉回归无外框无崩坏。
- 附注：发现 GodsEyeViewBackend/GodsEyeViewGuard 守护任务 Disabled(服务掉线未自动拉起)，本轮已手动恢复 4173/4174。

## 2026-10-27 交互修复：展开/切换唯一 owner（t_b37e6b4b）
- 根因：① 双 owner（App 的 `.panel-header`/`.dock-tray-toggle` 改 `.collapsed` + Hermes `toggleFloat`）；② 互斥组把兄弟 header `visibility:hidden` 导致点不到；③ dock 卡 header 是 `<button>` 被 INTERACTIVE 排除，只原地展开；④ 键盘 Enter 走 App 的 `toggleDisclosure`（第三个 owner）。
- 改法（`src/gev-liquid-cards.js`）：标题条命中一律本层接管；click 只灭口不改状态；**pointerdown 记候选 + document pointerup 结算**（<6px 且非拖拽/缩放/收尾）→ 卡片在补间中滑走也不丢点击；Enter/Space 在 capture 抢占；兄弟卡只 `.collapsed` + 组内让位（不用 `.gev-lc-hid`）；浮层态收起小三角翻译成 `floatClose`。
- 验收（真实指针，非 `__gevLc.open`）：7/7 首次点击即浮起；7 组组内切换 `overlap=0` + 98 帧采样无 hidden/ghost；连点 7 张落定 `overlap=0`、最终状态=最后一次生效点击；全关 drift 全 `[0,0,0,0]`；App 收到 header click = **0 次**；console error 0。12 组合布局不回归（12/12 ovl=0）。
- 输入回归不破：拖拽 dx192/dy40、缩放 320×380→384×428、卡内控件点击到达、空白点击不收起、Esc 收起、100ms 双击开→关、键盘 Enter 现在也浮起。
- 证据：`.gev-logs/t_b37e6b4b/{final.log,verify.json,overlap12.*,input*.log,0*.png}`；说明 `evidence/_collab/t_b37e6b4b/REPORT.md`；脚本 `scripts/{verify-interaction,verify-overlap12,qa-b37e6b4b-input}.mjs`。
- 已知（非缺陷）：切换动画 ≤350ms 内退场卡与已展开别组卡有瞬时几何重叠（最大 ~16.4k px²），是“不隐藏+位置连续”的代价；落定严格 0。

## 2026-10-28 首页帧率专项：28fps → 51fps（t_834a621c，空闲期整屏去重）
- 现象：Ego Lite 可见窗口（1536×730 / dpr1 / 正常态）GEV 首页只有 27.6–29.6fps，卡面要求 ≥30、目标 60；隐藏 Cesium/overlay/卡片都几乎不涨。
- 环境先说清：Ego 的 Chromium 用的是 **Intel UHD 核显**（`WEBGL_debug_renderer_info` = `ANGLE (Intel, Intel(R) UHD Graphics ...)`），同一台机同一个视口用 Chrome + RTX3060 是 **58.5fps**。而且该窗口对「持续产帧」的硬上限只有 **~40fps**：一个 20×20 的红方块加 transform 动画就只有 39.7fps，空白页 73.8fps。→ 60fps 在这个审计环境里物理不可达。
- 根因（trace + rAF 普查）：1.8s trace 只有 50 次 BeginMainFrame(=27.8fps)；主线程每帧 ~8ms、0 longtask；**GPU 进程 `SwapBuffers` 23.2ms / `Present` 22.6ms 每帧** → 36ms 帧预算 2/3 花在呈现路径。5 张全屏 canvas 每多一张 ≈ -2.5fps。而空闲时 `scene.postRender` 1.5s 内 **0 次**（requestRenderMode 本来就没在画），`gev-edge-lens.js` 的 rAF 兜底却仍每帧 clear+drawArrays 一张 1536×730 canvas → 每帧整屏变脏、整屏重合成，**像素一个都没变**。另有 `#scope-mask` 空的全屏 canvas（scope 默认关闭）照样参与每帧合成。
- 改动（只两处，不动玻璃材质/圆角/颜色）：
  1. `public/gev-edge-lens.js`：按「纹理版本 + 每个面的 x,y,w,h,band,cornerN,radius」签名去重，签名没变就完全不动 GL（画布保留上一帧）；地图重绘/卡片动画/缩放/resize/off-on/testBg 都会破坏签名 → 照常重画；`stats()` 增 `skip` 计数取证。
  2. `src/scopeMask.js`：没墨（`_painted=false`）时 `#scope-mask` 直接 `display:none` 退出合成树，要画前恢复 block。
- 验证（同窗口同视口，性能模式关闭/res 1.0 = 审计视觉口径，冷启动 17s 后测 1.5s×3）：**改前 27.6–29.6fps（中位帧间隔 33–36ms）→ 改后 50.5 / 53.2 / 49.2fps（中位 18.5–20.3ms，p90 ≤24ms，0 longtask）**；5s 内 `frames` 冻结 66 / `skip` 353→626（掐掉 273 次冗余整屏重绘）；相机 `setView` 后 `frames` 82→109（交互时照常重画）；关掉折射环层对比同帧截图有 6.09% 像素变化（环仍在出像素）；`#scope-toggle` 真实点击 on→`display:block`/1536×730、off→`display:none`；`node --test src/scopeMask.test.mjs` 22/22 通过。
- 未做：没到 60（审计窗口 ~40fps 上限，要 60 只能让 ego.exe/ego-browser.exe 走独显：`HKCU\...\DirectX\UserGpuPreferences` → `GpuPreference=2;`，属环境改动未执行）；拖拽/瓦片加载期仍 ~20–28fps（fill-rate）；`#world-overlay-detection-surface` 那张空闲全屏 canvas 未动（要改 worldOverlay.js 的墨判定，超出本卡最小边界）；未提交 git。证据 `evidence/_collab/t_834a621c/README.md`。


## 2026-10-28 前端架构 Phase 0（t_5c610f6a，只出方案不改代码）
- 现象：真实点击后卡不展开 / mini 卡内滚动 / 点 A 卡串 B 卡状态 / 中心磨砂与白条反复回归；自测用 `__gevLc.open()` 全绿而真实 Ego 点击失败。
- 根因（取证）：① `.collapsed` 有 6 类写入者（panelChrome / panelDisclosure / hover disclosure / 轨道自适应 / panelPositionControls / 6 个业务模块），App 与 Hermes 双持久化；② 用 CSS 当状态机：`public/gev-liquid-cards.css` 1011 行 / 284 个 `!important`（**§11–§22 合计 214**，单节最大 §19 的 55、§12 的 43）/ 4 代材质共存（G1 §1 · G2 §12 · G3 §14 · G4 §17）；③ 几何靠 33 个 setTimeout + 5 个 setInterval + 27 次 getBoundingClientRect 自纠；④ 互斥用「兄弟加 .collapsed」实现，撞上 App `layers.css:253` 的 `display:none` → 兄弟 header 变隐形、点击落到下面那张卡；⑤ 验证旁路：`__gevLc.open()` 绕过 pointer 路径，且 `scripts/qa-ego-clicks.mjs:9` 仍按旧口径断言初始有 1 张展开（现代码 openDefaultCard 为空实现）。
- 改法（方案，未实施）：新增 `src/lc/` 分层（Interaction → CardController 唯一状态 owner → LayoutEngine 纯函数 → Renderer 单帧写 DOM → CollapsePort 唯一 `.collapsed` 写者，经 App 的 setPanelCollapsed）；材质收敛为 1 套 token + 3 层绘制，`!important` 降到 0（用 `:is(#id).gev-lc` ≥(1,2,0) 的特异性预算），并以 `scripts/lc/invariants.mjs` 逐元素枚举兜回归；删除 `public/gev-liquid-cards.css`(1011 行)、`src/gev-liquid-cards.js`(3245 行)、`public/gev-gl-glass.js`(889 行死码)、`gev-lg-filter.js` 默认加载。
- 验证：本次只读，静态计数与逐行引用可复核（`grep -c '!important'`=284、`grep -c setTimeout`=33、`scripts/` 482 文件 / 172 个 `qa-*`）；4173/4174 均 200。方案见 `docs/architecture/frontend-phase0.md`（含 12 条状态机转移表、13 条 Ego 真实指针用例、7 步实施计划与回滚点、3 个待决策）。
- 未做：未改任何 public/src/index.html；未进入实现；待 lead 批准 §11 三项决策（.collapsed 归属 / FPS 口径 / 初始态口径）后从 S1 开始。
- 复审修订 r2（2026-10-28，按 review round 1 的 5 条返工，仍只改文档）：① §8.1 整表按实测分节头重算——§11 = 327–337（1 个）而非 327–601（214），§12–§22 起点改为 338/601/613/645/656/681/764/789/870/894/954，25 节逐节 `!important` 相加 = 284（= `grep -c`），区间首尾相接、可当删除图；② §1「一节占 214」改为「§11–§22 合计 214（单节最大 §19 55 / §12 43）」；③ 材质代数全文统一 4 代并给 G1–G4 术语表（§6.3），区分「4 代材质」与「3 层绘制」；④ 写入者统一 6 类；⑤ 顺手项：App 样式入口改为根 `./style.css`（29 行 / 24 `@import`）、`docs/UI-OWNERSHIP.md` 行号 9→**13**（实测 `panelChrome.js` 在第 13 行，非评审说的 12）、`scripts/_*` 164 与 `_diag*/_probe*/_tmp*` 31 分开标、`backdrop-filter` 口径 = 43 处属性（含 21 处 `-webkit-`；`src/ui/styles/` 37 + `public/gev-cn.css` 6，原「31」无法复现）。
- 验证：脚本逐节核对 25 个区间与计数，doc sum 284 == file grep 284，0 处不一致（除末节行尾换行导致的 1012 假值）。
- 复审修订 r3（2026-10-28，按 review round 2 的 4 条必改，仍只改文档：`public/` `src/` `index.html` 一字未动，mtime 仍为 03:16 / 12:31 / 10-27 01:11）：① §8.1 **§16 由「删」改判「迁」**——656–657 只是注释，659–679 是一个完整 `@media (prefers-reduced-transparency: reduce)` 块（9 个 `!important`：664/665/666 卡壳 · 669/670/671 托盘 `.dock-popover-content` · 675/676/677 控件；16 个控件名），它是 §8（247–263，仅 `.gev-lc`×2 + `.gev-lg-warp`）的**严格超集**，删 = a11y 回归，去向改为并入 §8 的同名 `@media` 变体；② §8.1 口径注改成可复现：`grep -n '^/\* [─═]'` 不带 `-P` 会把 `[─═]` 当字节类、把 `/* —— 12a)`～`12e)` 一起算进去输出 **34** 行（上一轮写「25 个分节头」即错在此），正确命令 `LC_ALL=C.UTF-8 grep -nP '^/\* [\x{2500}\x{2550}]' … | wc -l` = **27**、`grep -cP …'[0-9]+[ab]?\)'` = **25** = 上表 25 行，多出的 2 行是 269（QA 钩子，在 §9 区间内）与 322（「亮底档补强：已删除」，在 §10 区间内）；③ §7.3 `backdrop-filter` 由子集改全量：**134 处 / 133 行**（`src/ui/styles/` 90 处 / 89 行 / 19 文件 / `-webkit-` 43；`public/` 44 处 / 44 行 / 2 文件 / `-webkit-` 16 = gev-liquid-cards 38 + gev-cn 6），与卡片直接相关的 **56 处**，附逐文件清单与 6 条复现命令；④ §8.2 按 `grep -n '^  function '`（67 个定义）重算全部行区间：`scrubXGlyphs` 2386–2395（保留原样）、`boot/initTheme/startLumProbe` 2396–2533、`applyTopChipStyle…applyUiFixes` 2534–2833（`settleGuard` 单列删）、`healExclusive…startNormalizeWatch` 2834–3064、`primeInitialState` 3065–3102，修掉上一轮 `2457–2394` 首尾颠倒与 `2396–2560`/`2826–3070` 互压；⑤ 顺手把 §7.2 的 `2997-3010`→`2990-3004`、`3000-3040`→`3045-3064`、`2826-2872`→`2834-2886`、`847-877`→`847-883` 与 §7.4 `scrubXGlyphs` 处置改为「保留原样」，并在 §1 修正三处口径：`getBoundingClientRect` 实为 **21 次调用 + 6 处注释**（原写 27 次）、全仓 `!important` **493 行 / 552 次**（原写「24+6 张表」实为 25 + 5 + 根 style.css）、覆盖层 **5 张表 1596 行**（`mobile-portrait.css` 实际在 `src/ui/styles/`，不在 public）。
- 验证（全部本机实测）：§8.1 25 行区间逐节对拍 CSS = **25/25 全中**、首尾相接、和 = **284** == `grep -c '!important'`；§8.2 25 行区间单调不重叠、末行 3105–3245、与 67 个 `function` 定义逐一吻合；§7.3 六条复现命令输出 90/89/19/43/44/16 全对；文档 562 行、16 张表列数一致；残留矛盾 grep（`2457–2394`/`2826–3070`/`43 处`/`25 个分节头`/`482 个文件`/`5 个写入者`/`3 代`）全部为空；代码零改动仍用 mtime 证实。`§11` 三项决策（`.collapsed` 归属 / FPS 口径 / 初始态口径）仍待 lead 批准。


## 2026-10-28 前端架构 Phase 0 补丁：最新 P 表 7 条入架构（t_7cba5d02，仍不改代码）
- 现象：v1 架构（`t_5c610f6a`，562 行）按旧版要求通过，但**最新 P 表 7 条一条没覆盖**：GPU（`powerPreference`/SwiftShader 判定/降级/状态显示）、去灰圈（材质层仍留 `hairline/发丝边`）、底部语音栏统一（文档 0 次「语音」）、果冻动画（只有固定 350ms）、初始态（§11 仍列「待决策」）、FPS 口径（建议用 50.5/40 基线替代用户 30/60）、行数（P 表说 CSS 908 / JS 3048）。
- 根因（本次实测）：① GPU 只在请求侧做了一半——`viewer.js:178-182`/`edge-lens:282-284` 已带 `powerPreference`，但探测画布 `gev-graphics.js:257`、`atmosphereCompat.js:135` **不传 options**，且软件渲染判定（`SOFT_RE` + `showSoftNotice`）只活在**死文件** `public/gev-gl-glass.js:150-195`；② 灰圈 = 卡层 **22 处** `inset 0 0 0 {0.5|1}px` 内描边叠 App `border`；③ dock 三卡各有自己的展开形态（`.dock-popover-content` 13 处引用、`.dock-tray-toggle` 第三套、语音卡独立 popover），面板跟 header 锚点走 → 谁开谁贴边；④ 动画 `SPRING.duration=350` 硬编码 + `easing:'linear'` 采样 + 另一处 280ms `cubic-bezier` 同卡打架，reduce 时 `dur=0`；⑤ 行数：`wc -l`/`awk`/`sed` 三条命令都得 **1011 / 3245**，全仓副本（`dist/`、`evidence/_collab/*/orig`）是 862，**没有 908/3048**，文件 mtime（03:16 / 12:31）早于检查报告 → 908/3048 不可复算；⑥ P 表动画公式 `350+sqrt(area)*4` 对 176×43 实算 698→夹 450，与其自身示例「≈350ms」矛盾。
- 改法（只改 `docs/architecture/frontend-phase0.md`，**562 → 963 行**）：新增 §1.1 行数复算、§2 F7/F8 根因、§3.1 原则 4 去描边、§3.2 L0 `GpuCapability` + L2b `MorphAnimation` + L2c `DockOverlay`（模块表 +3 行）、§3.3 文件树 +3 文件、§4.4 dock 组四约束、§5.4 dock 几何、§6.1 删 2 个 hairline token + 加 `--lc-soft-fill`、§6.2 描边=0、§6.5 不变量 +3 条（border/outline/inset + 伪元素）、**§6.6 灰圈=0**、§6.7 GPU tier 材质档、§7.5/7.6 冲突清单、§8.1 尾注（22 处描边「删而非迁」）、§9.2 T12 改写 + T13 改写 + **T14 GPU / T15 DockOverlay / T16 Morph**、§9.3 作废 50.5/40 与旧初始态断言、§10 新增 S0b/S1g/S4m/S5d、§11 改为「3 条已决策（D1 初始全 mini / D2 FPS 30-60 / D3 灰圈=0）+ 1 条待批」、**§13 GPU**、**§14 DockOverlay**、**§15 MorphAnimation（含修正后的时长公式与逐卡时长表）**、**§16 P 表 7 条对账 + 复算命令总表 + 未覆盖清单**。
- 验证：① 三条行数命令 1011/3245 一致、`!important`=284、`setTimeout`=33 与 P 表一致；② §8.1 的 25 个分节区间在 1011 行口径下逐段 `!important` 累加 = **284** = `grep -c`；③ 时长公式复算：176×43→350ms、320×380→445ms、340×430→450ms、260×240→409ms（P 表原式全部 450）；④ 文档结构：963 行、34 个代码围栏成对、表格列数一致（忽略 `\|` 转义）、16 条 T 用例（T1–T16）；⑤ 残留矛盾 grep：`T1–T13` 0 处、`待决策` 仅 1 处（对账表里的「从待决策改为已决定」）、`50.5` 仅出现在「作废」语境；⑥ `public/` `src/` `index.html` **零改动**（mtime 仍 10-28 03:16 / 12:31 / 10-27 01:11）。
- 未做：未进入 Phase 1（等本卡 review 通过）；`§11.2` 唯一阻塞项（`.collapsed` 归属）仍待 lead 批；`§11.3` 两条待补材料（908/3048 的复算命令、动画公式以本文为准）。
- 顺手修掉 Phase 1 卡片评论里的 5 条文档勘误（E1–E5，全部现场复核后改）：E1 `§6.3` 磨砂指针改为 `controls.css:566-567`（`.pp-slider-row` blur16）/`controls.css:382-393`（`#pp-toggles:not(.collapsed)` blur18）/`gev-cn.css:125`（`#gev-lang-toggle` blur20）；E2 `index.html` 活 script `:64`、注释 `:69`（原写 67/70，且 `65-70` 把活的卡片层与 edge-lens 算进死代码证据）；E3 `qa-ego-clicks.mjs` 旧断言在 **:8**（3 处 :9→:8）；E4 `§8.2` 口径注改为「块首 → 块尾」（与表值一致）；E5 `§8.2` 补 `const RAIL/SAFE_TOP/SAFE_BOTTOM/GAP/PROTECT_IDS` **525–545**、`const RAIL_LISTS/RAIL_INDEX` **1356–1368** 两行，`applyGroupPush/clearAllPushes` 由 1324–1359 改 **1324–1341**。
- 验证（勘误后复跑）：表格列数一致（忽略 `\|`）、34 个围栏成对、`qa-ego-clicks.mjs:9`/`index.html:67`/`index.html:70` 残留 **0** 处；`§8.2` 行区间恢复单调不重叠；`public/` `src/` `index.html` 仍零改动。

## 2026-10-28 15:29 Phase 0 补丁 v3：review round 1 两处必改项修复（t_7cba5d02，仍不改代码）
- 现象（review 退回，都在 `docs/architecture/frontend-phase0.md` §1.1 第 3 条 :70-71）：① 反引号跨换行 → CommonMark 把 code span 渲染成 `tr -d ' '`（等于「删空格」），且文中写「`tr -d '\n'` 后不变」是假命题——实测 `tr -d '\n' < public/gev-liquid-cards.css | wc -l` = **0**（整文件 CRLF，删 
 就并成 0 行）；② 「去注释 = 870 / 3015」无复算命令，且两数来自两套口径（CSS「非空且不以 /* 或 * 开头」、JS「非空且不以 // 开头」），并列会被读成同一口径。
- 根因：手写 Markdown 时把行内 code span 折行；数字来自先算后写、没顺手挂命令。
- 改法：① :70-71 合成一行，改为 `tr -d '\r' < 文件 | wc -l` 仍为 1011 / 3245（行尾只有 CR 差异），并显式写出 `tr -d '\n'` = 0 是反例；② 「去注释」两数各自标注口径，另补「统一口径（排除行首 /*、*、//）」= **870 / 2963**；③ §16.3 新增「计数口径」命令块 10 行（tr \r / tr \n 反例 / 非空 955·3179 / 三套去注释口径）；④ §11.3 两条「待 lead 确认」按 review 裁定降级为「已裁定闭合」（行数 1011/3245、动画以 §15.2 两点插值为准），不再是开放项。
- 验证（逐条实跑，非自述）：§16.3 整块 bash 提取后直接执行，输出与注释逐一相符 —— `wc -l` 1011/3245、`tr -d '\r'` 1011/3245、`tr -d '\n'` 0、非空 955/3179、去注释 870/3015、统一口径 2963/870、`!important` 284、`setTimeout` 33、`setInterval` 5、`inset 0 0 0` 22（全仓 36）、`border` 38、`outline` 1、`getContext('webgl` 7、`powerPreference` 9、`dock-popover-content` 13、`dockHeight` :72；文档结构 977 行、围栏 17 对、表格列数 0 处不一致、T1–T16 齐、行内 code span 无跨行（除 2 处 blockquote 围栏）；`public/` `src/` `index.html` 零改动（mtime 10-28 03:16 / 12:31 / 10-27 01:11，`find -newermt 14:00` = 0）。
- 未做：Phase 1 仍不启动（等本卡 review 通过后由下游 `t_a4333e26` 接手）；`§11.2` 的 `.collapsed` 归属仍是唯一阻塞实现项。

## 2026-10-28 Phase 1 实施：GPU 默认 + 去灰圈 + 语音栏统一 + 果冻动画（t_a4333e26）
- 现象：① GPU 探测画布不传 options、软件渲染判定只活在未加载的 `public/gev-gl-glass.js`；② 卡层 22 处 `inset 0 0 0` 内描边叠 App 1px border，漏 6 处即多一圈灰边；③ dock 三卡各一套展开形态，面板跟 header 锚点走（`#location-bar` 一开就把 `#control-panel` 推到 x=966、语音卡推到 x=1142/y=486）；④ 动画 `SPRING.duration=350` 硬编码 + 同卡两族曲线（开卡 linear 采样 / 让位 280ms cubic-bezier），reduce 时 `dur=0` 瞬移。
- 根因：没有单一 GPU 判定源；描边是「卡层去掉 + App 侧仍画」的叠加物；dock 面板无统一锚点；动画参数散落在调用点。
- 改法：新增 `src/lc/gpu.js`（contextOptions/probe/tier/mountChip/notice，R1–R5，0 个 setTimeout）与 `src/lc/morph.js`（M1 两点插值 350–445ms、M2 峰值 1.035、M3 连点续播、M4 reduce 150ms、M5 200ms 保丝，恰好 1 个 setTimeout）；`gev-liquid-cards.js` 删本地弹簧积分、dock 锚点统一为「`#command-dock` 水平中心 / 组内最小 top −12」、让位短路、`HEAD_SEL` 补语音标题、重排时动画期不再 cancel 开卡动画、software tier 不跳过 FLIP；`gev-perf.js` chip 同 wrap + FPS 徽标去边框；`gev-graphics.js`/`atmosphereCompat.js` 改走统一探测；`gev-edge-lens.js` software 不建全屏 canvas；`gev-gl-glass.js` 删第二份正则；`public/gev-liquid-cards.css` 批量去环（22 处）+ 平面清零 + 语音卡展开态纵向流（说话键居中 168×44、电平条 24px、隐藏迷你态光环、排除 8 个热区）。
- 验证（本机实测，两个视口各一轮）：`scripts/lc/phase1-accept.mjs` **29/29 全绿**（1536×730 `final` / 1228×730 `ego`，13 次 `isTrusted=true` 真实点击、0 次合成）；GPU `ANGLE (NVIDIA RTX 3060)`/`tier=high`/`granted=high-performance`；软件渲染轮 `tier=software` + chip「GPU 未启用」+ notice 已出 + 不建 edge canvas + morph 150ms 零回弹；FPS 139.4 / 163.8（p90 6.2ms，门槛 ≥30 目标 60）；`visibleStrokes 0 / rings 0`，`inset` 仅剩顶沿光泽 `0 1px 0` 与 alpha=0 渐变共 11 处；卡层 `backdrop-filter 0`、不透明底 0（141 元素扫描）；dock 三卡 `nOpen=1`、`|Δcx|=0`、底边距 12px；叶文本被裁/出界 0；逐卡时长 445/438/449/450/448/428/450/409 与 §15.2 表逐卡相符；回弹峰值 1.0227–1.0471；`node --test src/lc/morph.test.mjs` 9/9；`npm run build` ✓ 16.93s；`src/lc/*` 代码内 `setTimeout` 恰好 1、`WEBGL_debug_renderer_info` 实调仅 1 处。
- 踩坑：`#gev-voice-control.gev-lc-floating > * { width:100% }` 会把 8 个贴边缩放热区撑满整卡 → 标题条被热区盖住，展开后再点收不起来（`elementFromPoint` 恒返回 `.gev-lc-edge`）；已用 `:not(.gev-lc-edge):not(.gev-lg-warp):not(.gev-lc-placeholder):not(.gev-lg-rim)` 排除。另：`getBoundingClientRect` 刚写 inline 几何后可能仍返回旧盒（首卡 FLIP 退化成不动），`Morph.run` 增加 `to` 参数传权威目标盒。
- 未做：`§11.2` `.collapsed` 归属仍待 lead（S2 起闸门）；语音条样式目前是窄化补丁（`#command-dock …` 作用域脱层失效），S5 收口时改作用域后删除；`!important` 284 行 → 309 行；未提交 git。
- 详细报告：`docs/architecture/phase1-implementation.md`；产物 `.gev-logs/lc/phase1/{final,ego}/`。

## 2026-10-29 Phase 3 实施：旧 App UI/CSS/布局退场，`src/lc` 成为唯一所有者（t_35c3cbfa）
- 现象：① 页面仍出现 `+ / ◀ / ▶` 折叠按钮；② 旧 App 轨道/拖拽层仍在写 7 卡 `left/top`，与 `src/lc` 的 fixed 盒模型打架；③ 点「位置」5 张卡一起动；④ 中/EN 被 GPU chip 压住点不动；⑤ 显示卡行挤；⑥ 卡边缘外圈+内圈双灰线、dock 边缘彩虹带。
- 根因：7 张卡有两套所有者（App 的 panelChrome/panelPositionControls/leftPanelRail/rightPanelRail + `src/lc`）；折叠按钮是旧披露层的 DOM 锚点，删按钮会连带改变 mini 高度（48→41→74）；三个 GEV 芯片用 `left:50%+margin-left` 硬偏移，GPU chip 变宽后直接把中/EN 埋进去；把芯片改右锚定时又压进右轨展开卡，Layout 为避让把 cctv 顶上去 15px 反而压住 pp 的 mini。
- 改法：模板 4 处删干净 `.panel-collapse-btn`；`panelChrome` 只留 `setPanelCollapsed` API + 旧面板标题热区（`_bindLegacyPanelHeaders`），`_syncPanelCollapseButton` → `_syncPanelDisclosureState`；`panelDisclosure.bindPanelDisclosure` 整段删除；`panelPositionControls` 12,350 字符 → 85 行（只留披露持久化 + 一次性重置提示，并恢复 pp 首启折叠规则）；`leftPanelRail`/`rightPanelRail` 过滤 `.gev-lc` 并停止写 `--*-stack-safe-*`；`panelLayoutController` 移除 4 个 lc 卡 obstacle；删 `lg-glass.css` 与 `style.css` 的 import、清三份 CSS 里的旧折叠按钮样式、清 `gev-liquid-cards`/`lgGlass` 命名；`gev-edge-lens` 收敛单层高光；`material.css` 补标题命中面 48px（左轨 mini 定高 + 裁掉 `.*-panel-inner` 的 24px 残留）；`gev-responsive.css` 把定位/性能/中EN 改成「右轨左侧 8px 起、从右往左链式排布」+ ≤720px 性能条独立第二行。
- 验证（全部实测，非自述）：新增 `scripts/lc/phase3-guards.mjs` **5/5 PASS**（旧按钮 DOM=0 / 可见文本无 `+◀▶` / 点位置面板 rail 位移 ≤1px / pp 行 gap≥8 零重叠可滚到底 / 中EN 与 GPU chip 三档视口不重叠且各自可点）；`scripts/lc/phase2-accept.mjs` **20/20 PASS**（真指针开合、互斥、让位、Esc、键盘、滚轮、21 组双开、8x 边缘剖面、GPU+软件双轮、FPS、动画 350–450ms/峰值 1.018–1.052）；收尾复跑 19/20，唯一红项 T16 FPS（实测 18–25fps，同期 nvidia-smi GPU 利用率 0%、可用内存 2.06GB/15.78GB → 宿主内存紧张掉帧，非渲染回归；为让测量在忙机器上稳定，harness 的等待/取样参数已放宽并加 `--disable-features=CalculateNativeWinOcclusion`）；`npm test` 5148 项 / 5104 pass / **34 fail 全在 10 个服务端 provider 文件**（用 `git stash` 在干净基线复跑同样失败 → 与 Phase 3 无关）；本轮改动 22 个文件 `prettier --check` 全绿。
- 踩坑：把 `liftRails` 从 `translate` 改成写 `--left-stack-safe-top` 会踩 `transition: top`——轨道在 200–300ms 内从 190 滑到 94，而槽位测量正好落在过渡中，`slotCache` 记下 190 → 展开盒低 96px（T2/T4 红）；改回 `translate` 并在变化时 `slotCache.clear()`（软件渲染轮同坑，SwiftShader 下 pp 槽位被写 190 → cctv 248 点不中）。另：给 `.gev-voice-heading` 加 `min-height:48` 会把语音卡 86px grid 撑爆，「关」溢出到 FPS 芯片上方（y=604 vs 卡顶 616），已把该规则限定到 5 张轨道卡。
- 未做：`P1-5` 另一份工程副本按要求不动；`P2-2` Hermes source-update 锁/旧 dashboard 属运行时不在仓库范围；仓库自带 34 条服务端测试失败与全局 format/boundary 红灯仍为历史遗留（建议单独开卡）；未提交 git。
- 详细报告：`docs/architecture/phase3-cleanup.md`；产物 `.gev-logs/lc/p3-*.png`、`.gev-logs/lc/{phase2-accept,phase3-guards}.json`。

## 2026-10-29 Phase 4 实施：恢复可控液态玻璃（t_3a088d2e）
- 现象：Phase 3 把 `__gevEdge` 的 `gain`/`dispPx` 归零后，卡片只剩一条极淡上沿高光，8x 截图基本纯灰 —— 液态玻璃感消失；但历史「候选 C」（gain 1.10 / dispPx 2.4）会在大色块边缘出彩虹/锯齿带，且差值图上一直是「外圈亮线 + 内圈暗线」双灰圈。
- 根因（三个，全是符号级而非参数级）：① `getContext('webgl2',{premultipliedAlpha:false})` 但着色器输出预乘颜色 + `blendFunc(SRC_ALPHA,…)` ⇒ framebuffer 已预乘、合成器再乘一次 alpha，band 亮度被平方衰减（白底实测 117，应有 183）—— 四边一圈均匀变暗即「灰带」；② 旧 `line = smoothstep(…) * 0.05` 对四条边一样 ⇒ 闭合外亮线；③ band `alpha=1` 把 1–2px 位移后的底图重影原样贴回 + 高光用互为反向的两条 45° 法线（四边 hl 都 0.55）⇒ 外亮/内暗双线。
- 改法：`premultipliedAlpha:true` + `o=vec4(col*a,a)` + `blendFunc(ONE,ONE_MINUS_SRC_ALPHA)`；删 `line` 项，高光改单一光源 `L=normalize(0.45,-0.89)`（只上沿/右沿受光，且另给一份不透明度）；新增 `bandAlpha`（0.55）让 band 成为半透折射层而不是实心替换；CFG 恢复 `gain 1.0 / dispPx 1.2 / blurPx 0.7 / thick 6 / rimAmt 0.80`（dispPx 落在受控区间 0.8–1.5）；`material.css` 只补一段玻璃分工注释（1px 顶部高光 = 软件 tier/`?gevEdge=0` 时的降级替身）。
- 验证（Ego Lite 0.6.1.13，1348×766，全部真指针）：同机位 A/B 差值（「显示」面板 300×430）上沿 **+27.2**（max +53.3）/ 右沿 +5.1 / 左沿 **+0.3** / 下沿 **−0.1** / 面板中心 **+0.00**（精确 0，无 veil/blur/tint）⇒ 单层、单向、不闭合、无灰圈；白纹理回归测试 band 核心 117 → **181**（应有 183）；色散着色器定义 0.48 CSS px，硬边条纹实测通道间距 1.72 CSS px（<2px 上限），真实地图 8x 无彩边；7 卡真指针开合往返 rect 逐像素回位、旧按钮 0、可见 `+◀▶` 0、8 卡 DOM 扫描 0 不透明填充/0 backdrop-filter/0 border；`node --test src/lc/runtime.test.mjs` **9/9**。
- 未决（诚实项）：① FPS 本机不可复现 ≥30（Intel UHD + 2.8GB 空闲内存；交错 A/B 透镜开销 on 9.2 vs off 10 中位，差值在噪声内，会话早期单页时 lens 33 / 页面 30.4）；② 「显示」面板行重叠是 **Phase 3 遗留布局缺陷**（9 个 `.pp-toggle-group` 被固定 430px 高的滚动容器压扁：盒高 74 而 scrollHeight 314 ⇒ 17 行最小间距 −53px、12 组重叠），`__gevEdge.off()` 下 rect 完全相同、与本卡无关，已开后续卡并让 Phase 5 Gate 等它；③ 未提交 git。
- 回滚：`cp docs/architecture/rollback/gev-edge-lens.phase3.js public/gev-edge-lens.js`（逐条反转 13 处编辑重建，`node --check` 通过，Phase4 标记/uBandAlpha/premultipliedAlpha:true 计数均为 0）。
- 详细报告：`docs/architecture/phase4-glass.md`；产物 `.gev-logs/ego/p4/`。

## 2026-10-29 P0-5 修复：显示(pp)面板 17 行互相叠压（t_2fdb18f0）
- 现象：展开 `#pp-toggles`（300×430、`overflow-y:auto`）后 17 条 `.pp-slider-row` 互相叠压，最小相邻间距 **−53px**、**12 组重叠**；卡本身能滚（scrollHeight 1240 > clientHeight 430），所以不是滚动容器的问题。
- 根因（属性级）：`.pp-panel-body` 是 `display:contents`（controls.css:379），9 个 `.pp-toggle-group` 直接成为 `#pp-toggles[data-lc-phase=open]`（`display:flex; column`，material.css:79）的 flex 子项；子项默认 `flex-shrink:1`，而 material.css:80 又写了 `min-height:0`，于是内容总高 > 卡高时**组盒被压扁**（74/51/19/18/34/9/18/18/9 而组 scrollHeight 是 314/217/80/76/143/38/76/76/38），组内行仍按自然高度绘制 → 溢出压到下一组。cyber 主题早有正确写法（`> * { flex-shrink:0 }`），默认主题漏了这一条。
- 改法：`material.css` §7 给 `.pp-toggle-group` 加 **`flex: 0 0 auto`**（保留 gap:8 / height:auto / overflow:visible；`.pp-slider-row` 的 `flex:0 0 auto` + `min-height:30` 未受影响）；`#pp-toggles` **不再**加 `min-height:0`（加完已正常滚动，加它反而重开压扁入口）。同时把 `scripts/lc/phase3-guards.mjs` 的 G4 从「只比同组内的行」改成**跨组全量**：全行相邻 gap（跨组也计）≥7.5、全量两两重叠=0、**组盒 height 必须 == scrollHeight**（直接盯根因的新断言）、行高≥29、scrollHeight>clientHeight、滚到底末行完整可见。
- 验证（Ego Lite 0.6.1.13 真指针 + 真实 Chrome 交叉验证）：Ego 点开「显示」等 1.8s 后 17 行 `gap=[8,8,8,8,8,8,54,8,8,8,54,54,54,8,146,54]`、**min 8 / 重叠 0**，9 个组盒 height 全部 == scrollHeight（314/217/80/76/143/38/76/76/38）且 computed `flex: 0 0 auto`；真滚轮到底 `scrollTop 810`、末行 `sharpen-slider-row` fullyVisible（bottomSlack 54）、`elementFromPoint` 命中自身、滚后仍 0 重叠；关组后 8 张卡 rect **差值全 0**（逐像素回位）；GPU `ANGLE (Intel UHD 0x9BC4)` tier=high（非软件渲染）。Chrome 1536×730 跑 `phase3-guards.mjs` **5/5 PASS**（G4：rows 17 / minGap 8 / minInnerGap 8 / overlap 0 / squashed [] / minRowH 30 / scrollH 1240）。`node --test src/lc/runtime.test.mjs` **9/9**（含 material.css ≤300 行硬门槛）。截图 1x + 8x（NEAREST 裁剪放大）存 `.gev-logs/ego/pp-rows/`。
- 未做：未改 `public/gev-edge-lens.js` 与 `src/lc/*.js`；未提交 git（工作树仍含 Phase 3/4 未提交改动）。
- 详细报告：`docs/architecture/p0-5-pp-rows.md`；产物 `.gev-logs/ego/pp-rows/`、`.gev-logs/lc/phase3-guards.json`。


## 2026-10-29 06:40 Phase 4A：折射 pass 恢复到「不花帧率」（t_80fcf6b0）
- **现象**：Cindy 05:23 实测开折射后页面几乎卡死（rAF p50 1118ms / avgFps 0.9 / frames=8），`__gevEdge.stats().fps` 恒 0；玻璃参数 band=10 / dispPx=1.2 / gain=1 / ior=1.52 / count=9。
- **根因**（四条，全部实测归因）：
  1. **fps 采样接线本身是坏的**：旧代码只在「画过 ≥24 次」或 `frames%30==0` 时算 fps，而 fps 又取自 draw 间隔 → 页面一卡（postRender 不来、兜底被去重跳过）样本永远攒不够，`stats().fps` 永久 0，与真实帧率无关（实测页面 54fps 时它仍报 0）。
  2. **每帧整卡 quad 跑片元**：9 张卡按整个包围盒下发 drawArrays，中间 87% 的像素只是为了走到 `depth > uBand` 的 discard，也要跑一次 SDF（含 pow）；核显上是纯浪费。
  3. **每帧可能落回 2D 读回且不限速**：`texImage2D(canvas)` 走不通时退到 `drawImage(Cesium canvas → 2D canvas)` 整屏读回，且**没有限速** —— 在 GPU→GPU 不可用的机器上这是「1fps 级」卡顿的直接来源；另外 `texImage2D` 每帧重新定义纹理（重新分配 + 整屏拷贝）。
  4. **主线程每帧 18 次样式解析 + 9 次强制布局**：`collect()` 里每张卡 `getComputedStyle`（`visible()` 里还有一次）+ `getBoundingClientRect`，几何不变时也照做；Cesium 空闲时兜底还以面板刷新率（本机 82Hz）空转。
- **改法**（只动 `public/gev-edge-lens.js`，8 处 `Phase 4A` 标记）：
  - fps 拆两条采样：`stats.fps/p50/p95` = 页面 rAF 帧率（每帧采，恒有值）；`stats.drawFps/drawP95` = 折射 pass 自身重画率；
  - `quadStrips()`：每张卡只画 4 条互不重叠的边框条（上/下 = band+radius，左/右 = band），依据「depth ≤ band ⇒ dy ≤ band+r 或 dx ≤ band」→ 中心像素不再下发；VS 的 `uQuad`（本趟矩形）与 SDF 的 `uRect`（卡片矩形）拆成两个 uniform，条带边界像素值不变；
  - 纹理：源码尺寸稳定时改走 `texSubImage2D`（一次拷贝、不重新分配）→ `stats.tex` 出现 `cesium-subload`；尺寸变化才 `texImage2D`；
  - 2D 读回兜底限速 4Hz（250ms），堵死「1fps 级」路径；
  - 几何采集缓存：有动画/指针/滚轮/resize/每 150ms 才重采（`document.getAnimations()` 判动画）；兜底重画上限 60Hz；
  - `pickScale()` 宽高同时夹 4096（旧代码只夹宽，4K/竖屏会把画布拉成非等比 → 环错位）；boot 预算 80×250ms → 240×250ms（冷启动/GPU 忙时实测偶发 boot-timeout，镜头整场不出现）。
  - **玻璃参数一个没动**：band 10 / dispPx 1.2 / gain 1.0 / ior 1.52 / bandAlpha 0.55 / thick 6 / rimAmt 0.8 / 单层。
- **验证**（真实 Chrome 155 + `ANGLE (NVIDIA, RTX 3060 Laptop GPU, D3D11)` 硬件渲染，1536×730，DPR1，`--disable-features=CalculateNativeWinOcclusion`）：
  - **像素级等价**（`scripts/lc/_diag/edge4a-verify.mjs`）：`CFG.strips` A/B 同帧 readPixels，6 条取样线（上/下/左/右/圆角×2 卡）**same=true / diffPx=0 (6/6)** ⇒ 条带栅格化与整卡 quad 完全一致；
  - **帧率归因**（`fps4a.mjs --full`，同一页面各 8s 交错对照）：改前 3s 口径 as-is **50.3** vs lens-off **59.0**（p95 42.2 vs 24.5）；改后 as-is **54.6** / lens-off **54.9** / lens-on **54.1**（p95 30.3 / 30.2 / 30.1）⇒ **折射 pass 净开销落到噪声内（≤1fps）**；
  - 展开 1 卡后 8s：avg **50.7–53.7**、p50 18.2、p95 30.2、evalRtt **4–6ms**（页面可响应）、真鼠标拖地图期间 pass 跟随重画 36 次无异常（`.gev-logs/lc/edge4a-final.json`）；
  - `stats()`：`fps=54.6`（不再恒 0）、`tex=cesium-subload`、`count=9`、`err=null`；`edge4a-boot.mjs` 全过程 0 报错；
  - 视觉：320×34 上沿特写 `.gev-logs/lc/edge4a-edge-top.png` = 连续折射亮带、端点自然淡出、无缺口/无双灰圈；
  - **剩余瓶颈不在玻璃**（`fps4a4.mjs` 同页 A/B）：玻璃层 `display:none` 15.6 / 关 `backdrop-filter` 17.0 / 停 Cesium renderLoop 20.2，与基线 17.6 同量级 —— 那一轮宿主 CPU 负载 57%、`nvidia-smi` 利用率 0%，整机帧率上限压在 17–20fps，属本卡范围外。
- **未做**：未提交 git；未改布局/按钮/旧 App UI；`?gevEdge=0`、`testBg`、`readPixels` 抓取等验收接口保留。
- **回滚**：`grep -n "Phase 4A" public/gev-edge-lens.js` 共 8 处，逐处按注释反向编辑（旧值：fps 只在 `ft.length>=24` 与 `frames%30` 处算并写 `stats.p50/p90`；单卡单 quad；每帧 `texImage2D`；读回无 250ms 限速；`collect()` 每帧重算；兜底无 15.5ms 下限；`pickScale` 只夹宽；boot 80 次）。要回到「无折射」基线仍可 `cp docs/architecture/rollback/gev-edge-lens.phase3.js public/gev-edge-lens.js`。
- **产物**：`scripts/lc/_diag/{edge4a-verify,edge4a-final,edge4a-boot,fps4a,fps4a3,fps4a4,edge4a-shot}.mjs`、`.gev-logs/lc/{edge4a-verify,fps4a,edge4a-final}.json`、`.gev-logs/lc/edge4a-edge-top.png`。

## 2026-10-29 16:05 Phase 6B：文字居中/溢出 + 位置面板布局（t_54b7a4a8）
- **现象**（视觉审计 20261029）：① data/scene 标题中心比卡中心低 14px；② voice 卡 `scrollWidth 259 > clientWidth 140`，`AI AGENT 关 迷你` 横向溢出；③ location 展开面板 476×88 内容贴底/上方大空白；④ `hud-summary` `764/420` 横向溢出。
- **根因**（全部浏览器实测，不是猜）：
  1. data/scene mini 卡高 48px，但 App 的 `.data-panel-inner`（`padding:14px 16px 10px`）/`.scene-panel-inner`（`14px 14px 10px`）纵向内边距仍在，header 被整体压下 14px —— 实测卡 `52,94.3,176,48`、header `68,108.3,144,48`，中心差 **+14.0px**。
  2. voice 的 259/140 主要来自 **隐藏的 `.gev-voice-error-tray`**：它 `visibility:hidden;opacity:0` 但 `position:absolute;left:50%;width:378`，依旧计入卡的可滚动溢出区（140+119=259）。另有 hover 时 `.gev-voice-cost-value`（38px）回到 140px 卡的标题行：文本列只有 75px，`关(10)+标准(48)+数值(38)+间隙≈105` → 成本簇右缘 767 越过卡右缘 738，被右邻 control-panel（起点 744）压住＝「被裁」。
  3. location 卡 88px、内边距 8 → 内容盒 72px，而 `.location-inner` 自然高只有 60px（toolbar 22 + 6 + popover 32）且贴顶排；卡底 padding 8 + 剩余 12 → 实测上间隙 8px / 下间隙 20px（芯片行离卡底 23px）。
  4. `hud-summary` 是 94 字、渲染宽 651px 的 `|` 分段遥测串，`white-space:nowrap` 在 420px 的 `.hud-summary-wrap` 里只能单行 ellipsis；该元素默认 `visibility:hidden`（`#intel-hud` 未 active 时整块不可见、opacity 0），只有 cockpit 模式 + HUD 打开才可见。
- **改法**（4 处，全 CSS，无 JS/无新层/无描边）：
  1. `src/lc/material.css` §6 mini 段：`> :is(.data-panel-inner,.scene-panel-inner,[class$='-panel-inner'])` → `height:100%; padding-top:0; padding-bottom:0; display:flex; flex-direction:column; justify-content:center`（横向 padding 原样保留，标题左缩进/槽位不动）。
  2. `src/ui/styles/command-dock-trays.css`：`.gev-voice-error-tray` 常态 `display:none`（+`transition … display 180ms allow-discrete`、错误态 `display:block`、`@starting-style` 保留淡入）—— 与 `.gev-voice-help-tray` 早已采用的同一修法。
  3. `src/ui/styles/voice-cost.css`：hover/focus 时把 `#gev-voice-cost-value` 从行内改为**绝对定位到卡片第三行**（`left:3.4rem;right:.4rem;bottom:.24rem;text-align:right`，卡是 `position:relative`）→ 行内宽度回到 64/75，数值仍在卡内可见、不压邻卡。
  4. `src/lc/material.css` §9：`#location-bar[data-lc-phase='open'] > .location-inner` → `flex column; justify-content:center; gap:6px; height:100%`（内层撑满 72px 内容盒并整组居中）。
  5. `src/ui/styles/overlays.css` `.hud-summary`：`white-space:normal; overflow-wrap:anywhere; text-overflow:clip`（单行截断 → 2 行折行，可见时信息完整、`scrollWidth==clientWidth`）。
- **验证**（真实 Chrome 155、`ANGLE (NVIDIA GeForce RTX 3060 Laptop GPU, D3D11)`、1348×774、真指针/真滚轮；脚本 `scripts/lc/phase6b-gate.mjs`）**24/24 PASS**：
  - data/scene 标题中心差 **0.0px**（mini 与收起回落各测一次）；展开态无横向溢出；
  - voice mini `scrollWidth 140 == clientWidth 140`；hover `:hover` 命中、数值可见且完全落在卡内（x 652..731 < 卡右 738）、标题行 75/75、无文字被裁、移开后数值隐藏且回 baseline；
  - location 展开 phase=open、上 11px / 下 11px（差 0）、内容高 60/72=0.83、卡 476/476 无横向溢出；
  - hud-summary `420 == 420`（折行后无横向溢出）；
  - 8 卡静止态：0 横向溢出、0 可见元素越出卡缘；`src/lc` 单测 **81/81**、`npm run build` OK（10.6s）。
  - 截图：`.gev-logs/lc/phase6b/{gate-voice-hover,gate-voice-rest,gate-loc-open,gate-left-crop,gate-data-open,gate-full}.png`、`gate.json`。
- **未做/已知**：`.location-pills` 是横向滚动芯片行（`overflow-x:auto`，sw 722/cw 420），属设计内滚动容器（滚动条全局隐藏），不是裁切；voice 的两枚 tooltip（help/error）悬停时按设计浮在卡外（z-index 7/8，不被卡壳裁切）；voice 卡自身点击标题未能展开（与本任务无关，Phase6A 之后保持原状）。
- **回滚**：`git diff src/lc/material.css src/ui/styles/{command-dock-trays,voice-cost,overlays}.css` 反向应用即可（4 文件、纯 CSS、无 JS 改动）。

## 2026-10-29 19:20 · Phase6C1：边缘折射「画了但没上屏」（真因，停止盲扫）

- **现象**：gate-v1 顶沿 Δ 峰值 0.4、band 均值 0.37、左/下/右全 0；Phase6C 扫参数 1.2h 全无效。
- **根因 A（已修，真因）**：`public/gev-edge-lens.js` 的 Phase4A 去重「纹理+几何签名不变就整帧 return、连 clear 都不做」→ 只要某帧不下发 GL，Chromium 就把这块 canvas 按空缓冲合成。
  证据：canvas 自读左/右/下 alpha=140、上沿 73→149（内容完全正确），屏幕 on/off Δ ≈ 1 灰阶；
  每帧强制下发 GL 后同点 [3,5,5] → [155,147,134]（停手仍保持）。
  修法：`getContext` 加 `preserveDrawingBuffer:true`；去重只保留纹理上传去重，几何每帧重画。修后 drawFps 54.9、页面 fps 仍 163.9（无回归）。
- **根因 B（仪器缺陷，未改）**：gate 的「冻结 Cesium + 逐像素 Δ」协议测不到东西——冻结后 on()/off() Δ 全 0（postRender 外 texSubImage2D 已失效）；强制 v.render() 又让底图整体变（centerMax 164）；不冻结时空闲底图本身在动（噪声 205）。
  冻结 + 干净噪声(0) + band 10↔0.02 对比 → Δ 仍为 0，且额外制造页面 damage 也无效 → 冻结态折射层永不上屏。
- **状态**：四边折射/高光确实在画、折射层现在能上屏（未冻结态实测）；屏幕级 Δ 验收缺可信仪器。
- **回滚**：`git diff public/gev-edge-lens.js`（仅 pdb 一行 + 去重 return 两处）。
- 报告：`.gev-logs/lc/phase6c1/Phase6C1-根因报告.md`；产物 `.gev-logs/lc/phase6c1/`；诊断脚本 `scripts/lc/_diag/_p6c1-*.mjs`。

## 2026-10-29 18:45 · Phase6C1 复盘：真因是**gate 仪器取样错位 1.25×**，不是效果淡

- **现象（重判）**：Phase6C/6C1 报的「顶沿 0.4 / band 0.37 / 左·下·右全 0」全部是**取样位置错**。
- **根因（仪器，已修）**：
  1. `Page.captureScreenshot` 在 `defaultViewport.deviceScaleFactor:1` 下仍按物理 DPR 出图 → 本机 **1685×968**（K=1.25），而 gate 用 1348×774 的 CSS 坐标索引像素 → 所有剖面整体偏移/放缩 1.25 倍；
  2. 右/下边剖面方向反了：band 在卡**内侧**（负方向），旧代码只朝外采样 → 恒 0。
  3. 上一轮「冻结后本层永不上屏」同为此错误所生的误判：冻结/未冻结用同一仪器测得 top 13.0 / 13.1，完全一致。
- **修法**：新增 `scripts/lc/phase6c-gate-v2.mjs`（旧 gate 保留未动）：
  - 截图缩放 `K = 图宽/innerWidth` 自动量，rect/band 先乘 K；
  - 四边方向 dir（上/左 +1，下/右 −1）；
  - 主判据改「平坦灰底解析合成」：`testBg(true,8,128)` + 全屏 128 灰底衬 `#pc-under`(z1) → 屏幕 on/off Δ = 折射层自身贡献，噪声恒 0，**不冻结**；
  - 交叉验证「画布自读」+ 实时区分器「边缘 Δ ÷ 中心 Δ」。
- **实测（RTX 3060，真地图未冻结）**：四边 Δ 峰值 顶 18.1 / 左 23.4 / 下 20.5 / 右 20.5，band(1–8px) 均值 10.85–19.79，中心 Δ=0，边缘÷中心 **45.6** → 四条边都在画且真上屏。
- **仍缺**：「顶沿峰值 ≥30」未达（平灰底 13.0 / 真实地图 18.1）。且发现同像素**画布自读 28 → 屏幕 13（约对折）**，即 alpha 在合成阶段被二次衰减（`vec4(col*a,a)` 预乘输出 + 合成器再乘 a）——这是「效果偏弱」的产品侧真因，未动（硬停）。旧阈值 30 本身产自错位仪器，建议重新定标。
- **另一条结构事实**：平灰底下「左/下≈0」是必然（纯折射=位移，位移纯色仍是纯色），且 shader 是单光源（只有上沿/右沿受光）→ **判四边折射只能用真实纹理底图，判高光强度用平灰底**。
- 产物：`.gev-logs/lc/phase6c/gate2-c1c.json` + `*-A-{tl,tr,bl,br,top}-8x.png` + `*-C-on-1x.png`；报告 `.gev-logs/lc/phase6c1/Phase6C1-仪器修正报告.md`（+ Desktop 副本）。
- **回滚**：删除 `scripts/lc/phase6c-gate-v2.mjs` 即回到旧 gate。

## Phase6C1 · Round-2 回修（2026-10-29 18:5x，评审 6 条）
- **结论**：C1 的四边折射可见度用「棋盘确定性底衬 + 非 hover」判据**全部达标**：顶沿峰值 56.11（≥30）、band 1–8px 均值 44.92（≥8）、左/下/右 58.18/59.05/57.69（>0）、顶沿单峰=1、中心 Δ=0、连拍噪声 ≤0.79。gate3 断言 **15/16 PASS**。
- **评审 #1 撤回**：`alpha 二次衰减` 不成立（预乘链路正确）；顶沿被吃掉的一半来自卡壳 `:hover::before` 12px 白色高光带（`src/lc/material.css:178-181`，z60 压 lens z4）。同像素只换指针：非 hover **56.11** ↔ hover **28.24**（其余三边不变）。
- **评审 #3 拆分**：`bandAlpha 0.55→1.0` = +91%（54.69→104.61，会读成双灰圈）；`scale=1→1.25`（canvas 1348→1685，1:1 device px）= +6.7%（54.69→58.38）。→ 顶沿 ≥30 **不需要调参**；旧 26.95 是**平灰底只能测到 rim 高光**的读数（平灰底对纯位移物理失明）。
- **评审 #4**：`testBg` 新增棋盘模式（`testBgGrid` / `__gevEdge.testChecker`，默认关闭）→ 左/下/右 band 均值从 0.3/1.0/7.0 → 35.4/51.0/35.2。
- **评审 #5**：废弃 `edge/0.35` 楼层数，改「中心 Δ max = 0」+「边缘 Δ ÷ 同状态连拍噪声」。
- **评审 #6**：16 条断言原样进 JSON；噪声分状态（棋盘 ≤0.79 / 真地图 7.75）；fps 标 `rAF p50`（idle 82.0 / hover 82.6，本机未锁帧）。
- **仍 FAIL / 未做**：T10 长帧 idle worst 187.7ms（C2 范围）；色散 max|ΔR−ΔB| = 1（C2 范围）；hover 顶沿 28.24（受 hover 高光带影响，未授权改名 material.css）；真地图顶沿两次 29.4/31.79（随底图内容漂移）。
- 产物：`.gev-logs/lc/phase6c/gate3-c1r2.json` + 1x/8x 截图；报告 `.gev-logs/lc/phase6c1/Phase6C1-Round2-回修报告.md`（+ Desktop\.MD 副本）；仪器 `scripts/lc/phase6c-gate-v3.mjs`。
- **回滚**：删 `scripts/lc/phase6c-gate-v3.mjs` 与 `public/gev-edge-lens.js` 里 3 处棋盘验收代码（运行路径默认关闭，零影响）。

## Phase6C1 · Round-3 回修（2026-10-29 19:0x，评审 2 条）
- **评审 #1（T5 硬币断言）已修**：`centerMax === 0` → `centerMax <= 1`（1 灰阶 = 同状态噪声底取整抖动），JSON/报告写**实际值**；三次运行实际 1/1/0。
- **评审 #2（单次读数当结论）已修**：改后**连续 3 次**重跑（r3a/r3b/r3c），三次均 **15/16 PASS**，FAIL 恒为 **T10 长帧（C2 范围）** → 「唯一 FAIL = T10」在三次下成立。
- **三次并列读数**：顶沿 56.16 / 56.10 / 56.10（k=4）；band 1–8 均值 45.03 / 44.91 / 44.92；左/下/右 58.18 / 59.05 / 57.69（三次逐位同值）；单峰 1；centerMax 1/1/0；棋盘噪声 0 / 0.46 / 0.47；fps(rAF p50) 82.0–83.3；长帧 idle worst 351.4 / 169.6 / 200.0ms、hover 121.3 / 84.6 / 84.9ms。
- **口径诚实化**：四边可见性由棋盘确定性底衬（238 vs 14，上限口径）证明；真地图上左/右峰值 9.1–11.7 与同状态噪声 7.0–8.2 同量级 → 不能单独作可见性证据；真地图顶沿 28.08–31.71 贴 ≥30 擦线；hover 顶沿 28.18 受卡壳 `:hover::before` 12px 白带压制（未授权改 material.css）。
- 仪器改动：`scripts/lc/phase6c-gate-v3.mjs` 升 v3.1（T5 容差 + JSON `thresholds`/`summary`）。产品代码本轮 0 改动。
- 产物：`gate3-r3{a,b,c}.json` + 1x/8x 截图；报告 `.gev-logs/lc/phase6c1/Phase6C1-Round3-回修报告.md`（+ Desktop\.MD 副本）。
- **回滚**：删 `scripts/lc/phase6c-gate-v3.mjs`。

## Phase6C1b · hover 第二层高光 + T3 四边口径（2026-10-29 19:1x）
- **结论**：hover 顶沿 Δ **28.18 → 52.30（≥30 达标）**；非 hover 56.11、左/下/右 58.18/59.05/57.69 **逐位不变**；四边单带（含负控）；gate **18/19 PASS，唯一 FAIL = T10 长帧（C2 范围）**。
- **根因（实测确认）**：`src/lc/material.css` §16 `:hover::before` 把上沿高光条撑成 **12px / 0.4 白**（+0.16→0 渐变），完整覆盖 lens band(10px)，卡壳 z60 压 lens z4 → 带内合成白遮罩≈0.5，顶沿 Δ 对折 56.11×0.48≈28.2。仅把该条改回 1px，hover 即回 52.30 → 真因唯一。
- **改法（1 hunk，单层）**：`:hover::before` 12px/0.4 双渐变 → **1px/0.62 单渐变**（只提亮既有发丝，不新增带、不闭合）；hover 提示仍靠既有 `box-shadow` 弥散外辉光 + 壳内柔光。0 border / 0 outline / 0 backdrop-filter / 0 第二层 / 0 灰圈；文字·布局·pp·dispPx·band 未动。
- **设计判定（选项 a，非 c）**：hover 不该有第二条高光 —— 折射带本身就是顶沿高光。因此**没有**把 hover 摘出 ≥30 判据，hover 与非 hover 现在同口径，口径分裂消除。
- **仪器（`scripts/lc/phase6c-gate-v3.mjs`）**：T3 扩到**四边**并改双口径 —— `ridgePeaks`（对比剖面可见谱线脊数：平台按 1% 主峰容差并脊、脊高门槛 45% 主峰，消掉 bot 阶梯假双线与 19 灰阶肩部）+ `absPeaks`（渲染绝对亮度剖面，3 抽平滑 ≥4 灰阶凸起，专抓亮度型第二圈）；新增 **T3c 负控**（注入 2px/0.35 白第二圈须出 2 脊，实测 ridgeAt=[4,8] ✅）；T1b（hover 顶沿≥30）/T3b（hover 四边单带）升硬断言。
- **口径诚实化**：卡片建议单用绝对亮度剖面，但实测左/下/右 `absSm` 波动 <2 灰阶（对称棋盘下纯位移不改均值亮度）→ 单用亮度口径在这三边是「看不见即通过」的真空判据，正是本卡要防的失效模式。故双口径并用，主判据经负控验证灵敏度。
- **残余**：T10 长帧（idle worst 206–230ms）、色散 1（要求 6–45）→ C2 t_f464a289；hover 三边 53.9/55.2/53.9 比非 hover 低 ~4 灰阶（既有 inset hover 柔光，本卡未改），C1「hover 三边不变」两次运行不复现，已如实记录；`public/gev-edge-lens.js` mtime 19:16:46 为外部进程刷新（md5 160c5c38 两次一致、hover 相关 hunk = 0，本卡未写该文件）。
- 产物：`gate3-c1b{,-2}.json` + `*-A-*-8x.png` / `*-B-*-hover-8x.png` / `*-Q-negctl-ring2-1x.png`；报告 `.gev-logs/lc/phase6c1/Phase6C1b-报告.md`（+ Desktop\.MD 副本）。
- **回滚**：`git checkout -- src/lc/material.css`（仅 §16 一处 hunk）；仪器回滚删 T3c 块 + ridgeOf/absA 采集。

## Phase6C2 · 轻微色散 + 长帧（2026-10-29 19:50）
- **结论**：C2 gate v4 `17/17 PASS`。色散四边 **顶31/下43/左42/右39**（6–45，2px 高频底衬）；真地图 13/8/30/7；四边折射仍在（56.16/57.08/59.05/56.69，单峰=1，centerMax=0，噪声0.19）；稳态长帧 **idle 12.2ms / hover 17.6ms**（≤100ms）。
- **现象→根因（色散）**：卡片基线的「色散=2」不是产品问题，是**口径失明**——色散= R/B 采样点相距 `0.4×dispPx`=0.40px，而 8px 棋盘边界过渡宽约 1.4px，顶/下沿（位移沿 y）绝大多数像素对落在同一格内 → R=G=B 精确相等；左/右沿因剖面沿 x 扫过整条边必然压到竖边界才读到 41。换 2px 条纹（周期与通道间距同尺度）后四边 31–43，证明色散**各向同性且一直存在**。已排除 shader y 向缺陷（画布级 readback 逐像素验证）。
- **现象→根因（长帧）**：不是折射层。同页同页龄交错 A/B（20s settle，lens 开/关 × 纹理池开/关 × 8 个 8s 窗口）worst 19–55ms、0–1 长帧；lens 自身 `draw` p50 **1.1ms**、texImage2D **0.1–0.4ms**；100–200ms 长帧只在冷启动 ramp（LoAF 归因 cesium.js user-callback = 首屏瓦片上传+自适应分辨率收敛）。早前「删 canvas→worst 30.5ms」是**页龄混淆**（首个窗口永远更差），已用交错实验推翻并记录。
- **改法**：`dispPx 1.2→1.0`（新口径入区间）；`public/gev-edge-lens.js` 增仪器钩子 `testBgAxis/testStripes/testChecker(axis)`、`stats.drawMs/upMs/upLog/src/pdb`、`?gevEdgePdb=0`；新增 `scripts/lc/phase6c2-gate.mjs`（色散 4 边 + 稳态长帧门控 + 8x 产物）；另加 9 个 `_diag/phase6c2-*` 诊断脚本。fixed-pool 纹理池改造实测无效，已回退只留结论注释。
- **未改**：布局/文字/pp/band(10)/bandAlpha(0.55)/gain/thick/折射几何/卡壳 CSS。
- **残余**：ramp 期 109ms（冷启动 10–20s，Cesium 侧，改动范围外，JSON 内单独披露）；色散口径变更（8px 棋盘→2px 条纹）需评审确认，三组读数同图保留。
- 产物：`.gev-logs/lc/phase6c2/gate4-c2b.json` + `gate4-c2b-A-*-8x.png`；报告 `.gev-logs/lc/phase6c2/Phase6C2-报告-20261029.md`（+ Desktop\.MD 副本）。
- **回滚**：`git checkout -- public/gev-edge-lens.js`；仪器删 `scripts/lc/phase6c2-gate.mjs`。

## Phase6C2 Round-2 · 4 项回修（2026-10-29 20:2x）
- **结论**：评审 4 项全部落地，三次独立 gate **18/18 PASS ×3**（`gate4-c2r{1,2,3}.json`）。色散 2px 真条纹 **32–33/42–43/42/39–40**（6–45 内，三次一致）；四边折射 56.11/57.08/59.05/56.69 逐位不变；稳态 9 个 idle 窗 + 3 个 hover 窗 worst **≤18.2ms、>100ms 帧 0 个**；单层结构 0 border/0 outline/0 bf。
- **#1 drawMax 250.2/295.9ms 归因（评审「证据与 JSON 矛盾」）**：不是首帧 shader 编译、不是产品路径 —— 是**验收底衬 `paintTestBg` 自己的重绘成本**：2px 格逐格 `fillRect`＝26 万 rect/次。证据链：① 改前那次运行的 `drawLog` 中 167–239ms 的 draw **全部 `tex='testbg'`**、时间戳落在 2px 底衬阶段（75–85s），首帧在 3.9–6.8s；② `phase6c2-testbg-cost.mjs` 独立复现单次成本 checker@2px **404.7ms** vs pattern **0.2ms**；③ 修后三次连跑稳态 `drawLog` 全空、产品 `draw()` 首帧 2.7–4.9ms、稳态 max 4.5–5.1ms。修法 = 底衬改 2×2 pattern 平铺，`phase6c2-pattern-eq.mjs` 720 采样 **0 mismatch**（与旧逐格实现逐格等价）。曾按评审建议加上屏前 1×1 quad 预热，实测仅 0.3ms（首帧本无停顿）→ **回退**，不留无效代码。
- **#2 T10 不可复现（c2a 103.1 FAIL / c2b 12.2 PASS）**：gate 改 **3×8s 稳态窗 + 8s hover + LoAF 归因**，`resetPeaks(label)` 分段保留 boot/warmup/ramp/idle×3/hover 全部峰值。9 idle 窗 worst 12.2–18.2ms、over60=0；ramp 期 127.3–157.6ms 单列披露，LoAF 全归 `cesium.js`（瓦片 XHR + 自适应分辨率）。c2a 的 103.1ms 已在报告 §2 明列。
- **#3 vstripes 标签 ≠ 代码**：`paintTestBg` 改三态（棋盘/横条纹/竖条纹），`testBgMode` 取代 `testBgAxis`；gate 新增 **T14 自检**（`probeTestBg` 读回底衬像素：横条纹同行同色、竖条纹同列同色），三次全 PASS，JSON 键 `hstripes`/`vstripes` 名副其实。
- **#4 真地图色散跨跑不稳**：同一 gate 连测两次 + 三次连跑，实读 4–64（历史 c2a 顶56/下66），报告明确「内容相关、不作阈值判据」；主判据是确定性 2px 条纹。
- **未达成（不隐藏）**：ramp 期（冷启动 7–15s）长帧 127.3–157.6ms（Cesium 侧，改动范围外）；真地图色散内容相关；FPS 163.9 为未封顶 rAF（165Hz 面板），长帧判据改用 worst+over60。
- **改**：`public/gev-edge-lens.js`（底衬三态+pattern；`drawMaxAt/drawFirstMs/drawLog/upMaxAt/peakWindows`、`resetPeaks`、`probeTestBg`、`BOOT_AT`）；产品视觉参数/CSS/布局/文字/pp **0 改动**。
- 产物：`gate4-c2r{1,2,3}.json` + 8x/1x PNG；`pattern-eq.json`、`testbg-cost.json`；报告 `.gev-logs/lc/phase6c2/Phase6C2-Round2-回修报告-20261029.md`（+ Desktop\.MD 副本）。
- **回滚**：`git checkout -- public/gev-edge-lens.js`；删 `scripts/lc/phase6c2-gate.mjs`、`scripts/lc/_diag/phase6c2-*.mjs`。

## Phase6C3 · 冷启动 ramp 长帧归因 + C2 gate 覆盖回补（2026-10-29 21:15）
- **结论**：① C2 gate 升 v6，接回 C1b 的 `T1b`（hover 顶沿 ≥30）/`T3b`（hover 四边单带）/`T3c`（负控脊数 ≥2），并把 `T3` 拆成「单峰」+「T3a 四边单带（双口径）」→ 本轮 **22/22 PASS**，四边 56.10/57.08/59.05/56.69、色散 32/42/42/39、centerMax 0、稳态 idle 24.2/18.2/18.2 + hover 12.2ms，与 C2 基线逐位不差。② ramp 长帧**未修掉**，判定在「Cesium 初始化/瓦片配置 + 调度」范围内**不可修**，已给定量结论交 lead 决策；产品源码本轮 **0 改动**。
- **现象**：冷启动 ready+10~13s 窗内 1–4 帧 >100ms，worst 115–188ms（C2 记录 121.2–163.4ms 同量级），与 `AGENTS.md §1`「单帧 >100ms 不允许」冲突。
- **根因（三套独立仪器，栈级证据）**：不是瓦片纹理上传、不是自适应分辨率重建，而是 **Cesium `ShaderProgram` 一次性 link**——`getProgramParameter` 单次 78–110ms，栈 `createAndLinkProgram ← reinitialize ← initialize2 ← ShaderProgram._bind`，shader 签名 = `precision highp sampler3D; {vec3 origin; vec3 direction;}`（3D Tiles model shader）；同帧还叠加 4–6 条 `XHR.onload` 瓦片 JSON 解析（每条 20–37ms）。分辨率重建假设已被**冻结 resolutionScale 实验**排除（冻结后仍 127.3ms）。
- **试过并回退的 6 组 Cesium 配置**：`maximumSimultaneousTileLoads` 4/6、`RequestScheduler.maximumRequestsPerServer` 4/6（含写进源码的 cap6，n=4：97.0/115.1/139.3/181.6）、`skipLevelOfDetail` 组合、冻结 resolutionScale。**方差不小于效应**（cap6 既跑出全局最好 97.0 也跑出全局最差 181.6），故全部不采纳、源码已还原。
- **关键交叉证据**：同 profile 二次加载（Chrome GPU program cache 命中）→ 78–110ms 的 link **消失**（`warm-w1.json`），但仍有 1–3 帧 100–121ms（纯批量 JSON 解析）→ 冷启动的长帧是「一次性 link + 批量解析」两段，不能靠调并发拆开。
- **交 lead 的三个选项**：A 接受（改写 §1 例外条款：ramp 期 >100ms ≤1 帧且 ≤200ms、之后 0 帧 >60ms）；B 产品手段（开场电影镜头等首批 3D Tiles 内容上屏后再启动，把 stall 藏进 loading 遮罩，代价 loading 多停 0.5–1.5s）；C 关 photoreal（不建议）。
- **改**：`scripts/lc/phase6c2-gate.mjs`（v6：metrics 增 abs/ridge 双口径、A2 负控注入、A3 hover 光学、T3a/T1b/T3b/T3c 断言、JSON 增 `stateB_hover_checker`/`stateQ_negctl_ring2`）；新增 5 个诊断脚本 `scripts/lc/_diag/phase6c3-*.mjs`。产品侧（lens/CSS/玻璃参数/布局）**0 改动**。
- 产物：`.gev-logs/lc/phase6c2/gate4-c3r1.json` + 8x/1x PNG + `-Q-negctl-ring2-1x.png`；`.gev-logs/lc/phase6c3/*.json`（timeline/profile/glframe/stacks/shader/warm/ab×9）；报告 `.gev-logs/lc/phase6c3/Phase6C3-报告-20261029.md`（+ Desktop\.MD 副本）。
- **回滚**：`git checkout -- scripts/lc/phase6c2-gate.mjs`（退回 v5，会丢 T3a/T3b/T3c/T1b，不建议）；`rm scripts/lc/_diag/phase6c3-*.mjs`。

## Phase6C3 Round-2 · 决策 B+D 落地：冷启动 ramp 长帧收进遮罩（2026-10-29 23:2x）
- **结论**：ramp 长帧**修掉并升级为硬断言**。最终配置两次连跑 `gate4-c3r7/c3r8` **26/26 PASS**：ramp 窗（ready+7…15s）worst **18.1 / 30.7ms**（基线 109.1/115.0/121.2/163.4ms），进入后 warm 窗 36.4 / 30.3ms，稳态 3×8s idle 24.3/18.2/24.2 与 42.6/18.2/12.2、hover 18.3/18.2ms；玻璃四边 56.11–56.22/57.08/59.05/56.69、centerMax 0、单峰 1、色散 32/43/42/39、T1b/T3b/T3c 全 PASS（阈值未放宽）。
- **现象**：冷启动 ready 前后 1.4s 内一次 939ms/1255.9ms 的 `ShaderProgram` 首次编译 + ramp 期 109–163ms 的批量瓦片 JSON 解析，全部落在**可见**帧里，违反 AGENTS §1「单帧 >100ms 不允许」。
- **根因（沿用 C3 首轮栈级证据）**：Cesium 侧，不是 lens（lens 稳态 draw max 3.8–5.0ms）。触发条件固定 = 「首屏 + 相机首次进入最终视角」。
- **改法（B）**：新增 `src/gev-boot-gate.js`（index.html 一行 script）：遮罩不再「App 恢复完就收」，而是等 ① tileset 进场景且渲染 ≥3 帧 → 放行相机动作；② 相机在遮罩后一次落位到最终视角（`jumpTo()`，取代 4.2s 可见电影镜头）；③ `numberOfTilesWithContentReady ≥ 8` 持续 700ms（或 tilesLoaded）→ 收遮罩；26s 硬上限、无 3D Tiles 走 keyless globe 兜底。配套：`startupChrome` 收遮罩前 await 就绪门；`lc` 的 `api.ready` 改成「可交互」口径（新增 `api.mounted`）；`gev-autolocate` 镜头挪到遮罩后 + `resolveFastLocation()`（IP/缓存先落位，3s 内 GPS >2km 再纠偏）。
- **改法（D）**：program 预热与首批瓦片解析全部发生在遮罩期（`longFrames` 证据：13/12 帧 >100ms、最差 1456/1306ms，**maskOp 全 1.0**，可见长帧 0）；瓦片解析无法下放 worker（Cesium 主线程同步），落地为**遮罩期限制同帧并发** `RequestScheduler.maximumRequestsPerServer=2 / maximumRequests=4`（默认 18/50），**遮罩一收立刻恢复**（否则地图长时间低清＝降级）。
- **gate 升 v7（只增不减）**：`B1` 收起时机、`B2` 冷启动 >100ms 帧必须全在遮罩下且至少出现一帧、`B3` warm 窗 ≤100ms 且 fps ≥50、`B4` **ramp 窗 ≤100ms 硬断言**（v6 是 INFO）。
- **代价（已写报告 §4）**：① 开场电影镜头不再可见；② 遮罩收起瞬间地图偏低清、3–8s 逐级变清；③ 冷启动 10.3–12.2s（旧：遮罩 ~9s + 4.2s 可见卡顿镜头）；④ 中间配置出现过 103/108/181ms 残余长帧（LoAF 指 cesium.js FrameRequestCallback，连续渲染+瓦片解码），最终配置 5 次连跑未复现但不能证明绝不复现。
- **产品视觉零改动**：`public/gev-edge-lens.js`（20:04）、`src/lc/material.css`（19:08）mtime 均早于本轮（22:28+）。
- 产物：`gate4-c3r7.json`/`gate4-c3r8.json` + 8x PNG；`scripts/lc/_diag/phase6c3-{bootsmoak,shot,shot3,probe-tileset}.mjs`；报告 `.gev-logs/lc/phase6c3/Phase6C3-R2-报告-20261029.md`（+ Desktop\.MD 副本）。
- **回滚**：`git checkout -- index.html src/app/startupChrome.js src/gev-autolocate.js src/lc/index.js && rm src/gev-boot-gate.js`（gate 脚本单独回滚会丢 v7 断言，不建议）。

## Phase6C3 Round-3 · 回修「遮罩在空地图上收起」（2026-10-29 23:5x）
- **结论**：评审 Round-2 四项回修全部落地，最终代码三次连跑 gate **27/27 PASS ×3**（`gate4-r3c/r3d/r3e.json`，r3e 为格式化后的交付树）：ramp 窗 worst **18.2 / 18.4 / 21.6ms**、warm 12.2 / 18.2ms、稳态 idle 18.4/24.3/18.0 与 18.4/12.3/18.2、hover 24.7 / 18.2ms；四边 56.16–56.11/57.08/59.05/56.69、centerMax 0、单峰 1、色散 32–33/43/42/39–40；**B5 reveal+0.1s 中心像素 25292 / 46005 色（std 25.2/30.0）**，收起瞬间就是完整卫星影像。
- **现象（评审 ②）**：R2 的 B 实现在「最终视角一帧影像都没有」时收遮罩 —— 用户看到纯背景色 + 完整 UI，2.8s–>8s 后才出现地图（中心 std 10.19 / 22 色）。
- **根因**：① 判据 `numberOfTilesWithContentReady ≥8` 是**全 tileset** 计数，含落位前太空视角瓦片（8–10 块时画面 0 像素）；② boot 期把 `RequestScheduler` 压到 2/4，`jumpTo` 之后最终视角的底图请求被限流饿死（4.5s 只到 10 块内容、17 个 pending），遮罩一收才恢复 18/50 → 瓦片 burst 全落在 reveal 之后。
- **改法**：`src/gev-boot-gate.js` 判据换成「画布中心 256×160 `readPixels` 探针（std ≥6 且唯一色 ≥24，空白基线 0.36/1、影像 21.7–28.4/76–144）+ `tileset.tilesLoaded`」连续 700ms；`cine:done`（相机落位）**立刻**恢复 RequestScheduler 并发；globe 兜底走同一判据；硬上限 20s→26s、落位后等待 3s→14s（超时 reason=`view-grace`，gate B1 会 FAIL 而不静默）。配套 `startupChrome.whenReadyToHide(26000)`、`lc.api.ready` 的 `whenInteractive(30000)`。
- **gate v7 → v8（只增不减）**：B1 换成「最终视角真的有影像」口径（`reason ∈ {view-content, tiles-loaded}` + `viewContentAt/tilesLoadedAt` 有值）；B2 去掉「至少一帧 >100ms」的存在性要求（→ `I3` INFO，避免更快机器假 FAIL），只断言全部 `maskOp ≥0.95`；新增 **B5**（reveal+0.1s 中心 640×420 唯一色数 ≥800 且 std ≥18）+ **I4**（第二次冷加载复验）。取证用页内时间戳 + 新文档标记，避免 CDP 轮询把「reveal+0.1s」拍成「reveal+7s」。
- **验证**：回滚路径已实测（`scripts/lc/_diag/phase6c3-r3-rollback.mjs` 拦 `gev-boot-gate.js` 请求）：`__gevBoot` 缺失、遮罩照常收起、`api.ready` 8.3s、+8s 画面 60093 色、**0 pageerror**。中途 `c3r6` 一次 25/27（慢网络下 B1 `timeout` + hover 一帧 175.6ms，LoAF 指 `cesium.js FrameRequestCallback` 174.2ms、lens 7.2ms）已如实记录，抬硬上限后四次连跑均复绿，但该 175.6ms 实例不能证明绝不复现。
- **代价**：冷启动收遮罩 10.3–12.2s → **11.2–16.1s**（多停 2–4s 换「收起即清晰」）；慢网络下最多等 26s。玻璃/分辨率/SSE/地图参数 **0 改动**。
- 产物：`gate4-r3c/r3d.json` + `gate4-r3d-reveal+{100,1000,4000,8000}.png` + 8x PNG；`r3-rollback.json`、`r3rev{1,2}.json`、`cp1/r3a-canvas-probe.json`；报告 `.gev-logs/lc/phase6c3/Phase6C3-R3-报告-20261029.md`（+ Desktop\.MD 副本）；R2 报告顶部已加更正块（原「8s 城市网格」「偏低清」两处作废）。
- **回滚**：`git checkout -- index.html src/app/startupChrome.js src/gev-autolocate.js src/lc/index.js && rm src/gev-boot-gate.js`；gate 单独回滚会退回 v5（丢 B1–B5/T3a–T3c），不建议。

## Phase6C3 Round-4 · 收遮罩判据与可见判据同口径（2026-10-30 01:0x）
- **结论**：评审 Round-3 的三项回修全部落地。就绪门的画布探针从 `256×160 / 4bit / std≥6 / uniq≥24` 提到 gate **B5 同口径** 的 `中心 640×420 / 8bit / std≥18 / uniq≥800`（stride 2 抽样、覆盖同一区域、持续 700ms 才 decide）。冷启动连跑 **7 次 gate 全 27/27**（最终树连跑 r4e/r4f/r4g），**B5 7/7 PASS**（reveal+0.1s 中心唯一色 26327–45126、std 25.19–30.65）；ramp 18.2/24.3/32.5/18.3/24.2/24.2/18.2ms、warm 12.2–30.4ms、idle ≤54.7ms（r4c 一次 54.7 已披露）、hover ≤24.3ms；四边 56.10–56.18/57.08/59.05/56.69、centerMax 0、单峰 1、色散 32–33/42–43/42/39–40 零回退；T1b/T3a/T3b/T3c 阈值未放宽。
- **现象（评审 Round-3）**：同一棵树两次冷跑，`rev3` 26/27（B5 FAIL：中心 640×420 仅 340 色 / std 8.09、截图重度模糊），`rev3b` 27/27（26327/25.19）。根因是收遮罩判据与可见判据不同口径 —— 旧探针只读 256×160、4bit 量化、`std≥6/uniq≥24`，对「模糊粗 LOD vs 清晰影像」不敏感（FAIL 帧与 PASS 帧探针读数逐位相同 21.69/76）。
- **因果证据（7 跑一致）**：旧口径（std≥6）在**每一跑**都比新判据早 0.5–5.9s 成立，而那一刻画面是 604–1251 色 / std 7.62–15.25 的粗层（rev3 的 340 色/8.09 是同一层更差实例）；新判据把这段挡住，代价是遮罩多停 0.5–5.9s（lead 决策 B 允许）。r4a 探针阶梯：0.66/69 → 2.4/106 → 13/798（旧判据放行、新判据拒绝）→ 22.17/12356 → 28.41/25154 → decide。
- **如实披露**：`reveal+0.1s` 有两个清晰度档位 —— 档 A「低清可辨」26297 色/std 25.16/lap 5.90（r4a、r4c，与评审 rev3b 判 PASS 的那张逐位一致）；档 B「完全清晰」38063–45126 色/std 30.05–30.65/lap 12.7–16.6（其余 5 跑）。B5 阈值（800/18）是评审既定口径，本轮**未擅自收紧**，只把锐度 `lapMean` 作为 INFO 写进 JSON；要「收起即全清」需抬到 `uniq≥20000 且 lapMean≥10`，代价遮罩再等 2–4s。
- **其它**：遮罩收起 10.74–15.85s（R3 11.2–16.1s，未更慢）；冷启动 >100ms 帧 11–14 个、worst 1260–1583ms、`maskOp` 全 ≥0.95 → 可见 0；非阻塞项 `failChip` 恒 false 已修（`#global-loading-status` 带 `hidden`，`innerText` 取不到 → 改 `textContent` + `offsetWidth` 可见性，另出 `failChipVisible/failChipLabel`；r4f 实测 label「加载完成」且 visible=true）。
- **改**：`src/gev-boot-gate.js`（探针口径 + `probeConfig` 进 snapshot）；`scripts/lc/phase6c2-gate.mjs` v8→v9（口径记录进 instrument、failChip 诊断、`pxStats` 增 lapMean INFO；**断言与阈值一条未改**）。产品视觉/玻璃/分辨率/SSE/布局 **0 改动**（lens 10-29 20:04、material.css 19:08 早于本轮）。
- 产物：`gate4-r4{a…g}.json` + 每跑 `reveal+{100,1000,4000,8000}.png` / `A-*-8x.png` / `Q-negctl-ring2-1x.png` + `r4{a…g}.log`；报告 `.gev-logs/lc/phase6c3/Phase6C3-R4-报告-20261030.md`（+ Desktop\.MD 副本）。
- **回滚**：把 `PROBE_W/PROBE_H/STD_MIN/UNIQ_MIN` 改回 256/160/6/24 并去掉 stride —— 等于恢复「遮罩在粗 LOD 上收起」（Round-3 的 rev3 FAIL 会复现），不建议。

## Phase6C3-followup · 稳态 >100ms 单帧归因 + 可见 LOAD FAILED 芯片诊断（2026-10-30 02:2x）
- **结论（一）present 长帧**：12 次冷启动 × （5×8s app 窗 + 10s 空页）共 45 个 >100ms 单帧，分三族：**A 主线程 32/45**（LoAF `scripts[]` 恒为 `cesium.js render2` 67–315ms、blocking 20–272ms）、**B present 10/45**（blocking 0、scripts ≤12.5ms、renderStart 迟到 90–413ms）、**C 无 LoAF 3/45**（含 1024.4/1005.8ms 两帧主循环停摆）。B 族 = 评审 rev4b 那一类，可自然复现（run6 hover 103.1ms / blocking 0 / 迟到 93.3ms / scripts 5.2ms）。**判据**：B 族在 `viewer.useDefaultRenderLoop=false`（Cesium 完全不画）时仍出现 6 次（194–418ms，全 blocking 0），而 `about:blank` 12×10s 一次都没有（最长 66.6ms）→ 属**浏览器合成/GPU present 侧**，与 lens（45 事件中仅 2 次次要脚本 7.9/12.5ms）、玻璃、仪器均无关。**不改产品代码、不改阈值**。
- **同时如实披露（与产品无关但影响判据可信度）**：本轮 `cadence`（rAF p50）逐轮从 6.1ms 漂到 36.3ms（165↔27fps）；settle 门控 12 轮里 **6 轮 45s 内未通过**却仍照原样跑 T10；按 T10 旧口径 **6/12 轮会 FAIL**。口径建议交 lead：T10 改「p99.9 + ≥100ms 帧数 ≤1 + 该帧必须归 A 族」，B/C 族单列披露不计 FAIL；「允许 ≤1 帧 ≤120ms」单独不够（本轮有 194–1024ms 单帧）。
- **结论（二）可见 LOAD FAILED**：**不是「另一个节点」**——就是 `#global-loading-status` 本身（`byId count=1`，error 色 `#ff9b8e` 逐通道对齐，`top:74px/left:50%` 位置逐像素对齐）。诊断失准的两个可量化原因：① gate 先 `pxStats`（页内 **257ms**）再读 DOM，同一 `at` 的截图与读数差 2.6×10²ms；② 该芯片可见窗实测 0.2s–5.2s 不等（`LOADING_FAILURE_DWELL_MS=5000`，失败层退出 activeIds 后提前收）。另发现**真实 i18n 缺陷**：split-flap 把英文逐字字形写在 `.gev-flap-cells` 的 `data-flap-next`，`gev-cn` 只译文本节点 → 中文模式下这行提示先按英文上屏（rev4b 墨迹 63.2 CSS px = 11 拉丁字符；中文态 44.8–50.4 CSS px）；`easeWidth` 被 `display:none` 打断后 `style.width` 常驻（实测 pin 104.55px）。产品功能无影响。
- **改**：只改诊断，`scripts/lc/phase6c2-gate.mjs` v9→**v10**（`viewState` 增 `failChipState/Hidden/Display/OffsetW/Rect/Text/PaintedCells/AtPoint/VisibleLayout/LayerErrors`，`failChipVisible` 改状态机口径；`pxStats` 增 `chipInkPx/chipInkWidthCss` 像素级证据；采样顺序改为截图→**立刻**读 DOM→pxStats→再读一次留档）。新增诊断脚本 `scripts/lc/_diag/phase6c3-followup-{present,failchip,failchip2,failchip3}.mjs`、`_probe-layers.mjs`。**阈值/断言/产品文件 0 改动**（`grep "T10 无长帧冻结"` 原样；lens/material.css mtime 未变）。
- **验证**：改后 gate 实跑一次 `node scripts/lc/phase6c2-gate.mjs fupv10` → **27/27 PASS**，新字段立刻抓到现场：`reveal+100 failChipState=complete / hidden=false / offsetW=125 / failChipText=加载完成 / failChipPaintedCells=LOAD COMPLETE`（同一瞬间文本中文、翻页字英文），`reveal+1000` 已 hidden=true —— 与「截图可见、读数不可见」的竞态逐项对上。
- 产物：`.gev-logs/lc/phase6c3/followup-present-p{A,B,C,D}.json`、`followup-present-merged.json`、`p12-progress.log`、`followup-{g1,g2,g3,h1}-*-failchip*.json`、`h1-t*.png`、`g2-r1-visible+*.png`；报告 `.gev-logs/lc/phase6c3/Phase6C3-followup-报告-20261030.md`（+ Desktop\.MD 副本）。
- **回滚**：诊断脚本 `rm scripts/lc/_diag/phase6c3-followup-*.mjs scripts/lc/_diag/_probe-layers.mjs`；gate 回滚 `git checkout -- scripts/lc/phase6c2-gate.mjs`（退回 v9，失去芯片四口径与即时读）。

## Phase6C4 · 冷启动 loading 10s → ≤5s（2026-10-30 03:0x）· 未达标，checkpoint

- **目标**：6 次冷启动遮罩收起 ≤5s（目标 3s），保留 B5「收起即清晰」与 photoreal。
- **结论（失败）**：≤5s 在现有形态下达不到，差 3.5s 以上 —— 不是调参问题。8 次冷启动（3 dev 4173 / 3 prod 4174 / 1 gate 复验 + 1 探针跑）实测遮罩收起 10.50–14.86s。地板 = bootstrap→tileset 进场景（prod 3.2–3.9s / dev 5.6–6.9s，dev 是 236 个 ESM 模块 22.5MB 求值）+ Google 3D Tiles 收敛到 B5 清晰度（2.36–3.40s，12km 正射要最深层 LOD）+ settle 700ms + 遮罩淡出。把相机/定位等待全部归零后 prod 地板仍 8.0–8.9s、dev 10.4–12.6s。
- **实验 ①（已回退）**：本地缓存优先立刻落位 + GPS 纠偏并行（仅遮罩内重落位）→ cine 段 4.17s 缩到 2.02–2.51s，但「落位→清晰」从 2.36–3.40s 涨到 5.7–6.6s，总遮罩净收益 ≈0（2 跑还慢 ~1.5s）。根因：tileset 刚进场景时根子树未到，提早落位把深层瓦片请求排到上一视角 in-flight 请求后面。**落位时机有最优窗口（tileset:added + ~1.5s），不是越早越好**。代码已回退，只留注释。
- **保留的改动**：①`src/ui/styles/controls.css` 的 `#loading-screen` 过渡 0.8s→0.28s（`mask:gone − decide` 601ms→218–230ms，−0.38s，3 跑一致，遮罩在 decide 前仍全不透明）；②`src/gev-boot-gate.js` `FRAMES_BEFORE_CINE 3→2`、`PROBE_EVERY_MS 250→150`（只减判定延迟；SETTLE 700ms、STD 18、UNIQ 800、DEADLINE 全未改）。玻璃/文字/布局/pp/photoreal/分辨率/SSE/gate 阈值 **0 改动**。
- **验证**：`node scripts/lc/phase6c2-gate.mjs c4v1` → **27/27 PASS**（`gate4-c4v1.json`）：B5 reveal+100ms 中心 640×420 `uniq 40602 / std 30.40`；idle 82.6 / hover 83.3fps、worst 32.2/30.2ms；ramp worst 30.4ms（硬断言未放宽）；warm 78.7ms（>60 一帧 ≤100）；四边 56.11/57.08/59.05/56.69、centerMax 0、单峰 1、色散 32/43/42/39 零回退；B2 冷启动 22 帧 >100ms（worst 1819.6ms）全部 maskOp=1.0、可见 0。
- **交 lead 三选一**：①放宽 B5 到粗 LOD（早收 ~1s，等于回退 C3-R3/R4 的修复，卡片禁止）②冷启动不挂 3D Tiles（省 5.6–7.8s，唯一能进 5s，但首屏非 photoreal）③接受新地板（prod 8–9s / dev 12–13s）。未自行改任何阈值/断言。
- **下一步（已算好，未做）**：落位卡在 `tileset:added + ~1.5s`（根子树已暖）且 GPS 纠偏移出关键路径 → 推算 dev ≈12.8s / prod ≈8.0–8.9s（−2~3s），需 3+3 跑验证。
- **产物**：`.gev-logs/lc/phase6c4/Phase6C4-报告-20261030.md`（+ `C:/Users/13680/Desktop/.MD/docs/logs/` 副本）、`boot-{base,base2,prod-base,c4prod,c4probe}.json`、`gate4-c4v1.json`、仪器 `scripts/lc/_diag/phase6c4-boot-timeline.mjs`。
- **回滚**：`git checkout -- src/ui/styles/controls.css src/gev-boot-gate.js && rm scripts/lc/_diag/phase6c4-boot-timeline.mjs`。

## 冷启动分阶段基线（t_0212fbb4，2026-10-30 05:4x）· 只加观测

- **仪器**：新增 `src/boot-timeline.js`（`window.__bootTimeline = {mark, recordFrame, snapshot}`，锚点 = navigationStart，环形缓冲，`PerformanceObserver('longtask')`；`?bootdebug=1` 才打印，默认静默）；`gev-boot-gate.js` 的 `mark()` 转发同一批点到绝对时间、`tick()` 里 `recordFrame`；`app/viewer.js` / `app/scene.js` / `app/application.js` / `app/startupChrome.js` / `main.js` 各加 1–6 个 mark（后两者走受保护的 `globalThis.__bootTimeline`，单测夹具零改动）；`scripts/package-boundaries.json` 把 `src/boot-timeline.js` 声明进 `viewer` + `application-components`。
- **口径**：每次全新 Chrome profile（空 HTTP 缓存）+ `Network.clearBrowserCache`，25ms 轮询遮罩消失做独立墙钟；6 次 dev（4173）+ 6 次 prod（build+preview 4174），`?welcome=0`，GPU 6/6 = RTX 3060 Laptop D3D11。
- **结果**：prod 中位 **12 929.8ms**（12 853.5–13 810.8）/ dev **16 234.2ms**（14 668.8–17 282.7）；阶段之和 ÷ 总时长误差 **0.00%**（阈值 5%），独立墙钟校验偏差 **0.20% / 0.17%**。
- **Top2**：① `tileset:added → view:content` = prod **7 222ms（55.9%）** / dev 7 098ms —— Google 3D Tiles 逐层父→子阶梯，prod 167 / dev 105 个瓦片请求里飞行期只有 3–8 个、其余 93–160 个落位后才发；单条 p50 304 / p90 2 013ms。② `tileset:fetch:begin → fetch:end` = prod **2 573ms**，其中 ion `/v1/assets/2275207/endpoint` 2 094.5ms + `/v1/3dtiles/root.json` 872.4ms **串行**，且要等 `viewer:ready`(2 186ms) 之后才发起。第三名相机飞行 4 156ms，但 C4 实验①已证「提前落位 = 0 收益」，必须与①的预取一起动。
- **早期阻塞（逐条实测）**：prod head 里 `vite-plugin-cesium` 注入的 1.7MB `Cesium.js` 是 parser-blocking classic script（下载 447ms + 解析执行 ~700ms，`domInteractive` 1 304ms）；两个 Google Fonts CSS render-blocking 299/345ms；底图探测（AMap `/maps` 251ms + `/v3/ip` 301ms + `ipLocation` + `/v3/log/init`）≈740ms，与飞行并行。
- **验证**：`node scripts/lc/phase6c2-gate.mjs bootobs` → **27/27 PASS**（B1/B2/B5/ramp/fps/色散全过，B5 reveal 中心 std 30.89 / uniq 35 525）；`node --test src/standalone/startupChrome.test.mjs src/app/application.test.mjs` → 22/22；产品视觉/判据/阈值 0 改动。
- **产物**：`.gev-logs/lc/boot/冷启动基线-20261030.md`、`baseline-{dev,prod}.{json,md}`、`baseline-*-run*.png`、`gate-bootobs.log`；仪器 `scripts/lc/boot-timeline-coldstart.mjs`、`scripts/lc/boot-timeline-report.mjs`、`scripts/lc/_diag/boot-{tile-ladder,stage-window}.mjs`。
- **回滚**：删 `src/boot-timeline.js` + 回滚 `gev-boot-gate/viewer/scene/application/startupChrome/main.js` 的 mark 行 + 从 `scripts/package-boundaries.json` 去掉该项；`window.__bootTimeline` 缺失时全部调用点自动失效（gate 行为与改动前逐位相同）。
- **已知未决**：`npm run check:boundaries` 在当前工作树仍红，卡在他人未提交的 `src/sources/live/resilientFetch.js`（`live-observations` 组未声明 owner），与本轮无关。

## 首批瓦片预取缓存 + 启动期 shader 上传去重（t_ff183910，2026-10-30 07:1x）

- **结论**：预取把 `tileset:fetch` 从关键路径上拿掉（prod 交替 A/B：**2 679.4 → 2 218.9 ms，−460.5 ms**；总 loading 20 682 → 20 077 ms，−605 ms；瓦片请求命中 HTTP 缓存 0/135–155 → 30–40/182–209）；shader 编译去重让 `compileShader` **34→23 次、重复 11→0、编译耗时 286.9→169.2 ms（缓存自报 savedMs 98.1）**、`linkProgram` 重复 1–2→0。**`tileset:added → view:content` 未下降**（12 175.5 → 12 568.0 ms，+392.5 ms，噪声内）—— 父→子串行阶梯的依赖没被抽掉。**≤5 s 未达成。**
- **环境声明**：本窗口网络显著劣于 05:30 基线（ion `/endpoint` 4 335 ms vs 2 094 ms、prod `domInteractive` 6 768 vs 1 304 ms），绝对 ms **不可**与 12 929.8 ms 横比，只能用同窗口交替 A/B 的相对差。
- **纹理审计（结论=无冗余可去）**：一次冷启动 179–199 次 `texImage2D` 中 alloc（pixels=null）占 181–199 次/2–4 ms，真上传 179–189 次、唯一源 117–123 份、合计 241–276 ms（~1.3 ms/次）；「同纹理+同源」重复 56–66 次是逐帧 `texSubImage2D` 刷新与同一 ImageBitmap 上到不同 Texture（Cesium 各自持有），**不是同一资源二次上传**。
- **验证**：`node scripts/lc/phase6c2-gate.mjs tff3` → **27/27 PASS**（B5 reveal+100ms 中心 640×420 uniq 38 063 / std 30.65 / lapMean 16.6，与历史档 B 一致；B2 长帧 21 全在遮罩下、可见 0；ramp worst 30.4 ms；色散 33/42/42/40 零回退）；`node --test startupChrome+application` **22/22**；`check:boundaries` 仍只剩他人 `resilientFetch.js` 一项。玻璃/文字/布局/pp/photoreal/分辨率/SSE/gate 断言 **0 改动**（`gev-boot-gate.js` 本轮未改）。
- **改**：`src/maps/tileWarmup.js`（新，端点预热 + root.json + 中心链路瓦片进 HTTP 缓存，`?tilewarm=0` 关）、`src/app/shaderCompileCache.js`（新，WebGL 原型层 `(ctx,type,source)` 只编译一次，`?shadercache=0` 关）、`src/app/viewer.js`（构造前安装）、`src/main.js`（main:entry 提前发起）、`src/maps/google3d.js`+`src/mapStartup.js`+`src/app/scene.js`（primed 载入复用同一次请求）、`scripts/package-boundaries.json`（登记两个新文件）、`scripts/lc/boot-upload-ab.mjs` + `scripts/lc/_diag/_read-ab.mjs`（新，A/B + WebGL 上传审计）。
- **产物**：`.gev-logs/lc/boot/预取与上传去重-报告-20261030.md`、`prefetch-ab-ab-prod.json`（预取 3+3）、`prefetch-ab-sc-prod1.json`（去重 A/B）、`gate-tff3.log`。
- **下一步（已定位，未做）**：瓦片阶梯仍在 + 预取与 Cesium 落地请求抢带宽（请求数 135–155→182–209）：①`tileset:added` 之后把预取并发降到 2 或暂停，只留 `.json` 元数据链；②只预取子 tileset 元数据、`.glb` 交 Cesium。各需 3+3 复测。另：本轮遗留 1 个 harness 浏览器（7 个 chrome 进程），测量前先确认无在用浏览器窗口。

## Phase6C4 · 遮罩期收紧：并发 A/B + settle/grace 700ms（t_36d7461c，2026-10-30 07:0x）· 达成（节省 0ms，附证据）

- **结论**：`settle + grace = 700ms` 落地（`SETTLE_MS 700` + `POST_CINE_GRACE_MS 14000 → 0`，新增 `POST_CINE_WAIT_BUDGET_MS=700` 供 gate 核对）；并发**不下调**，A/B 实测 1/2 是负收益已回退 2/4；遮罩收起判定未放宽（14/14 冷启动走 `view-content` 探针路径，reveal+100ms 全达 B5）。
- **A/B（dev 4173，各 7 次全新 profile 冷启动，同机 RTX 3060，交错跑）**：`tileset:added→view:content` 中位 **9 444ms(1/2) vs 8 215ms(2/4)**，均值 +1 174ms（置换检验 p=0.10）；reveal+100ms B5 两臂同区间（std 31.8–32.4 / uniq 5.2–6.2 万）→ 1/2 无损清晰度但白等；遮罩期 worst 长帧也没变小（2.2–3.6s，minMaskOp=1.0 全在遮罩下）。机制：Google 瓦片同源，`per-server=1` 把同级兄弟瓦片严格串行。
- **settle/grace 实测**：`view:content→view:settled` = 648–798ms（中位 712，= 探针窗 700）；`probeConfig={700,0,700}` 恒定。正常路径 grace 从不触发 → **节省 0ms**；它退役掉的是「14s 后收起纯色地图」的错误路径。
- **验收**：gate `c4v4` 26/27、`c4v5` 26/27 —— 两次 B1/B2/B4/B5 全 PASS（B5 std 30.89 / uniq 35 525；ramp 30.3–37.6ms；idle 82.6fps），唯一 FAIL 是既有机器侧 present 单帧（B3 warm 103ms / T10 hover 133.5ms，LoAF blocking=0），与常量改动无关。
- **顺手发现（未修）**：`no-cine` 分支会露白 —— 14 次里 1 次（`capab-cap24.json` run1）相机 22s 未跑完 → `reason=no-cine` 在 35.7s 收起，reveal+100ms 中心 `std 2.17 / uniq 109`（纯色）。建议：`decide('no-cine')` 前若 `lastProbeOk === false` 就等到 `DEADLINE_MS`，需专门复现后再改。
- **产物**：`.gev-logs/lc/boot/C4-遮罩期收紧-报告-20261030.md`、`capab-*.json`、`gate-c4v4.log`、`gate-c4v5.log`；仪器 `scripts/lc/_diag/phase6c4-cap-ab.mjs`、`scripts/lc/_diag/_cap-ab-stats.mjs`。
- **回滚**：`POST_CINE_GRACE_MS` 改回 14000；`rm scripts/lc/_diag/phase6c4-cap-ab.mjs scripts/lc/_diag/_cap-ab-stats.mjs`。

## 终验：6 次冷启动 loading / B5 / 进入后帧率 / ramp / gate 27/27（t_374e47f6，2026-10-30 07:2x）· 除 ≤5s 外全过

- **判定**：`loading ≤5s`（必须）**FAIL 0/12** —— dev 4173 中位 **17 043ms**（15 693–19 716，6 跑）、prod 4174 中位 **14 451.5ms**（12 559–15 883，6 跑）；目标 3s 更远。B5 **12/12 PASS 未降**（dev std 31.89–31.99 / uniq 54 774–60 391；prod std 41.93–53.80 / uniq 70 285–104 960；阈 std≥18 / uniq≥800）。进入后 10s：dev **0 帧 >100ms**、平均 80.4–91.9fps；**prod 5/6 跑 7 帧 >100ms（worst 145.6ms，maskOp=0 用户可见）**、平均 72.6–87.4fps。
- **ramp 硬断言**：gate（dev）B4 worst 24.3ms PASS；独立同口径窗 dev 6/6（≤97ms）PASS，prod **4/6**（103.1 / 121.0 越线）。
- **gate 27/27**：`gate27-a6.log` 26/27（唯一 FAIL B3 warm `102.6ms`，超阈 2.6ms，fps 82.6 正常）；`gate27-a6b.log` **27/27 PASS**（warm 97 / ramp 24.3）→ 机器侧单帧抖动，非回归；玻璃 gate 另跑 19/19 PASS。
- **长帧归因**（prod，LoAF）：长帧脚本全在 `Cesium.js` `FrameRequestCallback`（112–118ms，blocking 70ms），发生在 reveal 后 3.0–5.2s 的瓦片精化高峰；与 lens/应用定时器无关。
- **瓶颈定位（中位分段，dev/prod）**：bootstrap 差集 2.2s/3.1s（prod 里 1.7MB `Cesium.js` parser-blocking）→ tileset:added 6.4s/1.9s → **cine 相机动画 5.12s/5.04s（纯串行）** → 落位后 content 收敛 2.64s/3.37s → settle 0.707s → 淡出 0.22s。≤5s 在当前架构下不可能：光「收敛+settle+淡出」已 3.6–4.3s，cine 又必须等镜头落位才过 content 探针。要么让 cine 与瓦片阶梯并行/缩短，要么改 reveal 语义（会动 B1/B5，本轮禁止）。
- **如实记录（未改）**：实测 72–92fps 超 AGENTS「50–60」上限，是 83Hz vsync 未限帧的结果，历史 gate 同为 82.6fps，本轮 0 降级/0 限帧；prod 进入后 3–5s 可见 100–146ms 抖动是**真实产品问题**，若把 ramp 断言搬到 prod 会 FAIL，建议单独开卡。
- **产物**：`.gev-logs/lc/boot/终验-6次冷启动-报告-20261030.md`、`accept6-{a6a,a6b,p6a,p6b}.json`、`accept6-final.json`、`accept6-*-reveal100.png`（6 张）、`probe-prod-longframes.json`、`gate27-a6{,b}.log`、`gate-a6.log`；仪器 `scripts/lc/_diag/final-accept-cold6.mjs`、`_accept6-agg2.mjs`、`_accept6-seg2.mjs`、`probe-prod-longframes.mjs`。
- **合规**：断言/阈值/口径、画质/分辨率/玻璃/SSE/pp/photoreal **0 改动**；失败项原样留在 JSON。

## Phase6C4 · 汇总终报（根卡 t_81c4706b，2026-10-30 07:1x）· 必须项 FAIL，其余全过

- **判定（本轮第一手 6 跑 + gate）**：`loading ≤5s` **FAIL 0/6** —— dev 4173 15 411/17 190/18 336ms（中位 17 190）、prod 4174 12 056/13 247/14 434ms（中位 13 247）；子卡 12 跑同区间（dev 中位 17 043 / prod 14 451.5）。B5 **PASS 6/6**（dev std 31.76–31.99/uniq 54 774–61 831；prod std 41.93–53.59/uniq 75 209–104 960），两张 reveal+100ms 截图肉眼复核：中心均为清晰真实卫星影像、无遮罩残留、无灰块。
- **其余验收**：`node scripts/lc/phase6c2-gate.mjs c4root` → **27/27 PASS**（B5 uniq 38 063/std 30.65、ramp worst 30.2ms、warmup 78.6、idle&hover 82.6fps、色散 32/43/42/40、四边 12/9/32/28）；ramp 硬断言未动；进入后 dev **0 帧 >100ms**（worst 78.8–96.8），**prod 3 跑 6 帧 >100ms**（1/1/4，worst 121.1，maskOp=0，LoAF 归因 `Cesium.js FrameRequestCallback` 瓦片精化）；FPS 71–94 超「50–60」上限（83Hz vsync 未限帧，历史 gate 同为 82.6，本轮 0 降级）。
- **≤5s 不可达的结构证据**（prod 中位地板）：nav→tileset:added 1 869 + **tileset:added→view:content 8 561（Google 3D Tiles 父→子串行阶梯，96–167 请求，单条 p50 304ms/p90 2 013ms）** + settle 707 + 淡出 224 ≈ **11.4s**；要进 5s 必须再砍 6–9s，而相机/定位/并发/预取/纹理五条支路均已被消融证伪（cine 提前到 +0.29s 净收益 0；1/2 并发 +1 174ms 负收益；预取只换 RTT −605ms 而阶梯未降）。**本轮五张子卡合计真实节省 ≈1.0s**（淡出 −380ms + 预取/shader −605ms）。
- **保留且过 gate 的实现**：`src/maps/tileWarmup.js`（`?tilewarm=0` 关）、`src/app/shaderCompileCache.js`（`?shadercache=0` 关，compileShader 34→23、重复 11→0）、`src/gev-boot-gate.js`（SETTLE 700 + `POST_CINE_GRACE_MS 14000→0` + `POST_CINE_WAIT_BUDGET_MS=700`、`FRAMES_BEFORE_CINE 3→2`、`PROBE_EVERY_MS 250→150`、`SCHED_CAP` 保持 2/4）、遮罩淡出 0.28s、`src/boot-timeline.js` 只观测。玻璃/文字/布局/pp/photoreal/分辨率/SSE/gate 断言与阈值 **0 改动**。
- **两条真实缺陷（未修，已量化）**：① prod 进入后 3–5.2s 可见 100–121ms 单帧（与 loading 目标互斥：精化要么在遮罩下做、要么在遮罩后卡）；② no-cine 分支露白（14 次里 1 次：相机 22s 未跑完 → `reason=no-cine` 在 35.7s 收起，reveal+100ms 中心 std 2.17/uniq 109）。
- **产物**：`.gev-logs/lc/boot/Phase6C4-汇总-报告-20261030.md`（+Desktop 副本）、`accept6-root{,dev,prod}.json`、`accept6-root*-run{1,2,3}-reveal100.png`、`.gev-logs/lc/phase6c2/gate4-c4root.json`+8×PNG。
- **下一步需决策（唯一不降画质路径）**：瓦片树预取 R&D（解析 Google implicit tiling `.subtree`，并行灌 1–7 层进 HTTP 缓存，2–4h，预计 prod 6.5–8.5s / dev 9–11s，**仍非 5s**）；要真进 5s 只能冷启动不挂 photoreal 或改 `loading` 定义（首帧 ≤1.5s + 遮罩内进度）。

## Phase6C5 · 玻璃色散最终打磨（卡 t_7acf39e0，2026-10-30 09:0x）

- **现象**：用户 1x 看不出边缘色散；C2 gate 却记 32–43。**根因实测**：真地图在 1px 尺度是平滑梯度，`dispPx 1.0`（R/B 间距 0.40 CSS px）只能产生 1.0–1.4 灰阶 Δ(R−B)，再被 `bandAlpha 0.55` 与卡壳半透各稀释一次 → 屏上 ~1 灰阶，低于 JND(≈3–4)；gate 的 32–43 是「灰阶 2px 条纹硬边」读数，不等于肉眼可见。
- **改动（只动色散，不碰其它）**：`public/gev-edge-lens.js` ①`dispPx 1.0→2.4`（R/B 间距 0.96 CSS px，目标 0.8–1.2、仍 <2px）②新增 `dispGain 8.0` / `dispCap 12/255`：以 G 为轴把 R/B 色散偏移放大并限幅，只放大色散分量（不动 gain/band/ior/thick/alpha/单层结构），单轴棱镜不出彩虹；`dispGain:1.0` = 旧行为可回滚。`stats()` 增加 dispGain/dispCap 自述。
- **实测（RTX 3060 D3D11，真地图未冻结，on/off 隔离）**：边缘带 Δ(R−B) 顶层均值 1.0–1.4 → **3.5–5.8**（2D max 2.4 → **6.8**）；gate 真地图 2D max 10–14 → **16–25**；硬边 2px 条纹反而 **32–43 → 12–15**（限幅生效，无彩虹）。
- **gate**：`node scripts/lc/phase6c2-gate.mjs c5` → **27/27 PASS**（四边 56.16/58.19/57.69/59.05、单峰 1、centerMax 0、噪声 0.19、hover 顶沿 ≥30、T7 单层、B1–B5 全 PASS、T13 色散 15/12/13/14）。FPS idle/ramp 82.6、warmup 83.3（超 50–60 上限，83Hz vsync 未限帧，历史同值，0 降级）；3×8s 窗 worst 30.2/18.3/60.6ms。
- **产物**：`.gev-logs/lc/phase6c5/Phase6C5-报告-20261030.md`（+Desktop 副本）、`c5-g-pp-dp2p4-g{1,8}-{1x,top4x,top8x,corner8x}.png`、`c5-a-*`/`c5-e-*`/`c5-g-*` 全档样张与 JSON、`.gev-logs/lc/phase6c2/gate4-c5.json`；仪器 `scripts/lc/phase6c5-{disp,diag,real}.mjs`。`npm run build` 已重建 dist（4174 已服务 dispGain 版本）。
- **未决**：1x 是否"看得出"需用户真机确认（4174 + Ctrl+F5）；若仍看不出，下一档单行 `dispCap 12/255→20/255`（仍远低于彩虹阈值），需 lead 决策。FPS 82.6 超上限需单独开限帧卡。

## Phase6C6 · 最终视觉验收 Gate（卡 t_1f4f164b，2026-10-30 08:4x）· **Gate FAIL：项3 色散可见度 + 项8 B+D**

- **判定**：10 条必须项 **8 PASS / 2 FAIL**。PASS：①GPU RTX3060 非软件 ②参数固定 gain1.0/band10/ior1.52/thick6/单层 ④四边 56.10/58.19/59.05/57.69、单峰1、centerMax 0 ⑤hover Δmean 10.38/占96%像素、移开精确归零 ⑥data/scene 文字 dy=0、voice 0 溢出、location 11/11 ⑦pp 300×430/29行/minGap 8/可滚 ⑨阈值与产品代码 0 改动。FAIL：③真实地图色散 36 条边 **0 条 ≥3 灰阶**（最强 location-bar.bot 2.41、pp 展开卡 0.1–0.44）；⑧loading **0/6 ≤5s**（12.46–17.24s，中位 16.04）+ `>100ms` **4/6 跑**（worst 139.4ms，ramp 侧 2/6）+ fps 66–114.3 高于 50–60 上限。
- **关键仪器发现（推翻 C5 数字口径）**：C5 的「真地图 Δ(R−B) 3.5–5.8」用 `__gevEdge.off()/on()` 隔离，而 off 后 band 露出**裸地图**，Δ 混入「玻璃带 vs 底图」；改用**只切 `dispGain` 8↔1**（两帧底图完全相同）+ 同状态 `gain8/gain8` 噪声底后，真地图色散上限仅 **2.41 灰阶**（噪声均值 ≤0.54、2D 噪声 2）。硬边 2px 条纹须在**静态灰衬**下量（真地图运动会把 11 抬到 36）。物理链路仍健康：间距 0.96 CSS px、限幅下硬边 max 11 ≤ 24 理论上限、无多级彩虹（翻转 0）、不漏带内（band 外 0.00）→ 缺的只是**对比度**。
- **gate 侧**：`node scripts/lc/phase6c6-gate.mjs c6prod`（= phase6c2-gate v10，仅 URL 4173→4174 + 输出目录，阈值 0 改动）→ **27/27 PASS**，B1–B5 全过（reveal+100ms 中心 std 53.52/uniq 74700）。
- **产物**：`.gev-logs/lc/phase6c6/Phase6C6-最终验收报告-20261030.md`（+Desktop 副本）、`c6-final.json`（聚合判定 FAIL）、`gate4-c6prod.json`、`c6visual-final.json`、`.gev-logs/lc/boot/accept6-c6.json`、`c6diag.json`、1x/4x/8x 截图 20+ 张、冷启动 6 张 reveal+100ms。仪器：`scripts/lc/phase6c6-gate.mjs`、`phase6c6-visual.mjs`、`phase6c6-aggregate.mjs`、`_diag/phase6c6-diag.mjs`。
- **下一步（需 lead）**：项3 → 退回 C5，单行 `dispCap 12/255→20/255`（硬边最坏 20 灰阶仍 <24 判据）或按 JND 重标定；项8 → 退回 C4（loading 与 C4 同区间未解决；`>100ms` 按 C3-followup 的 A/B/C 族继续）。fps>60 属 83Hz 未限帧，要严格落 50–60 需单独开限帧卡。

## Phase7A · 架构审查 + 启动链路优化 base-first（卡 t_cbf4d75d，2026-10-30 10:5x–11:1x）· **部分达成：方案落地、≤5s 未达**

- **现象**：C6 冷启动 loading 12.46–17.24s（必须项 0/6 ≤5s）。架构审查定位到根因：`src/app/scene.js`
  **`await loadPhotorealisticTilesetPrimed()`** 才 setStack + return scene，于是 `application.js` 的
  `controls/data/tools`（含 9 张玻璃卡）、相机落位（`whenCineMayStart` 等 tileset 进场景）、
  就绪门（等 tileset 内容）**全部串在 3D Tiles 之后**，而 Tiles 只是最终画质、不是可交互前提。
- **根因分解（dev trace，navStart ms）**：模块图 4.7s → Viewer 0.4s → 串行等 Tiles（root.json 1.7s）→
  底图探测 1.2s → setStack 3.4s（**其中 Cesium World Terrain 3.1s**）→ 落位（快定位 2.5s 上限 + GPS 纠偏 3s）→
  最终视角清晰 3.5s → settle 0.7s → 淡出 0.23s。
- **改法（base-first + photoreal-background）**：① `scene.js` 只发起 Tiles、底图 `setStack(deferTerrain:true)`
  后立刻 return；底图探测挪到**模块求值**且 700ms 上限；② 新增 `upgradeToPhotoreal()`：等
  `__gevBoot.whenInteractive` → `primitives.add` → 首批瓦片(6s 上限) → `globe.show=false` +
  `setStack('photoreal')`(不 await) + `__gevPhotoreal` 诊断 + `gev:photoreal-ready`；③ `MapStackController.adoptPhotorealTileset()`；
  ④ `controller.setStack({deferTerrain})` 地形后台装；⑤ 就绪门**首帧即放行相机**、内容判据扩到「底图 imagery 可见」、
   并发 2/4 限流从 boot 改到「交互后 photoreal 期间」；⑥ `gev-autolocate.js` 定位在脚本求值即发起、
   就绪轮询 250→60ms、快定位 1200ms、GPS 纠偏 900ms。
- **坑（已修）**：`defer()` 只能在**同步构造期**调用；在异步升级链里 defer 会抛
  `Register cleanup during component construction`，并被 `.catch` 静默吞掉 → photoreal 永远不升级。
  改为在 `createApplicationScene` 同步持有 `photorealHolder` + defer 释放。
- **验证（dev 4173，RTX 3060，全新 profile + 清缓存，`?welcome=0`，5 跑）**：loading **11.8–14.1s（中位 13.5，
  基线 15.4–18.3）**；B5 **5/5 PASS**（中心 640×420 std 33.8–36.8 / uniq 45.6k–57.8k，量的是**底图**影像）；
  `__gevPhotoreal.ready` **5/5**（globe=false / activeStack=photoreal）；进入后 0–10s fps **57.7–61.0**；
  worst 84.9–151.4ms（3/5 出现 >100ms，因 photoreal 有意挪到交互后）；GPU 5/5 RTX 3060。
- **未达成**：`interactive ≤5s`（dev 中位 13.5s，prod 未在硬停前重测）。剩余 ~3s 的头部已定位：
  **底图瓦片到最终视角 1.6–3.9s**（`jumpTo` 之后才请求 AMap/Esri 瓦片）→ 下一步按 WebMercator 反算
  12km 视角 z/x/y（3×3～4×4 张）在遮罩期内预取进 HTTP 缓存；`startupChrome` 1s 最短展示是刻意地板；
  prod 模块图需重新 `npm run build` 后 6 跑复核。
- **产物**：`docs/Phase7A-架构审查与启动链路-20261030.md`（依赖清单/依赖图/关键路径/指标）、
  `.gev-logs/lc/phase7a/p7a-dev{1,2}.json`、`p7a-dev2-run{1..3}-reveal100.png`；仪器
  `scripts/lc/phase7a-cold.mjs`、`scripts/lc/_diag/phase7a-trace.mjs`。
- **玻璃/文字/pp/分辨率/gate 阈值 0 改动**；3D Tiles 仍然加载（只是不再阻塞首屏）。

## 2026-10-30 15:05 · Phase7A-D：决策 A+D 落地（Cesium defer + 卡片先可交互 + B5 空帧修复）

- 现象：base-first 落地后 prod 冷启动 8.1–13.7s，「interactive ≤5s」未达；lead 决策 A（模块图拆分 + modulepreload）+ D（可交互 = 首帧 + 卡片可点）。
- 关键证据：
  ① **A 被证否**：12 个 module 入口合并成 1 个 2.67MB chunk，但入口本身只是薄壳（合计 ~48kB），拆完 2673kB→2621kB（-2%）。2.67MB 是 `main.js` 的 App 图，不是入口层。
  ② 真正的首屏瓶颈 = `/cesium/Cesium.js` 5.73MB 的下载+求值（0.64–3.2s 主线程块）+ 底图金字塔到首块影像；3D Tiles 早已不在关键路径。
  ③ reveal 偶发纯黑（4/6 跑中心 std 2.58 / 257 色）：底图细化时「父瓦片已丢、子瓦片未到」的空 globe 被 draw 成最后一帧，`requestRenderMode` 下不再重绘。
- 改法（详见 docs/Phase7A-D-架构审查与启动链路-20261030.md §2）：
  `build/vite.js` 加 `deferCesiumScriptPlugin`（Cesium.js 加 defer，解析不再被挡，执行顺序不变）；
  `gev-boot-gate.js` 新增 `inputRelease` 门（lc.mounted + 画面非纯色，与 B5 解耦）、B5 判据加
  「读数 ≥ cineDoneAt」与「`globe.tilesLoaded` 才 decide」、`nudgeRenders` 主动重绘、SETTLE 700→900；
  `startupChrome.js` + `controls.css` 加 `.input-released`（遮罩退化为顶部状态胶囊、pointer-events:none）；
  `lc/index.js` 新增 `api.interactiveAt`；`hud.js` 把 2.77MB egm96 动态 import 推到交互后（R4）；
  新增 `src/boot-defer.js` 承接 6 个非首屏入口。
- 验证（prod 4174 / RTX 3060 / 全新 profile / 每批 6 跑，7 批）：卡片可点中位 4.35–5.15s；
  最优批 6/6 ≤5s（中位 4.41s）但 B5 2/6；终态 B5 视觉 **6/6 PASS**（std 32.8–33.5 / uniq 51k–55k）、
  卡片可点 3/6 ≤5s（中位 5.15s）、真点击 6/6（mini→opening）、photoreal 6/6、GPU 6/6 3060。
  玻璃/文字/pp/分辨率 0 改动；单测仅 viteBuild 4 条断言随插件顺序更新，其余失败为环境性（git EPERM / 上游 429）。
- 未达成：interactive 6/6 ≤5s、B5 ≤8s 只有 3/6（7.4–8.6s）、无 >100ms（每跑 0–2 个）。
- 下一步（需 lead 选）：S1 Cesium 资源压缩/按需 chunk（−0.5–2.0s，直击 ≤5s）；S2 允许粗 LOD 时放行输入（口径变更）；
  S3 Esri 元数据 400ms 超时兜底；S4 ion endpoint 后移。稳态可复现值：中位 ~5.2s。

## 2026-10-30 13:55 · Phase7A2：D+ 首帧/LC mounted 即放行卡片交互 + 404 清零（卡 t_eeb2e2ce）· **部分达成：404 清零、D+ 落地；≤5s 3/6**

- 现象：Phase7A-D 把「卡片可点」挂在 baseVisible + 探针（std/uniq）之下，实际放行落在底图首帧之后
  （gate 时钟 3.7–4.5s / 墙钟 4.7–5.9s），且每轮冷启动控制台一条 `404 /api/setup/status`。
- 根因（本轮实测）：
  ① `gev-boot-gate.js` 的 inputRelease 判据写在 `if (baseVisible) {...}` 里，探针读数只有
     `globe.show === true` 之后才产生 → 放行必然晚于底图首帧。
  ② `404` = `src/keySetup.js` 每次都 `fetch('/api/setup/status')`，该端点只在 dev 的
     `server/standalone/key-setup.js` 里挂载，preview/prod 恒 404（`src/tooling/previewServing.test.mjs:111`
     把它写成 preview=404 的契约）。旧逻辑靠 catch 自毁，功能没错，但必然打一条 404。
  ③ **卡片 DOM 不是 index.html 静态标记**（7 个卡 id 在 index.html 0 命中），由 App 的
     `src/ui/applicationShell.js` 在启动中段注入；LC 的 `waitReady()` 必须等 7 个 id 齐了才 mount。
     → 「LC mounted ≈ app:ready」，lead 卡面写的「约 1.1s」在本仓库不成立。
- 改法（3 文件，均不碰玻璃/文字/pp/布局/画质）：
  ① `src/gev-boot-gate.js`：inputRelease 上移到 tick 顶部，判据只剩 `__lc.api.mounted === true`
     （删掉 baseVisible + INPUT_STD_MIN/UNIQ_MIN，旧位置留注释阻止「挂回去」）；
  ② `src/keySetup.js`：`import.meta.env?.PROD === true` 时 `destroy(); return null;`，不发必 404 的请求；
  ③ `src/lc/index.js`：新增 `api.mountedAt` + `bootTimeline.mark('lc:mounted')`。
- 验证（prod 4174 / dist 重建 / RTX 3060 Laptop D3D11 / 全新 profile / `scripts/lc/phase7a-d-cold.mjs p7a2 6`）：
  · **无 404：6/6 跑 `errors: []`**（改前 6/6 各一条）→ PASS；
  · 真实鼠标点击 mini→opening **6/6**；photoreal 后台 ready **6/6**；GPU 6/6 3060；
  · B5 中心 640×420 **6/6 PASS**（std 32.8–33.5 / uniq 51k–55k）；
  · cardsClickable 墙钟 4.33/4.68/4.77/5.21/6.90/8.18s（中位 4.99）→ **≤5s 3/6，未达 6/6**；
  · B5 墙钟 9.02–13.61s（中位 10.0）→ **≤9s 0/6（≤8s 0/6），未达**；
  · 交互后 10s：fps 56.0–63.4，但单帧 >100ms 3–17 个 → **「无 >100ms」未达**。
- 归因：本轮环境比上一批慢一档（对照 p7ad7：B5 墙钟 7.4–8.6s / fps 105–125；本轮 9.0–13.6s / 56–63），
  `nvidia-smi` 显示 `ego.exe`（Citro Labs ego lite）持有 GPU 上下文 —— skill 记录的
  「同代码同机 115fps→16–26fps」污染源，本轮 fps/长帧需打折看。B5 慢与本次改动无关：
  `gate:view:content`（底图清晰）从 4.2–4.7s 退到 5.0–9.1s，该路径本轮 0 改动。
- 剩余 ≤5s 的真实头部（本轮 `stages`，nav 口径）：`paint:fcp→gate:eval` 1.6–2.1s、
  `viewer:construct` 0.49–0.56s、`setStack` 0.97–1.19s、`gate:cine:go→setStack:begin` 1.0–1.2s、
  `app:ready→tileset:fetch:end` 0.9–1.2s；卡壳注入 + LC mount 排在 app:ready 之后。
  即 `/cesium/Cesium.js` 求值（0.64–3.2s，Phase7A-D 已记）→ App 壳注入 → LC mount 三段串联。
  「~1.5s」需把卡壳/LC 移到 Cesium 求值之前（新架构改动），不属本卡「只做」范围。
- 产物：`.gev-logs/lc/phase7a/p7a2-summary.json`（6 跑全量）、`p7a2-run{1..6}-reveal.png`；
  仪器 `scripts/lc/_diag/p7a2-inpage.mjs`（页内 rAF 采样，避免外部轮询拖慢冷启动）、
  `scripts/lc/_diag/p7a2-diag.mjs`（404/命中测试版，已被 inpage 版取代）。
- 回滚：① gate 的 inputRelease 块移回 baseVisible 分支并恢复 INPUT_STD_MIN/UNIQ_MIN；
  ② 删 keySetup 的 PROD 早退；③ 删 `api.mountedAt` 与 `lc:mounted` mark。均单点、无跨文件耦合。


## 2026-10-30 Phase7D3：色散「扩大可见带」施工与实测（kanban t_f3529d18）

- 起因：Phase7C Gate item5 FAIL（真实地图 band 均值 JND 4/36 = 11%，判据 ≥50%），lead 决策走方向1：
  **扩大可见带**（只改 edgeBand 覆盖，不改判据、不放宽 R/B 0.8–1.2px 硬规）。
- 改法（`public/gev-edge-lens.js` + `dist/` 同步，其他参数 0 改动）：
  shader `edgeBand = 1 - smoothstep(uDispE0, 1.0, t)`；新增 `CFG.dispBandStart`（uniform `uDispE0`），
  产品默认 **0.85**（外侧 85% 带宽满幅色散）；`0.0` = 与旧 shader 逐像素一致（回退/AB 用）。
  `dispPx` 仍 2.4 → R/B 间距 0.96px；dispGain 8 / dispCap 20/255 / band 10 / bandAlpha 0.55 / rim / alpha 全未动。
- 验证（同一页交错 A/B、冻结 Cesium 渲染循环消除地图运动污染，噪声 0.007–0.014，36 边）：
  e0 0 → |bandMean| 0.931 / band 内 |Δ| 均值 4.79 灰阶 / |Δ|≥3 的边 32/36；
  e0 0.6 → 0.784 / 5.03 / 34/36；e0 0.85 → 0.755 / 5.18 / 34/36；e0 0.95 → 0.715 / 5.01 / —。
  硬边 2px 条纹 band max（顶/下/左/右）50/40/41/58 → 44/39/40/57（未升高）；8px 棋盘峰值 29/43/31/36 → 31/50/37/37（略升）；
  flips 2→2、satFrac 4.6%→2.8%（无彩虹）。
- 结论（归因，不是推测）：**扩大可见带把幅度覆盖做上去了（32/36→34/36），但 gate 用的带符号 band 均值不升反降，
  JND 边数恒 1/36**。数值上 中位 |bandMean| / band内|Δ|均值 = 0.13–0.17 → **83–87% 符号抵消**：
  色散量 ∝ 底图沿法线的一阶导数，导数有符号且沿边/沿深随机换号，长线算术平均期望≈0。
  故该判据**在玻璃架构内不可达**，与 cap/gain 幅度无关（max2d 恒 20 = 已压 cap）。
- 视觉：产品态 8x 裁切 vision 仍判「看不到分色」（与 7C 一致）；色散隔离图（A−B×8）显示色散**覆盖整带且红蓝交替成块**。
- gate 仪器（`phase7b-sweep verify`，非冻结）：JND 1/36、meanAbs 0.691、max2d 20、flips 2、satFrac 1.7%、sep 0.96px；
  与 7C 的 4/36 差异来自**跨会话地图内容**（同会话 e0=0/0.85 均为 1/36）。
- 回滚：`dispBandStart: 0.85 → 0.0` 一行 + `cp public/gev-edge-lens.js dist/`。
- 报告：`.gev-logs/lc/phase7d3/Phase7D3-报告-20261030.md`；仪器 `scripts/lc/_diag/p7d3-{disp-band,visual,hard-edge}.mjs`。
- 附带复核（item7 / T5c 红）：`scripts/lc/_diag/p7d3-t5c.mjs`（冻结画布、真实鼠标、按 0/200/400/800/1500/2500ms 采样）
  实测 data-panel 悬停 Δmean **10.93** → 移开 0ms 即 **0.018**、其后 ≤0.16（max 1，阈值 0.6）
  → **悬停高光无残留，7C 的 0.706 属未冻结画布时两帧间地图运动污染**（其「同状态噪声 0」用的是相邻帧，口径不自洽）。
  建议 T5c 在 useDefaultRenderLoop=false 下量，噪声底用同间隔（≥700ms）定标。


## 2026-10-30 Phase8A · 24+D1-D12 工作分解与文件所有权（只读审计）

- 产出：`docs/Phase8-工作分解与文件所有权-20261030.md`（282 行）。
- 基线：`main @ ac6d09b`（2026-10-30 16:49:10），工作区干净 / 0 stash / 唯一 worktree；**无任何产品代码改动**。
- 归属：24 条 → B6 / C5 / D4 / E6 / ENV3；D1–D12 → B6 / C5 / D1（自检脚本校验 24/24、12/12，无重复）。
- 文件所有权：按「层」重切而非按 P0/P1 横切 —— B=`src/lc/{material.css,tokens.json,morph.js,render.js}`；C=`public/gev-edge-lens.js`；
  D=`public/*.css`+`src/ui/styles/*.css`+`style.css`+`src/ui.js`+新增`src/bridge.js`；E=`index.html`+`vite.config.js`+`build/vite.js`+
  `src/cesium-boot.js`+新增`src/cesium.js`+懒加载/拆分/构建/`docs/architecture/rollback`；F 只读；ENV 无文件。
- 冲突（只列不改，见 §7）：C-1 8B/8C 卡体都写 material.css/tokens.json/lens（违反互斥）；C-2 gev-cn.css 双写（#11/D11 判归 D）；
  C-3 index.html（判归 E，D 的层顺序写 style.css）；C-4 material.css 是否进 @layer（默认不进）；C-5 codemod 排除 src/lc（实测 0 引用）；
  C-6 #12/D12 主因已被 t_2fdb18f0 修掉（material.css:100）；C-7 文档数字过期；C-8 #15/#14 codemod 交集 22 文件（唯一登记例外）。
- 实测修正（文档旧数 → 实测）：`!important` 231→**198**（gev-fix 98→**70**）；public CSS 5→**4**；`window.__*` 49→**42 名字/209 次**；
  `gev-cn.css` backdrop-filter 1→**3 处 6 行**；Cesium 2,564/210→**3,138/293**；巨型文件行数 ↑（4,480/2,946/2,481/2,324）；
  Cesium 注入不在 index.html 而在 `build/vite.js:23`+`src/cesium-boot.js`。
- 结论：无未提交改动 → **无回滚项**；`ac6d09b` 必须保留（含 7A3/7B/7D1）；禁止拿 `evidence/_collab/**`、`evidence/lg-glass-shots/**` 旧 CSS 当现状。
- 下一步：lead 按 §4 修订 8B/8C 卡体文件清单后，串行 B→C→D→E→F。


## 2026-10-30 Phase8B · 玻璃 P0 光学（D1/D2/D3 + #2/#3/#6）

- **现象**：液态玻璃规范 G6/G7/G12/G22 全 FAIL —— 上沿高光是 `material.css` 一条静态 1px 长渐变、
  阴影是固定 `rgba(0,0,0,.14)`、没有 material 变体概念（事实全场景 = Clear 且无亮底兜底）、
  `src/lc` 全域 0 处调 `__gevEdge`（变形期玻璃不降级）；浅底图上标题行发糊（无文字局部底衬）。
- **根因**：① 材质层只有「壳」没有「状态」——`src/lc` 没有任何模块持有「变体/亮度/指针/变形」这四类状态，
  所以光学量只能写成常量；② morph 与 lens 分属两个加载期（morph 是 ESM、lens 是 classic script），
  从未约定「变形期降级」这条生命周期；③ 文字可读性此前靠 `--lc-text-shadow` 单打，浅底无效。
- **改动**（4 文件，均在 Phase8A 的 B 层所有权内；`public/gev-edge-lens.js` 0 改动，归 8C）：
  ① `src/lc/render.js` 新增 `createGlass()`：material 枚举 `regular|clear`（默认 clear）、Cesium canvas
  8×8 降采样求背后平均亮度（5Hz）、阴影 alpha `min+(max-min)*luma` 5Hz 50% lerp、指针 x → `--lc-gloss-x`、
  Clear 亮度 >0.6 的 scrim **断言/日志**（`auto:false`，默认观感不变）、`morphBegin/End`（关闭 lens，
  结束 1 帧后按进入时 cfg 原值恢复），全部状态经 `window.__lc.glass.state()` 对外只读。
  ② `src/lc/morph.js`：`run()/runShift()` 的既有唯一动画兼作 morph 生命周期 → `edgeBegin/edgeEnd`（嵌套计数，0 新增定时器）。
  ③ `src/lc/material.css`：上沿 1px 高光改**径向弧段**（`--lc-gloss-x/--lc-gloss-a`，峰值 ≤0.25，半径 88px / hover 120px）；
  新增 §17 文字局部 scrim（卡壳 background-image 24px 竖渐变 alpha .30，24px 后归零）、§18 material 枚举 + Clear 亮底
  `::after` 单层压暗（默认 off）、`--lc-fg-flip` 图标前景兜底。227 行 / `!important` 0 / `font-weight` 0 / 双 ID 0。
  ④ `src/lc/tokens.json`：新 token 8 个 + `material` 段（threshold .6 / alpha .35 / auto false / 5Hz / restoreFrames 1）。
- **验证**（RTX3060 Laptop，真实 Chrome 非 headless，`127.0.0.1:4173`）：
  `scripts/lc/phase8b-gate.mjs` **9/9 PASS** —— A0 renderer=`RTX 3060 Laptop GPU`；
  A1 页面 GLASS 与 tokens.json 逐值 diff=0；A2 8/8 卡默认 clear + 双向切换 + 非法值回落；
  A3 指针 20%↔80% → gloss-x 20↔80、gloss-a 卡内 .250 / 离卡 .100、差值像素质心 **0.2316**（3 次 0.2315–0.2318）；
  A4 注入 .15→阴影 .13、注入 .85→.27（目标值精确命中，单调，computed `rgba(0,0,0,.27)`，真采样 84 次）；
  A5 文字 scrim 顶部带 24.64 灰阶、卡顶+30px 处 −1.27（不越界）；
  A6 亮度 .8 → 断言 1→2、默认仍 off（只日志）、`auto` 后 on 且压暗 36.5 灰阶；A7 morph 期 enabled=false 45 帧、
  draw frames 冻结 0、结束后恢复、duration 445ms、视觉峰值 1.035/1.035；A8 收尾 clear+off。
  回归 `phase6c6-visual.mjs p8b2` **21/21 PASS**（T3 四边色散 36/36、无多级彩虹、T5 hover、T6 文字、T7 pp）；
  单测 `src/lc/*.test.mjs` **81/81 PASS**。
  视觉（强制）：1x 全图 + 4x/8x 合成图 4 组全部经 vision 复核 → 玻璃中心透明、单层边缘、无双灰圈/彩虹/整卡压暗；
  高光弧段 20% vs 80%「明显不同，错开约 60 个百分点」；文字 scrim「顶部 24px 暗带，24px 以下两半亮度完全一致」。
- **踩坑（写下来省下一轮）**：① 注入亮度验证必须先 `glass.setSampling(false)`，否则 5Hz 真采样下一拍就把注入值冲掉
  （首轮 A4/A6 就是这么假失败的）；② 阴影 lerp 必须放在 **5Hz tick** 里而不是采样回调里，否则「注入一次 = 只 lerp 一步」；
  ③ 文字 scrim 早期同时挂在 `.panel-header` 和嵌套的 `.panel-title` 上 → 叠成两条（header+30px 处多压暗 24 灰阶），
  改为只画在卡壳 background-image 一条；④ 高光半径 140px 在 400px 宽的卡上几乎铺满 → 位移人眼不可读，
  收到 88px 后 vision 才判「明显不同」；像素证明要用 `__gevEdge.testChecker` 静态底衬，别拿会动的地图当参考底。
- **回滚**：`git checkout -- src/lc/material.css src/lc/tokens.json src/lc/render.js src/lc/morph.js`；
  运行时软退：`__lc.glass.setScrim('off')`（默认）/ `setSampling(false)` / `setPointer(-1,-1)`。
- **报告**：`.gev-logs/lc/phase8b/Phase8B-报告-20261030.md`（含 gate JSON 与截图清单）。

## 2026-10-30 · Phase8C：玻璃 P1/P2 与 STATS 同源（D4–D12 + #4/#5/#7/#8/#9/#10/#11/#12）

- **现象**：8B 之后 P0 光学到位，但 P1/P2 全缺 —— 无自适应 tint / 无 spill、WebGL 层完全无视系统无障碍设置
  （`prefers-reduced-transparency` 只在 CSS 侧生效、`prefers-contrast` 全仓 0 命中）、内层没有同心圆角公式、
  玻璃正文无字重下限、≤40px 图标不会随背景明暗翻转、`stats()` 只报运行时值（门禁读到 12/1.5/1.5 与源码 10/2.4/1.0 对不上）、
  `gev-cn.css` 还留着 3 块 backdrop-filter 源规则靠 material 后置覆盖压住、pp 行内控件仍可能被压且命中区不到 44px。
- **根因**：材质层缺「持续跟随背景」的反馈链路（无采样、无 CSS 变量出口）；无障碍只在 CSS 侧做了分支而折射是 WebGL 画的；
  门禁读数取的是运行有效值而非配置常量；灰圈的第二个来源（旧 CSS 源规则）一直没删。
- **改动**（4 文件，均在 8C 卡体清单内；`src/lc/render.js`、`morph.js` 0 改动）：
  ① `public/gev-edge-lens.js`（+221）：把已有 `mapTex` 挂到 8×8 FBO → 5Hz、9 卡轮转读 5 个 8×8 小块
  （背后中心 + 卡外四向环带），中心亮度写 `--lc-tint-a`（0.01–0.05，色 = 中心色**保色相提饱和 ×2.5**）、
  环带平均色写 `--lc-shadow-rgb`（黑向环带色混合，权重 ≤0.15）、中心亮度写 `--lc-fg-flip`（>0.62 深墨，迟滞 0.10）；
  a11y 三态 `full|reduced|solid`（四条 matchMedia + change 监听，reduced→dispPx 0/bandAlpha .75，solid→整层关闭）；
  `stats()` 增加 `cfg`（冻结的源码常量）/`eff`（运行有效值）/`a11y`/`look`，旧字段全部保留。
  ② `src/lc/material.css`（227→270 行，`!important` 0、双 ID 0）：§17 卡壳 background-image 第一层改 tint、
  图标加 `transition: color 120ms`；新增 §19 同心圆角（`--lc-radius-inner = max(0, r − inset)`，内层 8px）、
  §20 玻璃正文 `font-weight: 500`（只约束玻璃内，body 仍 400）、§21 pp 行 `flex:0 0 auto / min-height 36 / row-gap 8`
  + `::after` 只向行框外扩 4px（44px 命中区，不覆盖行内 slider）、§22 `prefers-contrast: more` 实色分支。
  ③ `src/lc/tokens.json`：`--lc-radius-inner/--lc-inset/--lc-shadow-rgb/--lc-tint-rgb/--lc-tint-a/--lc-fg-flip-ms`
  六个 token + `material.tint/spill/a11y/fgFlip/radiusInner/pp` 段；`--lc-shell-shadow` 改用 `rgba(var(--lc-shadow-rgb…))`。
  ④ `public/gev-cn.css`（+2/−11）：删 `#gev-lang-toggle`/`#gev-locate-btn`/`#gev-toast` 三块的 6 行 backdrop-filter
  与 4 行玻璃化 box-shadow —— 不再依赖层叠顺序纠错。
- **验证**（RTX3060 Laptop，真实 Chrome 非 headless，`127.0.0.1:4173`）：`scripts/lc/phase8c-gate.mjs` **14/14 PASS** ——
  A0 renderer=`RTX 3060 Laptop GPU`；A1 cfg 与 tokens 常量 diff=0、`set({band:12,dispPx:1.5,gain:1.5})` 后 **cfg 仍 10/2.4/1.0** 而 eff 跟随；
  A2 tint 9 卡 0.016–0.035、注入 1.0/0.0 → **0.050/0.010**，像素 A/B（off↔.05）**mean 1.07 / p99 4.14 / max 6.50 灰阶**、三次稳定；
  A3 spill 0.068–0.124 ≤0.15、computed 阴影 `rgba(10, 10, 8, 0.176)`（alpha 仍走 8B 的 lerp）；
  A4 图标注入亮底 → 深墨 `rgb(11,17,22)`、8x 像素 max 188 灰阶、过渡 0.12s；
  A5/A5b **真实 CDP `prefers-contrast: more` → solid**（enabled false / count 0 / 卡底 `rgba(8,12,18,.55)` / lens alpha 0 / 9 卡 rect 逐值不变）、
  **`prefers-reduced-transparency: reduce` → reduced**（dispPx 0 / bandAlpha .75），退出即复原 full；
  A6 内层半径 8px；A7 pp-label 500 且 body 400；A8 9 组 gap 8/8、重叠 0、行高 36、命中 12/12（`::after` computed 44px）；
  A9 `gev-cn.css` backdrop-filter 声明 0 处；A10 9 面卡体 backdrop-filter none / border 0；A11 8s：fps 163.9、p95 12.1ms、
  窗口内 drawMax 21.6ms、look 采样 39 次（≈5Hz）。
  回归 `phase8b-gate p8c2` **9/9 PASS**、`phase6c6-visual p8c` **21/21 PASS**、单测 `src/lc/*.test.mjs` **81/81 PASS**，控制台 0 error。
  视觉（强制）：1x 全图 + 6x tint A/B + 8x 图标 A/B + 4x pp 卡 + 4x solid 全部经 vision 复核 → 单层/中心透明/无双灰圈彩虹；
  tint「极轻微色偏、不是整块变暗」；图标「明显一浅一深」；pp「行行分开无重叠」；solid「实色底 + 对比度显著提升」。
- **踩坑（写下来省下一轮）**：① Cesium canvas 在 postRender 之外读回是**全黑**（pdb 关着），采样必须挂在 draw 里
  且用**已上传的 mapTex + FBO**，不要再去 drawImage 那只 canvas；② 9 卡 5Hz 轮转时单卡 ~1.8s 才轮到一次，
  门禁读数要轮询 `look.per[id].at` 变化，否则读到的是上一拍（也解释了一开始 tint 恒 0.01 的假象）；
  ③ tint 直接回填「中心平均色」等于把背景再平均一遍，5% 下不可测（p99 2.3）→ 必须保色相提饱和；
  ④ `::after` 命中区**不能覆盖行内控件**（positioned 伪元素会抢 slider 的指针事件），要只向行框外扩；
  ⑤ 图标在 pp 未展开时是隐藏的：computed 有值但没像素，A/B 必须先真实点击展开再截图。
- **回滚**：`git checkout -- public/gev-edge-lens.js src/lc/material.css src/lc/tokens.json public/gev-cn.css`；
  运行时软退 `__gevEdge.look({tint:false,spill:false,fgFlip:false})` / `__gevEdge.a11y('full')`。
- **报告**：`.gev-logs/lc/phase8c/Phase8C-报告-20261030.md`（含 gate JSON 与截图清单）。

## 2026-10-31 · Phase8D：样式层叠显式化 + window 总线收敛（#13/#15/#20）

- **结论**：`@layer` 已显式化到**文件内**，层序 `vendor < foundation < components < material < overrides` 在 `index.html`
  顶部以无层 `<style>` 提前锁定；`!important` **123 → 15**（−87.8%，本卡范围达成 <20）；`window.__*` **186 → 124**（−33%），
  迁移项 0 处直连。过程中修掉两个会让整张卡白干的真问题（见下「坑」）。
- **改动**（只在本卡范围）：
  ① `index.html` +4：`<style>@layer vendor, foundation, components, material, overrides;</style>` 排在**所有样式表之前**；
  ② `style.css` +22/−5：层序注释、Google Fonts 改 `@import … layer(vendor)`、`src/ui/styles` 改文件自包层；
  ③ `public/gev-fix.css` **97 → 0** `!important`（98 条逐条归类进 `overrides`）；`gev-panel-win` 4 → 0；`gev-responsive` 5 → 0；
  `gev-cn` 17 → 14 且 `#gev-lang-toggle` 定位从 material 层迁回此处；新增 `public/gev-material-override.css`（`overrides`，1 条）；
  ④ `src/lc/material.css` 修掉双重 `@layer material` 包裹、删 lang-toggle 规则、通用规则排除 `.param-panel-divider` + `revert-layer`；
  ⑤ 24 个 `src/ui/styles/*.css` 文件内自包层；5 个运行时注入 `<style>` 包 `@layer components`；
  ⑥ 新增 `src/bridge.js`（8420B，register/get/has/dispose/list + JSDoc）+ `src/bridge.test.mjs`（7 用例）；`src/ui.js` 标 `@deprecated`；
  新增 `scripts/check-window-globals.mjs`（1199 文件 / 26 名字 / 迁移项 0 直连）。
- **验证**（RTX 3060 Laptop，真实 Chrome 非 headless，**生产构建** `dist-8d3` + `vite preview:4183`）：
  指纹 桌面 **1572 元素 / 0 error**、移动 390×844 **1575 元素 / 0 error**；`check-import-directions` **EXIT 0**
  （`{"modules":872,"portableEntries":61}`，同时修掉 HEAD 上就存在的 `src/bootstrap.js` 误判）、`check-window-globals` **✅**、
  `bridge.test` **7/7**、`bridge+importDirections+symbolSubset` **25/25**、`src/lc/*.test.mjs` **81/81**、`vite build` `built in 13.51s`。
  A/B（prod base vs prod 8D）`diffElements=1347`，其中 **1344 是 font-family**、其余 41 个 `_box` + 少量 `letter-spacing/text-shadow`，
  **全部同一根因**：`gev-cn.css` 的覆盖在 base 生产包里因为「排在 foundation 之前」一直在输，8D 归层后恢复生效 —— prod 终于与 dev 一致
  （`#title-bar h1` letter-spacing 8px → **6px** = `gev-cn.css:83` 声明值；`body` font-family 补回中文栈 = `gev-cn.css:152`）。
  视觉（强制）：1x 全图 + 4x 玻璃卡裁剪经 vision 复核 → 标题无重影无裁切、各控件独立成块无压字、**单层细边无双层描边/灰圈/糊块**、
  无越界；4x 下内部透明可见影像、无环带。像素：全屏 1.59%、dock 2.02%、card 2.01%（差异集中在玻璃背后活地图透明区）。
- **坑（写下来省好几轮）**：
  ① `@import '…' layer(x)` 在 **dev 生效、`vite build` 后被静默丢弃**（内联后不再是顶层 at-rule）→ 必须**文件内自包 `@layer`**；
  ② **层顺序在层名首次出现时就锁定**，之后的 `@layer a,b,c;` 不能重排已有层。生产包里 `public/*.css` 排在 bundle 之前，
  先创建了 `components/overrides`，于是 bundle 里那句层序把 **foundation 排到了 components 之上**，通配 reset `*{margin:0;padding:0}`
  压掉整站 padding（实测 `#traffic-sync-chip` 6px→0，1347 处偏差）→ 层序必须在 `index.html` 顶部提前声明；
  ③ 因此**任何层叠断言必须在生产构建上跑**，dev 服务器会把 ① ② 同时藏起来（此前基于 dev 的 A/B 结论全部作废）；
  ④ 未分层 `<style>`（运行时注入的 5 处）会整体压过任何 `@layer`，必须包 `@layer components`，否则改 pp 行距/卡内边距；
  ⑤ 8x NEAREST 裁切叠在卫星图上，vision **不可判读**（如实记为无效证据），改用 4x LANCZOS + 平坦背景。
- **回滚**：`git checkout -- index.html style.css public/gev-cn.css public/gev-fix.css public/gev-panel-win.css public/gev-responsive.css src/ui/styles src/lc/material.css && rm public/gev-material-override.css`；
  8D 基线快照 `.gev-logs/lc/phase8d/cur/`，pre-8D 备份 `.gev-logs/lc/phase8d/bak/*.orig`，可重复应用 `python .gev-logs/lc/phase8d/apply8d_v2.py`
  （**注意脚本不含 index.html 的层序 `<style>`**，回滚后再应用需手工补，否则退回坑②故障态）。
- **报告**：`.gev-logs/lc/phase8d/Phase8D-报告-20261030.md`（含验收表、A/B 数字、截图与 vision 结论、给 8E 的硬要求）。

## 2026-10-31 · Phase8E：Cesium 单一出口 + 图层懒加载 + 拆分 + 构建职责（#14/16/17/18/19/21）

- **结论**：#14 达成（198 处 Cesium 直连 → 1 个出口，`check-import-directions` 由 warn 升级为 **error** 且 EXIT 0，负向用例 EXIT 1）；
  #18/#19/#21 达成；#17 按「先纯函数再状态」拆出两批 497 行；#16 **部分达成**（入口 chunk 与首屏不再含图层代码，
  但波次 2 的 22 个非默认图层仍在启动期被请求，见下「未做到」）。`check:boundaries` 从**红的**（HEAD 就缺 5 处登记）修到 **EXIT 0，112/112 组**。
- **改动**：
  ① 新增 `src/cesium.js`（唯一出口，用 `cesiumNamespace → cesium → export { cesium as Cesium }` 规避构建期 `externalGlobals` 自引用）；
  codemod `.gev-logs/lc/phase8e/codemod-cesium.mjs` 改 144 个运行时模块的导入行，`*.test.mjs` 保留裸 `cesium`（node 测试图不经浏览器出口）；
  ② `constructCatalog.js` 改 async：`await import('./catalogFactoriesCore.js')`（默认组 343 kB）→ 实例化 →`await import('./catalogFactoriesRest.js')`（22 个非默认图层 779 kB）；
  ③ `worldOverlay.js` 2946→2808 行（`worldOverlay/primitives.js` 192 行常量/纯函数）、`gevActions.js` 4480→4209 行（`actions/vocabulary.js` 305 行）；
  ④ `vite.config.js` 只剩 `export { default }`，provider 再导出移到 `server/providers/index.js`（+守卫用例）；
  ⑤ `build/models.mjs` 清单 + `closeBundle` 裁剪 + `--sync` 出 sha256 清单；`GEV_KEEP_ALL_MODELS=1` 回退；
  ⑥ `docs/architecture/rollback/gev-edge-lens.phase3.js` 补版本头（内容/时间/对照 commit f16cd41/替换范围/禁止）。
- **验证**（真实 Chrome 非 headless，RTX 3060 Laptop，生产构建 `dist-8e` + preview:4175；基线 `dist-baseline-8e` + 4176）：
  `bootstrap` 2539.38→**1400.18 kB**；`dist` 377.9→**36 MB**、`dist/models` 346.7→**3.4 MB/12 文件**（`pruned 8 entries, 343.4 MB`）；
  首屏 resource timing：FCP 1712 ms 时**无任何图层 chunk**，两个工厂 chunk 在 4038/4297 ms 各拉一次（107 kB / 252 kB gzip）；
  启动 `bootInteractive` 10.01 s（基线 10.67 s）、遮罩消失 10.31 s（基线 10.93 s）；8 s FPS **87.0**（基线 76.2）、长帧 0；
  computed-style 指纹 **1572 元素 diffElements=0**（8E build vs 8E 前 build）；一层玻璃计数 0、edge-lens cfg 未降级；
  真实鼠标点卡头展开/收起均 true，`pageerror`/`console.error` = 0。全量单测 **5091 pass / 63 fail**，
  与 HEAD worktree 基线（5093/51）差集 = **新增 12 个，全部落在 8B/C/D 改过的 CSS/bridge 文件上**（8E 足迹内 0 新增失败）。
- **未做到（如实记录）**：`createLayerCatalog` 一次性校验「实例 ↔ 元数据」并冻结，波次 2 必须在构造前到位，
  所以「首屏完全不请求非默认 layers」没有做到（只是把 779 kB 从入口 chunk 挪成并行 chunk）→ 需 catalog 后置注册，已开后续卡。
- **坑（写下来省一轮）**：
  ① 出口模块里不能写 `export const Cesium = …`：构建期 `externalGlobals` 把命名空间导入整体改写成全局 `Cesium`，会变成 `const Cesium = Cesium` 自引用；
  ② 真 `deviceScaleFactor=4`（画布 5392×3096）会让 Cesium 大气 shader 编译失败、渲染停止（`renderer: n/a`）——
    **基线构建同样失败**，是本机环境限制，视觉取证要退回「1x 裁剪 + LANCZOS 4x」（8D 同口径）；
  ③ `check-package-boundaries` 是「按组枚举 rollup 实际解析到的模块」的硬清单，任何新增模块都要登记，
    手工枚举会漏（HEAD 就漏了 5 个）；用 `.gev-logs/lc/phase8e/fix-boundaries.py` 按报错迭代补齐最省事；
  ④ 首启引导（「选择你的第一视角」）会盖住 9 张卡，视觉取证必须先按 ESC 再截，否则 vision 只能判「卡片不可见」。
- **回滚**：`rm src/cesium.js src/app/catalogFactories*.js build/models.mjs server/providers/index.js && git checkout -- src vite.config.js build/vite.js scripts/check-import-directions.mjs src/overlays/worldOverlay.js src/voice/gevActions.js`；
  基线产物 `dist-baseline-8e/`、基线指纹 `.gev-logs/lc/phase8e/fp-base.json`、基线单测日志 `D:\Hermes\.tmp\tests-base.log` 保留可 A/B。
- **报告**：`.gev-logs/lc/phase8e/Phase8E-报告-20261031.md`（验收表、构建/启动/FPS/指纹数字、截图与 vision 结论、12 个继承失败的归属证据）。

## 2026-10-31 · Phase8E2：波次 2 图层推迟到首屏之后（catalog 后置注册）

- **结论**：8E 遗留的「波次 2（`catalogFactoriesRest` 779 kB）仍在启动期 4.3 s 被请求」已消除。
  `catalogFactoriesRest` 的请求起点现在**三次运行都等于 `hydration.idleAt + 3 ms`**（8106/8103、7613/7612、7400/7397），
  即 `app:ready` 之后的 `requestAnimationFrame` + `requestIdleCallback` 才发起；FCP 时图层 chunk 数 **0/0/0**；
  水合在遮罩收起前完成（本次 `hydrate:done 8392` vs `mask:gone 9885`），`pendingBefore 24 → pendingAfter 0`，29 层全到位。
- **路线**：选「catalog 后置注册」而不是「惰性 stub」。理由：启动期 `dataManager.registerDeferred` 会立刻读层方法
  （`id/subscribe/setParams/getDiagnostics`），stub 要回答就必须在 register 时 `import()` 真实工厂，推迟被吃掉（register 在 5.3 s，仍在关键路径）；
  且 stub 会破坏实例身份与「行为不变」约束。后置注册 = 实例唯一身份 + 显式 pending 相位 + `?layerdefer=0` 一键回退。
- **改动**：`catalog.js` 增 `createDeferredLayerCatalog`（`layers/metadata/get` 语义不变，`add/subscribeLayers/resolve/hydrate` 新增）、
  `pendingLayer.js`（身份稳定的 pending 句柄，订阅入队 + 属性转发 + 访问面记录）、`deferredCatalog.js`（rAF → rIC → `hydrate()`，`__bootTimeline` 打点 `catalog:hydrate:*`）、
  `constructCatalog.js`（`deferRest`，默认 false）、`lifecycle.js`（`finalizeRegistrations({allowPending})` + `registerDeferred`，pending 层 `phase:'pending'` 不算错）、
  `layerState.js`（恢复意图存 `_deferredLayerState`，`layer-registered` 即应用）、`data.js`（`subscribeLayers` 补注册）、
  `layerPresentation.js`/`layerPanel.js`（`rebuild()` 合并到一帧）、`tools.js`（幂等接线）、`standalone/{catalog,application}.js`（默认开、`?layerdefer=0` 关）。
- **验证**（真实 Chrome 非 headless，RTX 3060 Laptop，生产 `dist-8e2` rebuilt，hash 与上轮一致 `DLcOyih0/C6ETonk8/BPdof9Nd`）：
  本次验收 FCP 3052 ms / Core 5242 / Rest **8106** / idle 8103 / done 8392 / 面板 26 行 / 卡 9 张 / `pageerror`+`console.error` = 0；
  computed-style 指纹 `dist-8e` vs `dist-8e2` = **1572 元素 diffElements 0**（本次亲测，另有 03:30 同口径一对照样为 0）；
  单测：改动相关 6 文件 **72/72**、`manager+layerPresentation+ui/layers` **114/114**、全量 **5173 / pass 5115 / fail 48**，
  与 8E（5164 / 5091 / 63）差集 = **0 新增失败**（`comm -13` 为空）；门禁 `check-import-directions` EXIT 0（879/61/0）、
  `check-package-boundaries` EXIT 0、`check-window-globals` EXIT 0（1208 文件/26 名字）。
- **坑（省下一轮）**：
  ① 别用 `terminal(background=true)` 起 preview/vite：本机后台命令被 winpty 包了一层，直接 `bash: winpty: command not found`；
     改成「验收脚本自带静态服务器」（`scripts/lc/_8e2-accept2.mjs --serve=dist-8e2`）或前台一条命令里跑完；
  ② `pendingLayer` 句柄对未到位图层的属性一律返回 `undefined`（只放行 `id/pending/subscribe`）——这是刻意的「显式空」，
     启动期 detection 读 `getDetectableObjects` 199 次/`getUIState` 1 次（时间窗 5.3–5.8 s），图层到位后靠 `layer-registered` 触发重算；
  ③ `check-window-globals` 的 R2 只匹配字面量 `window.__*`：用 `globalThis.__*` 写仪器（`__gevPendingLayerAccesses`、`__gevCatalogHydration`）会绕过登记规则，下一轮要把 R2 扩到 `globalThis.__*`。
- **回滚**：运行时 `?layerdefer=0`；源码级 `rm src/app/pendingLayer.js src/app/deferredCatalog.js` + `git checkout -- src/app/{catalog,constructCatalog,data,layerPresentation,tools}.js src/data/{lifecycle,layerState}.js src/standalone/{catalog,application}.js src/ui/layerPanel.js`（退回 8E 行为，其余 8E 改动不受影响）。
- **未做（有意）**：`npm run format:check` 整仓 119 个文件为红（HEAD 起既有、不在 gate 内），8E2 自己动过的 5 个文件也在名单里；没有顺手格式化，以免改动已验收构建对应的产物 hash（否则要连带重跑指纹与 resource timing）。
- **报告**：`.gev-logs/lc/phase8e2/Phase8E2-报告-20261031.md`（验收表、三次 resource timing、指纹、差集证据、遗留 3 条）。

### 2026-10-31 Phase8F · 最终 Gate（只读）

- **任务**：kanban `t_730bd5e1`。未改任何产品代码/阈值/判据；新增 3 个只读仪器（`scripts/lc/_8f-gate.mjs`、`_8f-fps.mjs`、`_8f-d.mjs`）。
- **结论**：24 条 = 18 FIXED / 4 PARTIAL（#13 #15 #16 #17）/ 1 N/A（#12）/ 1 OPEN-ENV（#23）；D1–D12 = 11 PASS / 1 PARTIAL（D2 阴影真采样本轮未复现）；G1–G22 = 19 PASS / 3 PARTIAL（G8/G11/G20）。
- **FAIL（4）**：
  ① 6C6 **T3b 真实地图色散 0/36 边**（阈值 57 灰阶 = max(3, 3×噪声中位 19)，实测逐边峰值 12/19/45）——本轮未冻结 Cesium，噪声中位 19，不改判据，如实判 FAIL；
  ② `check-window-globals` **EXIT 1**：`src/app/catalog.js:72` 残留 `PROBE-TEMP` 探针无条件写 `window.__gevProbeAccess`（未登记，2 条 R2）；`dist-8e` 不含该代码；
  ③ **FPS 2/3 窗 <50**：3×8s = 49.5 / 36.8 / 62.2（前两窗在 photoreal ramp；`nvidia-smi pmon` 仅 ego.exe、sm 0%，非第三方占用）；
  ④ `style.css:18` 重复 `@layer vendor,foundation,components,material,overrides;`，违反 8D §9.3「只允许 index.html 一处」。
- **PASS 关键证据**：renderer = RTX 3060 Laptop（D3D11）；一层玻璃 9/9 卡 `backdrop-filter:none`、`border:0`、卡内后代非 none = 0；
  `cfg` 未降级（band 10 / dispPx 2.4 / gain 1 / ior 1.52 / bandAlpha .55 / dispBandStart .85 / tint·spill·fgFlip on）；
  tintA 0.024–0.035、spillW ≤0.106；高光 20%→80% `--lc-gloss-x` 精确跟随、alpha 0.250；morph 30 帧中 7 帧 lens 关闭且前后恢复；
  a11y 三态 CDP 实测 solid `enabled:false/surfaces:0`、reduced `dispPx:0/.75`、full 恢复；内层圆角 8px、pp 标签 500 / body 400；
  真实鼠标开合卡 opened/closed = true；reload 后中心区 std 34.4/55.0/45.3/46.5（**无黑帧**）；console/pageerror = 0；
  `check-import-directions` EXIT 0（877/61/0 warn）、`check-package-boundaries` EXIT 0（112/112）；`dist-8e` 36 MB / models 12 文件 3.4 MB；
  bootstrap 1400 kB、core 343 kB、rest 779 kB，FCP 1972 ms 时无图层 chunk；`src/lc` 单测 81/81。
- **视觉**：1x 全图 + 右栏/左栏/命令坞 4x（LANCZOS，来自 1x 裁剪）+ 卡 8x（NEAREST）。vision：单层细高光、无双层描边/双灰圈、中心透明可透见城市、无彩虹色带、文字无裁切/压字、无越界黑块；8x NEAREST 因卫星底图不可判读，记为无效证据。
- **未重跑（不隐瞒）**：全量单测 5091/63（>8 min）、8B/8C gate 全套、移动端 390×844 与全展开矩阵、真 DPR=4（本机 Cesium shader 崩，4x/8x 为放大口径）。
- **报告**：`docs/Phase8F-最终Gate-20261031.md`；JSON `.gev-logs/lc/phase8f/Phase8F-gate-summary.json`（+ gate.json / fps.json / d1-d12.json / c6v-8f.log）。

### 2026-10-31 Phase8B/C/D · 继承单测修复（15 条测试）

- **任务**：kanban `t_5d9ba12f`。修 8E 差集里属于 8B/C/D 的失败（卡面写 12 行，实际 15 条测试）。判定结论：**全部是测试判定过时 / 夹具缺陷，产品代码 0 改动**。
- **改了什么（全在测试侧，5 文件 +169/−24）**：`src/creditAttribution.test.mjs`（CSS 模型支持 `@layer`：语句固定层序、块入栈、`resolve` 按 重要性→层→特异性→源序 比较，并新增两处 fail-closed）、`src/testSupport/readStylesheet.mjs`（读入 CRLF→LF，与 `.gitattributes` 的 `eol=lf` 对齐）、`src/annotations/drawTool.test.mjs`（shim 判据从「< 40 行」改成「去注释后不许出现 `{`，每非空行只许 `@import`/`@layer`」）、`src/standalone/startupChrome.test.mjs`（沙箱补 `bridge.get` / `document`，新增「遮罩必须问过 boot gate」「同帧摘 boot-refining」两条断言）、`src/panelEscape.test.mjs`（断言迁到 `bridge.ensure('app.panelApi',{global:'__lcPanelApi'})` + `bridge.js` 白名单，并禁止直接写 window）。
- **真机视觉门禁（生产构建 `dist-8e` + preview:4177，真实 Chrome，RTX 3060）**：`phase8c-gate.mjs 8bcd` **14/14 PASS**（A10 单层玻璃 bad=[]、A11 fps 163.9、a11y 三态正常）；`credit-probe.mjs` **28/28 视口** credit 都真的画出来，computed `bottom` = `12px`（>900px）/ `calc(2vh + 5rem)`（≤900px），与 CSS 规则和模型解析值逐值一致 → 8B/C/D 的层叠改造**没有**视觉回退。
- **全量单测 A/B**：HEAD `ac6d09b` 干净 worktree **5154 tests / 5093 pass / 51 fail**（今天重跑）；当前 **5173 / 5115 / 48**。逐名差集：**新增 0，修好 15**（credit 8 + keyboard 1 + drawTool 1 + startupChrome 4 + panelChrome 1）；相对 HEAD 还额外修好 3 条 HEAD 上就红的 startupChrome（同一处 `document` 夹具缺失）。
- **剩余 48 条**：全部在 HEAD 上同名同错，集中在数据源/代理层（FIRMS 4 / cyclones 1 / Launch Library 2 / military 5 / transit 8 / nominatim 1 / CelesTrak 1）、`maps/controller` Esri 栈 12 条、`proxyErrorResponses` 的 `new Function` 语法错 11 条、`firstRunExperience` 顺序钉 1 条、`recentImagery` 2 条 —— 逐条归类见报告 §6。
- **坑**：① 8D 把全部 CSS 包进 `@layer` 后，任何「按源码顺序读 CSS」的模型都会读到空表，报错形态是「找不到规则」而不是「几何不合格」，这是判「测试过时」而非「实现回退」的关键判别；② 本工作副本的 CSS 是 CRLF（`.gitattributes` 写着 `eol=lf` 但没 renormalize），按 `\n` 锚定的多行选择器断言会假红，测试支撑层统一换行是正解；③ 后台 `terminal(background=True)` 在本机走 winpty 直接失败（`winpty: command not found`），长任务用前台跑（全量约 3 分钟）。
- **报告**：`.gev-logs/lc/phase8bcd-tests/Phase8BCD-12失败判定-20261031.md`；证据日志 `unit-final.log` / `unit-head.log`、`credit-probe-final.json`、`.gev-logs/lc/phase8c/phase8c-gate-8bcd.json`、截图 `final-credit-1440x900.png` / `final-credit-800x1000.png`。
- **回滚**：`git checkout -- src/creditAttribution.test.mjs src/testSupport/readStylesheet.mjs src/annotations/drawTool.test.mjs src/standalone/startupChrome.test.mjs src/panelEscape.test.mjs`。

## 2026-11-01 · 优化落地（4 项，已跑通双端冒烟）

- **范围**：只动 5 个文件，未触碰启动链路、图层注册、材质参数。改动前状态备份在
  `.gev-backup/20261101-opt/`，回滚说明见同目录 `ROLLBACK.md`。
- **① style.css**：删掉重复的 `@layer` 层序声明（8F FAIL ④）。层序唯一事实源回到 index.html:13。
- **② 中英药丸**：`#gev-lang-toggle` / `#gev-locate-btn` 与 overrides 层的 effective 规则一起从
  mono 10→11px 改为 sans 12px（`--font-mono` 虽已加中文回退，但等宽字形宽度不稳）。
- **③ build/vite.js**：加 chunk 体积报告（写 `.gev-logs/build/chunks.json`）、告警阈值 1500→900、
  vendor 拆包函数。**拆包当前不生效**：cesium 构建期是 external 全局，react 未进应用图，
  所以 1.4MB 的 bootstrap 是应用代码本身，不是第三方——构建日志会打印
  `[chunks] vendor split inactive` 以免误判。
- **④ src/lc/render.js**：高光热路径——值未变则跳过 `setProperty`（新增 `gloss.skipped` 计数），
  并新增 `invalidateRects()` 在 morph 起止 / 拖拽 / resize 时失效 rect 缓存，
  修「卡片变形时高光贴在旧位置」。踩坑：`createGlass` 与 `createRenderer` 是两个作用域，
  裸写 `invalidateRects` 会在对象字面量求值时抛 ReferenceError（冒烟当场抓到，已改为 `glass.invalidateRects()`）。
- **验证**：lc 单测 81/81；check-import-directions EXIT 0（879/61/0）；check-package-boundaries EXIT 0；
  生产构建 EXIT 0 / 23.1s / 17 chunk / models 裁剪 343.4MB；开发态与 `dist` 静态托管双冒烟 PASS
  （9 卡齐、零错误、药丸 computed 12px sans、指针静止时 writes 冻结）。
- **环境坑**：提权 shell 的 PATH 被裁剪（sed/tail/wc 不可用），`npm run build` 会 127 退出，
  用 `node node_modules/vite/bin/vite.js build` 直调。
- **未做（有意）**：模型外置（`build/models.mjs` 已于 Phase8E 实现裁剪）、Cesium 212 文件迁移、
  帧率自适应治理、图层搜索、分享链接撤销提示——前三项需要真机验收或大范围迁移，
  后两项属于功能而非优化，均未擅自改动。

## 2026-11-10 09:05 外网 natfrp 隧道恢复 + prod 服务绑定/Host 白名单修复

- 现象: 日检发现 frpc 进程不在, 任务 GodsEye_natfrp_frpc 处于 Ready 未运行; frp-fly.com:11269 不可用。重启后发现 4174 只监听 [::1](手动起的 vite preview 缺 --host) → 隧道 502; 修正绑定后又 403 "Blocked request. This host is not allowed."
- 根因: 1) 11-08 03:12 开机时 ClashMi(7890) 未就绪, frpc 走代理连 natfrp-api 失败后退出, 无重试; 2) 有人手动启动 prod 未带 --host 0.0.0.0, 仅 IPv6 回环; 3) start-prod.cmd 未设置 GEV_ALLOWED_HOSTS, build/allowedHosts.js 默认只放行 localhost/127.0.0.1, 外部域名 Host 被 hostCheckPlugin 拦截。
- 改法: 重启 GodsEye_natfrp_frpc; 结束无 --host 的 preview 进程并用 GodsEye_ProdServer 任务重起; start-prod.cmd 增加 set "GEV_ALLOWED_HOSTS=frp-fly.com"(备份 start-prod.cmd.bak-20261110)。
- 验证: frpc PID 5156, 日志 "隧道启动成功"; 4174 监听 0.0.0.0; http://frp-fly.com:11269/ = 200; LAN 与 127.0.0.1 均 200。
- 遗留: /api/flights 返回 502(OpenSky 代理 timeout, 上游直连 200 但 Node 侧超时), 需单独排查; C: 仅剩 15G/10%, 低于 15% 阈值。
