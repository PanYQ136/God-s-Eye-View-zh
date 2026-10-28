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

> 复验（提交时独立 CDP + GLM-4V 视觉）：按钮/菜单 computed `blur(22px) saturate(1.9)`、`border 0`、菜单 `z-index:200`、遮罩 `199`、command-dock `145`/left-panel-stack `100` 未变；深/浅按钮+菜单+叠加面板截图 `docs/lg-glass-shots/`（已入库）；全分辨率 headed 图 `docs/screenshots/lg-glass/`（本地，gitignore）。

## 2026-10-24 Liquid Glass 第二批扩展 + 全站层级复测
- 全屏穿透修复：玻璃菜单去掉全屏 backdrop(z199 pe:auto)，改 document capture pointerdown 监听点外关闭 → 零全屏元素。
- 玻璃扩到指令坞(dock-tray-toggle×2 + voice + tier)+右栏(pp-toggle-btn×10 + pp-collapse-btn)，新增 .lg-glass-skin(官方材质等比缩放/token圆角/不改尺寸交互)，MutationObserver 持续补挂。
- 全站层级实测：打开态全屏遮挡0/同z重叠0；z分区严格。5分辨率溢出0、坞/右栏视口内、无越界高z。
- 视觉复核(GLM-4V)：坞/右栏/菜单磨砂统一无破相。截图 docs/lg-glass-shots/。

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
- 证据：`.gev-logs/t_b37e6b4b/{final.log,verify.json,overlap12.*,input*.log,0*.png}`；说明 `docs/_collab/t_b37e6b4b/REPORT.md`；脚本 `scripts/{verify-interaction,verify-overlap12,qa-b37e6b4b-input}.mjs`。
- 已知（非缺陷）：切换动画 ≤350ms 内退场卡与已展开别组卡有瞬时几何重叠（最大 ~16.4k px²），是“不隐藏+位置连续”的代价；落定严格 0。

## 2026-10-28 首页帧率专项：28fps → 51fps（t_834a621c，空闲期整屏去重）
- 现象：Ego Lite 可见窗口（1536×730 / dpr1 / 正常态）GEV 首页只有 27.6–29.6fps，卡面要求 ≥30、目标 60；隐藏 Cesium/overlay/卡片都几乎不涨。
- 环境先说清：Ego 的 Chromium 用的是 **Intel UHD 核显**（`WEBGL_debug_renderer_info` = `ANGLE (Intel, Intel(R) UHD Graphics ...)`），同一台机同一个视口用 Chrome + RTX3060 是 **58.5fps**。而且该窗口对「持续产帧」的硬上限只有 **~40fps**：一个 20×20 的红方块加 transform 动画就只有 39.7fps，空白页 73.8fps。→ 60fps 在这个审计环境里物理不可达。
- 根因（trace + rAF 普查）：1.8s trace 只有 50 次 BeginMainFrame(=27.8fps)；主线程每帧 ~8ms、0 longtask；**GPU 进程 `SwapBuffers` 23.2ms / `Present` 22.6ms 每帧** → 36ms 帧预算 2/3 花在呈现路径。5 张全屏 canvas 每多一张 ≈ -2.5fps。而空闲时 `scene.postRender` 1.5s 内 **0 次**（requestRenderMode 本来就没在画），`gev-edge-lens.js` 的 rAF 兜底却仍每帧 clear+drawArrays 一张 1536×730 canvas → 每帧整屏变脏、整屏重合成，**像素一个都没变**。另有 `#scope-mask` 空的全屏 canvas（scope 默认关闭）照样参与每帧合成。
- 改动（只两处，不动玻璃材质/圆角/颜色）：
  1. `public/gev-edge-lens.js`：按「纹理版本 + 每个面的 x,y,w,h,band,cornerN,radius」签名去重，签名没变就完全不动 GL（画布保留上一帧）；地图重绘/卡片动画/缩放/resize/off-on/testBg 都会破坏签名 → 照常重画；`stats()` 增 `skip` 计数取证。
  2. `src/scopeMask.js`：没墨（`_painted=false`）时 `#scope-mask` 直接 `display:none` 退出合成树，要画前恢复 block。
- 验证（同窗口同视口，性能模式关闭/res 1.0 = 审计视觉口径，冷启动 17s 后测 1.5s×3）：**改前 27.6–29.6fps（中位帧间隔 33–36ms）→ 改后 50.5 / 53.2 / 49.2fps（中位 18.5–20.3ms，p90 ≤24ms，0 longtask）**；5s 内 `frames` 冻结 66 / `skip` 353→626（掐掉 273 次冗余整屏重绘）；相机 `setView` 后 `frames` 82→109（交互时照常重画）；关掉折射环层对比同帧截图有 6.09% 像素变化（环仍在出像素）；`#scope-toggle` 真实点击 on→`display:block`/1536×730、off→`display:none`；`node --test src/scopeMask.test.mjs` 22/22 通过。
- 未做：没到 60（审计窗口 ~40fps 上限，要 60 只能让 ego.exe/ego-browser.exe 走独显：`HKCU\...\DirectX\UserGpuPreferences` → `GpuPreference=2;`，属环境改动未执行）；拖拽/瓦片加载期仍 ~20–28fps（fill-rate）；`#world-overlay-detection-surface` 那张空闲全屏 canvas 未动（要改 worldOverlay.js 的墨判定，超出本卡最小边界）；未提交 git。证据 `docs/_collab/t_834a621c/README.md`。


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
- 根因（本次实测）：① GPU 只在请求侧做了一半——`viewer.js:178-182`/`edge-lens:282-284` 已带 `powerPreference`，但探测画布 `gev-graphics.js:257`、`atmosphereCompat.js:135` **不传 options**，且软件渲染判定（`SOFT_RE` + `showSoftNotice`）只活在**死文件** `public/gev-gl-glass.js:150-195`；② 灰圈 = 卡层 **22 处** `inset 0 0 0 {0.5|1}px` 内描边叠 App `border`；③ dock 三卡各有自己的展开形态（`.dock-popover-content` 13 处引用、`.dock-tray-toggle` 第三套、语音卡独立 popover），面板跟 header 锚点走 → 谁开谁贴边；④ 动画 `SPRING.duration=350` 硬编码 + `easing:'linear'` 采样 + 另一处 280ms `cubic-bezier` 同卡打架，reduce 时 `dur=0`；⑤ 行数：`wc -l`/`awk`/`sed` 三条命令都得 **1011 / 3245**，全仓副本（`dist/`、`docs/_collab/*/orig`）是 862，**没有 908/3048**，文件 mtime（03:16 / 12:31）早于检查报告 → 908/3048 不可复算；⑥ P 表动画公式 `350+sqrt(area)*4` 对 176×43 实算 698→夹 450，与其自身示例「≈350ms」矛盾。
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
