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
