# 上帝之眼小程序 · 全周期工程档案

> **归档 Agent**：Hermes Agent（Nous Research）· 模型 `deepseek-flash` · 归档时间 2026-10-24
> **工程仓库**：`D:\Hermes\gods-eye-miniprogram`（59 commits，tag `v1.0.20261023`）
> **源项目**：`D:\Hermes\gods-eye-view`（Cesium 网页版）· **后端**：`D:\Hermes\gev-cloudrun`（云托管镜像源）
> **文档定位**：只保留稳定结论（现象 → 根因 → 落地改法 → 验证），剔除过程性闲聊；可直接作为交接、复盘、排障手册使用。
> **双端适用**：第 1–14 章是小程序端工程档案；**第 15 章是网页端（gods-eye-view）设计资源与落地**（skill / 组件库 / 站点 / 提示词 / 双端差异）；第 16 章为附录。

---

## 0. 一页速览

| 维度 | 结论 |
|---|---|
| 产品形态 | 原生微信小程序（无框架、无 npm、无构建），三维地球保留，按用户要求**不做语音** |
| 页面结构 | 4 个页面 + 1 个分包：`pages/index`（主地图）、`pages/settings`、`pages/full`（web-view 网页版）、`pages/iconlib`（图标库）、`pkg/globe`（3D 球） |
| 图层体系 | **31 个图层 / 6 个分组**，默认开启 11 层（事件 7 + 气象 4） |
| 数据侧 | 32 条数据源登记、21 个 `/api/*` 聚合端点、27 个 provider、28 项自动化验收用例 |
| 后端 | CloudBase 云托管 `gev-api`（Node 24 / 1C2G / 8080）+ 3 个云函数 + 4 个数据库集合 |
| 包体 | 总计 **1.57 MB**（主包 866 KB / 3D 分包 706 KB），上限 2 MB |
| 图片音频 | **100.1 KB / 29 个文件**（代码质量规则要求全包合计 ≤ 200 KB） |
| 代码质量 | 图片音频、无使用或无依赖文件、AppSecret 误报 **三项全部通过**；编译告警 **0** |
| 功能自检 | `tools/selftest.py` **19/19 通过**（可复跑） |
| 体验版 | **1.0.0** 已上传，`commitTask async_4751052686148698112` |
| 数据源验收 | `node verify-all.mjs` → **28/28 通过**，健康面板 `down=0` |
| appid / 基础库 | `wx161bbcc5b8fcbfa5` / `3.5.0`；IDE `2.02.2609231` |
| 本文档覆盖 | 小程序端（1–14 章）+ 网页端设计资源（15 章）+ 附录（16 章） |

---

## 1. 项目定位与硬约束

### 1.1 目标
把 Cesium 网页版「上帝之眼」的**全部数据图层与三维地球**移植为可在微信内直接打开的原生小程序，保留真实数据（不做假数据填充），交互与视觉向网页版看齐。

### 1.2 用户下达的硬约束（贯穿全周期，验收即以此为准）

| # | 约束 | 落地方式 |
|---|---|---|
| 1 | 三维地球必须有 | `pkg/globe` 分包 + three.js r108 自绘球体、纹理、轨迹、昼夜线 |
| 2 | 不需要语音 | 不接 TTS/ASR，相关入口全部剔除 |
| 3 | **图标必须一一对应，不能出错** | 5 套色系图标按 `kind` 严格映射 + `scripts/check-icons.js` 审计 + 列表/地图运行时比对 |
| 4 | 代码质量必须过开发者工具扫描 | 图片音频总量压到 100.1 KB（运行时落盘方案）、开发产物移出工程、AppSecret 误报归零 |
| 5 | 主包 ≤ 2 MB | 3D 拆分包、图层适配器懒加载、图标内联、纹理压缩 |
| 6 | 坐标必须正确 | 源数据 WGS84，微信地图 GCJ02，统一走 `utils/geo.js`；上游已给 GCJ02 的（高德/腾讯）打 `crs` 跳过一次转换 |
| 7 | 默认图层规则 | 事件、气象默认开（11 层），其余数据图层默认关 |
| 8 | 单选聚焦 | 看单一图层时其它数据图层不显示，且**不能改用户配置**（用 `_soloIds` 渲染过滤，不动 `settings.layerOn`） |
| 9 | 定位只能用户触发 | 去掉自动跳转，只在点定位按钮时飞；刷新/定位把手 3 秒无操作自动收起只露一小截 |
| 10 | 每一处改动都写日志 | `PROGRESS.md` 固定「时间 + 现象 + 根因 + 改动 + 验证」，桌面副本同步 |

### 1.3 工程纪律（来自 AGENTS.md 与项目约定）

- 改代码前先出 diff，说明改动文件与验收点；写操作（上传体验版、删项目、云数据库写）二次确认。
- 不替用户宣称「真机通过」，未真机验证的一律标注「待真机确认」。
- 凭据、密钥、token 不入日志、不入文档正文。
- 官方技能目录 `D:\App\微信web开发者工具\resources\app.asar.unpacked\wechatide-skill` 只读，不得修改。

---

## 2. 系统架构

### 2.1 端到端链路

```mermaid
flowchart LR
  subgraph 小程序端
    A1[pages/index 主地图<br/>31 图层 / markers / 风场]
    A2[pkg/globe 3D 球<br/>three.js r108]
    A3[pages/settings 设置<br/>性能档 / 数据源健康]
  end
  A1 -->|wx.cloud.callFunction| B[godsEyeProxy<br/>Nodejs20.19 · 256MB · 60s]
  A2 -->|同一代理| B
  B -->|HTTPS · gzip/br 解压 · 55s 上游超时| C[CloudBase 云托管 gev-api<br/>Node24 · 1C2G · 8080 · PUBLIC+MINIAPP]
  C --> D[api/index.js<br/>27 个 provider · 25 个 /api 路由]
  D --> E1[航班/军机 OpenSky · adsb.lol · adsb.fi]
  D --> E2[船舶 AISStream]
  D --> E3[卫星 CelesTrak + SGP4]
  D --> E4[事件 USGS · CENC 镜像 · NASA FIRMS · NIFC · Launch Library · NHC]
  D --> E5[气象 ECMWF IFS 风场 · 和风天气 · 降雨雷达 · 云图 · 闪电]
  D --> E6[国内 高德 行政区/交通态势 · 中央气象台台风]
  A1 -->|云开发 SDK| F[gevUserData<br/>收藏 / 设置 / 订阅]
  G[gevHealth · 每 10 分钟定时] -->|探活| C
  F -.-> H[(gev_favorites · gev_settings · gev_subscriptions)]
  G -.-> I[(gev_health)]
```

### 2.2 为什么是「小程序 → 云函数 → 云托管」三层

1. **小程序端不能直连境外源**：域名要备案并进 request 白名单，且大陆直连 OpenSky/NASA 延迟高、易被限流。
2. **云函数是统一入口**：固定 `godsEyeProxy` 一个函数，前端只认 `wx.cloud.callFunction`，不关心后端域名；顺带做 gzip/br 解压、BOM 剥离、二进制 base64 通道、并发去重。
3. **云托管承载重活**：27 个 provider、风场 GRIB 解析（eccodes-wasm）、缓存与预热都在云端常驻进程里，冷启动靠 `GEV_WARMUP` 与 MinNum 兜底。

> 历史教训：早期后端跑在家里那台机器（`47.104.22.0:64362` 内网穿透），穿透一断全部图层 502。2026-10-23 整体迁到 CloudBase 云托管后该风险消除。

### 2.3 请求与渲染链路（端内）

```
用户操作 → 图层调度 refreshLayer(id)
        → utils/api.js request()（单飞去重 → 云函数 → 失败 failover 换址重试）
        → utils/layers/*.fetch(ctx) 归一化为 {points, lines, areas, circles, rasters, meta}
        → render.buildMarkers()（视口裁剪 20% 余量、坐标 5 位、stableMarkerId）
        → scheduleRender() 合并窗口（常态 250ms / 刷新期 900ms）
        → setData 增量（只传变化字段）
```

---

## 3. 技术栈

### 3.1 小程序端

| 类别 | 选型 | 版本/参数 | 用途与备注 |
|---|---|---|---|
| 框架 | 原生小程序（WXML/WXSS/JS） | 基础库 3.5.0 | **无 npm、无构建**，`lazyCodeLoading: requiredComponents` |
| 地图 | `<map>` 组件 | — | 腾讯底图；`enable-traffic` 原生路况、`enable-poi` 默认关 |
| 三维 | three.js | r108（`pkg/three/three.js`） | 自绘球体 + 纹理 + 轨迹；WebGL 1.0，`maxTex=16384` |
| 坐标 | `utils/geo.js` | — | WGS84↔GCJ02 互转、bbox 计算、距离/方位 |
| 存储 | `wx.setStorage` + 云开发 DB | — | 本地优先、云端备份（收藏/设置/订阅） |
| 能力 | `wx.getLocation`、`wx.getFileSystemManager`、`wx.base64ToArrayBuffer` | — | 定位、图标运行时落盘、二进制网格解码 |

### 3.2 云端

| 类别 | 选型 | 参数 | 用途 |
|---|---|---|---|
| 云函数运行时 | Node.js | Nodejs 20.19 / 256 MB / 60 s | `godsEyeProxy`、`gevHealth`、`gevUserData` |
| 云托管 | CloudBase 云托管 + Docker | `node:24-slim`、1C2G、MinNum 0 / MaxNum 2、端口 8080 | `gev-api` 常驻聚合服务 |
| 运行期依赖 | `@mapbox/vector-tile`、`pbf`、`ws`、`eccodes-wasm` | 约 40 MB（刻意不带 Cesium 380 MB） | 矢量瓦片、WebSocket 船舶流、GRIB 风场解析 |
| 数据库 | CloudBase 文档数据库 | 4 集合 | `gev_health`、`gev_favorites`、`gev_settings`、`gev_subscriptions` |
| 压缩 | `zlib` gzip / deflate / brotli | — | 大端点 `/api/flights` 180 KB → 14.8 KB（−92%） |

### 3.3 工具链

| 环节 | 工具 | 说明 |
|---|---|---|
| 编译/预览/上传 | 微信开发者工具 2.02.2609231 | MCP `wechat-devtools`（49 工具）+ CLI `wechatide -c Hermes <tool>` 双通道 |
| 图标压缩 | **imagequant**（libimagequant） | 必须用它与 alpha 一起量化；PIL `quantize()` 会把 alpha 压成 0/1，边缘发毛 |
| UI 图标生成 | `tools/make_ui_icons.js` + lucide + 无头 Chrome CDP | SVG → 96×96 透明 PNG，白线 stroke width 2 |
| 图标一致性审计 | `scripts/check-icons.js` | 5 套映射逐 key 校验文件存在、无悬空 |
| 功能自检 | `tools/selftest.py`（Python 3） | 19 项运行时断言，走 CLI 驱动 |
| 数据源验收 | `gev-cloudrun/verify-all.mjs` | 28 项，校验状态码 + 耗时 + 数据量 + 业务判定 |
| 云端部署 | `@cloudbase/cli 3.8.8` / MCP `cloudbase` | 云托管 `tcb cloudrun deploy`、函数 `tcb fn deploy` |
| 版本管理 | git | 59 commits，tag `v1.0.20261023` |

---

## 4. 工程目录与模块职责

```
gods-eye-miniprogram/
├─ app.js / app.json / app.wxss          全局入口；3 tab（网页版 / 数据图层 / 设置）
├─ pages/
│  ├─ index/      主地图（WXML/WXSS/JS/JSON 四件套）：HUD、坞、抽屉、详情卡、预警、风场
│  ├─ settings/   性能档、图层开关、底图/POI、风场配置、数据源健康
│  ├─ full/       web-view 打开网页版（4.5s 无 load 则撤 web-view 出兜底面板）
│  └─ iconlib/    图标库预览（160 个图标，含 5 套色系对照）
├─ pkg/globe/     3D 分包：globe.js（渲染循环/DPR 自适应）+ threeScene.js（场景/坐标）
├─ components/
│  ├─ jelly-toggle/     全站唯一开关组件（果冻动效）
│  └─ awareness-hud/    态势感知 HUD（吸边、左右换边、peek）
├─ utils/
│  ├─ api.js          请求层：单飞去重、failover 换址、二进制 getBuffer（云函数 base64 通道）
│  ├─ render.js       要素→markers/lines/areas；materializeIcon 图标落盘；crs 跳转
│  ├─ geo.js          WGS84↔GCJ02、bbox、距离
│  ├─ perf.js         性能档（高性能/均衡/省电 + 自动检测）
│  ├─ theme.js        5 套主题令牌
│  ├─ store.js        设置读写与一次性迁移标记
│  ├─ dataCache.js    端内 TTL + stale-while-revalidate
│  ├─ snapshot.js     快照（SCHEMA=2，旧结构直接丢弃）
│  ├─ favorites.js    收藏：本地优先 + 云同步兜底
│  ├─ sources.js      32 条数据源登记（主/备/许可/说明的唯一出处）
│  ├─ motion.js       Feel 物理参数 + spring 模拟（只算时长，不逐帧 setData）
│  ├─ sharecode.js / track.js / trail.js / aircraftClass.js / flights.js
│  ├─ layers/         8 个适配器：movement / cameras / infra / events / weather / utilities / awareness / cn
│  └─ awareness/      态势感知引擎
├─ assets/
│  ├─ iconpack.js     335 张图标 base64 内联（构建产物，勿手改）
│  ├─ icons/          包内保留 29 张（WXML 静态引用 + tabBar + 3D 纹理）
│  └─ tabs/           tabBar 图标 6 张
├─ cloudfunctions/    godsEyeProxy / gevHealth / gevUserData
├─ tools/             selftest.py、make_ui_icons.js
├─ scripts/           check-icons.js
└─ styles/            design.wxss 设计令牌
```

### 4.1 关键模块的「不可再犯」设计

| 模块 | 设计要点 | 为什么 |
|---|---|---|
| `api.js` | 相同并发 GET 单飞；连不上自动换址并只重试一次；二进制走云函数 base64 | 重复调用浪费云函数配额；真机默认 127.0.0.1 必然失败；`.bin` 直连在生产不可达 |
| `render.js` | `materializeIcon()` 首次落盘 `USER_DATA_PATH/icons`；`crs:'gcj02'` 跳过二次转换；`stableMarkerId` FNV-1a | 图标不能计入包体；高德坐标再转会偏 500 m；序号 id 刷新后会指向别的要素 |
| `motion.js` | 只算时长，位移交给 CSS transition | 本页单次 setData ≈ 700 ms，逐帧必卡 |
| `store.js` | 一次性迁移标记（`layerDefaultsV2`、`imAutoDone`、`cnTrafficOffDone`） | 规则变更要让老存档跟着变，但不能每次启动都重置用户选择 |
| `snapshot.js` | `SCHEMA=2` | 结构变更后旧快照会渲染出脏图形 |
| `favorites.js` | 本地优先 + 云同步 + 失败静默 | 重装/换机不丢收藏，云端挂了不影响本地 |

---

## 5. 图层体系（31 层 / 6 组）

默认开启 11 层（事件 7 + 气象 4）；其余默认关闭。渲染类型：点 / 线 / 面 / 圆 / 栅格 / 点+线。

| 分组 | 图层 id | 名称 | 渲染 | 图标 kind | 默认 | 刷新 | 对应网页版图层 |
|---|---|---|---|---|---|---|---|
| 移动目标 | `flights` | 实时航班 | 点 | `plane_unknown` | — | 15s | Live Flights（OpenSky+ADSB 聚合，含军机/通航分色） |
| 移动目标 | `militaryFlights` | 军机 | 点 | `plane_mil` | — | 30s | Military Flights（adsb.lol 军机） |
| 移动目标 | `vessels` | 舰船 | 点 | `ship` | — | 30s | Live Vessels（AISStream） |
| 移动目标 | `satellites` | 卫星 | 点+线 | `satellite` | — | 20s | Satellites（CelesTrak TLE + SGP4：位置、地面轨迹、轨道圈） |
| 移动目标 | `transit` | 公交地铁 | 点 | `bus` | — | 20s | Transit（GTFS-Realtime，7 城） |
| 移动目标 | `bikeshare` | 共享单车 | 点 | `bike` | — | 120s | Bikeshare（GBFS） |
| 移动目标 | `traffic` | 路况 | 线 | `car` | — | 120s | Traffic（TomTom 流量 + OSM 车流模拟） |
| 移动目标 | `cnTraffic` | 国内路况 | 圆 | `cntraffic` | — | 180s | Amap Traffic（高德交通态势，中国大陆真实拥堵） |
| 摄像头 | `cctv` | 公共摄像头 | 点 | `camera` | — | 300s | CCTV Mesh（Austin/TxDOT/Caltrans/TfL/511/Fintraffic/DriveBC/NSW/DelDOT/Tallinn/Tarktee/Warendorf/Calgary） |
| 摄像头 | `alpr` | 车牌识别相机 | 点 | `alpr` | — | 600s | Mapped ALPR Cameras（OSM/DeFlock） |
| 基础设施 | `installations` | 军事设施 | 面 | `military` | — | 600s | Mapped Installations（OSM Overpass，视口≤10°） |
| 工具 | `cnAdmin` | 行政区边界 | 点+线 | `installation` | — | 86400s | Amap District（省/市/区县边界 + 名称） |
| 基础设施 | `cables` | 海底光缆 | 线 | `cable` | — | 3600s | Submarine Cables（TeleGeography 打包数据 + 登陆点） |
| 基础设施 | `datacenters` | 数据中心 | 点 | `datacenter` | — | 3600s | Datacenters（打包静态 4,351） |
| 基础设施 | `dams` | 水坝 | 点 | `dam` | — | 3600s | Dams（打包静态 704） |
| 事件 | `earthquakes` | 地震 | 点 | `quake` | ✅ | 300s | Earthquakes（USGS 近 24h） |
| 事件 | `cnQuakes` | 地震 · 中国地震台网 | 点 | `seismic` | ✅ | 300s | CENC（中国地震台网，正式+自动测定） |
| 事件 | `fires` | 野火热点 | 点 | `fire` | ✅ | 600s | Active Fires（NASA FIRMS 24h） |
| 事件 | `perimeters` | 火场边界 | 面 | `perimeter` | ✅ | 600s | Fire Perimeters（NIFC WFIGS） |
| 事件 | `launches` | 航天发射 | 点 | `rocket` | ✅ | 900s | Space Missions（Launch Library 2 近 30 天） |
| 事件 | `cyclones` | 热带气旋 | 点+线 | `cyclone` | ✅ | 300s | Cyclones（NHC/CPHC 路径 + 预报 + 不确定性锥） |
| 事件 | `cnTyphoon` | 台风 · 中央气象台 | 点+线 | `cyclone` | ✅ | 600s | Typhoon（CMA/NMC 实况 + 官方预报，西北太平洋） |
| 气象 | `wind` | 风场 | 点 | `wind` | ✅ | 900s | Wind（NOAA GFS / ECMWF IFS 10m 风，网格箭头） |
| 气象 | `radar` | 降雨雷达 | 栅格 | `radar` | ✅ | 300s | Observed Weather · Rain radar（NOAA nowCOAST） |
| 气象 | `clouds` | 卫星云图 | 栅格 | `cloud` | ✅ | 300s | Observed Weather · Satellite clouds（GOES IR） |
| 气象 | `lightning` | 闪电密度 | 栅格 | `lightning` | ✅ | 300s | Observed Weather · Lightning（Vaisala 派生） |
| 工具 | `radio` | 世界电台 | 点 | `radio` | — | 1800s | Radio（Radio Browser，可拖动调谐） |
| 工具 | `recentImagery` | 近期影像 | 栅格 | `imagery` | — | 1800s | Recent Imagery（NASA GIBS HLS/VIIRS 每日瓦片） |
| 工具 | `directions` | 路线规划 | 线 | `pin` | — | 900s | Directions（OSRM 驾车/步行/骑行 + 转向指令） |
| 工具 | `measure` | 测距 | 线 | `pin` | — | 900s | Measure（两点大圆距离） |
| 工具 | `awareness` | 态势感知 | 圆 | `tower` | — | 30s | Awareness（250km 态势感知：依赖 flights/military/vessels/installations 端内聚合，圆环+HUD） |
**分组统计**：移动目标 8 · 摄像头 2 · 基础设施 3 · 事件 7 · 气象 4 · 工具 7（含行政区边界挂在工具组）。
**默认开**：`earthquakes`、`cnQuakes`、`fires`、`perimeters`、`launches`、`cyclones`、`cnTyphoon`、`wind`、`radar`、`clouds`、`lightning`。

---

## 6. 数据源登记（32 条）与验收

### 6.1 登记表（`utils/sources.js` 为唯一出处）

| # | key | 状态 | 主通道（实际上游） | 备用通道 | 许可 | 说明 |
|---|---|---|---|---|---|---|
| 1 | `flights` | on | pocketworld.org | OpenSky, adsb.lol | OpenSky 非商业 / ADS-B 社区源 | 服务端聚合 OpenSky + adsb.fi + adsb.lol，主通道限流时自动切换 |
| 2 | `militaryFlights` | on | adsb.lol /v2/mil | — | ADS-B 社区（公开） | 仅显示上游标注为军机的目标，常为 0 |
| 3 | `vessels` | on | AISStream | — | AISStream 免费额度 | WebSocket 快照；公开 AIS 源基本都要 key |
| 4 | `satellites` | on | CelesTrak | GitHub 镜像, retlector.eu | CelesTrak 公开 GP 数据 | TLE 由服务端缓存 6h，位置在端内用 SGP4 计算 |
| 5 | `satelliteTracks` | on | CelesTrak（同一份 TLE） | GitHub 镜像 | CelesTrak 公开 GP 数据 | 近地轨道轨迹由端内推算 |
| 6 | `traffic` | on | TomTom 流速 | OSM 路网模拟 | TomTom API / ODbL（OSM） | 中国大陆无 TomTom 覆盖，自动回退路网模拟 |
| 7 | `cnTraffic` | on | 高德交通态势（国内） | — | 高德开放平台 | 视口 2×2 网格采样，只看中国大陆真实拥堵 |
| 8 | `transit` | on | Transitland GTFS-RT | — | 各城市开放数据 | 按城市提供实时车辆位置 |
| 9 | `bikeshare` | on | GBFS（Lyft 等） | — | GBFS 开放规范 | 仅美/欧/澳城市 |
| 10 | `cctv` | on | 公开摄像头目录聚合 | — | 各机构公开页面 | 服务端聚合 state DOT / insecam 等目录 |
| 11 | `alpr` | on | OpenStreetMap / Overpass | osm.ch, osm.fr | ODbL | 公共镜像限流时自动换镜像 |
| 12 | `cables` | on | 打包静态（TeleGeography 整理） | — | TeleGeography 公开图 | 无实时上游 |
| 13 | `datacenters` | on | 打包静态（OSM / Wikidata） | — | ODbL / CC0 | 端内缓存 7 天 |
| 14 | `dams` | on | 打包静态（OSM） | — | ODbL | 端内缓存 7 天 |
| 15 | `cnAdmin` | on | 高德行政区（config/district） | 腾讯逆地理（定位城市） | 高德开放平台 | 市界 + 区县界 + 名称，服务端缓存 24h |
| 16 | `installations` | on | OpenStreetMap / Overpass | osm.ch, osm.fr | ODbL | 军事设施 query，镜像不稳定 |
| 17 | `earthquakes` | on | USGS | EMSC | USGS 公共领域 | 全球 24h |
| 18 | `cnQuakes` | on | 中国地震台网（CENC） | wolfx.jp 镜像 | 中国地震台网公开数据 | 国内官方目录，正式+自动测定，含烈度 |
| 19 | `fires` | on | NASA FIRMS（VIIRS） | NASA EONET | NASA 开放数据 | 服务端持 MAP_KEY |
| 20 | `perimeters` | on | NIFC / WFIGS | — | 美国政府公开数据 | 只在大火场时有数据 |
| 21 | `launches` | on | Launch Library 2 | RocketLaunch.Live（健康探测） | LL2 免费 API | 缓存 3h，失败用磁盘旧数据 |
| 22 | `cyclones` | on | NOAA NHC / CPHC | GDACS | 美国政府公开数据 | 覆盖大西洋/东太，西北太平洋为空属正常 |
| 23 | `cnTyphoon` | on | 中央气象台台风网（国内） | — | 中国气象局公开数据 | 西北太平洋实况 + 官方预报（BABJ） |
| 24 | `wind` | on | NOAA GFS / ECMWF（经 Open-Meteo） | Open-Meteo GFS 端点 | Open-Meteo 非商业 | 10m 风，网格箭头 |
| 25 | `radar` | on | RainViewer | — | RainViewer 公开瓦片 | 全球雷达拼图 |
| 26 | `clouds` | on | NASA GIBS | — | NASA 开放数据 | 服务端出图 |
| 27 | `lightning` | on | NASA SPoRT | — | NASA 开放数据 | 15 分钟闪电密度，覆盖太平洋/美洲 |
| 28 | `radio` | on | Radio Browser | de1/de2/nl1 轮询 | Radio Browser 公开目录 | 可拖动调谐 |
| 29 | `recentImagery` | on | NASA GIBS（HLS / VIIRS） | — | NASA 开放数据 | 每日瓦片 |
| 30 | `awareness` | on | 本地合成 | — | — | 由已加载图层在端内聚合 |
| 31 | `measure` | on | 本地计算 | — | — | 不依赖外部数据 |
| 32 | `directions` | on | OSRM / 本地路网 | — | ODbL | 起终点路线规划 |

### 6.2 聚合端点（21 个 `/api/*`）

`/api/flights`、`/api/ais-live`、`/api/celestrak/stations`、`/api/transit/feeds`、`/api/gbfs/`、`/api/cn/typhoon`、`/api/cn/quakes`、`/api/cn/admin`、`/api/earthquakes`、`/api/mini/earthquakes`、`/api/firms`、`/api/fire-perimeters`、`/api/launches`、`/api/cyclones`、`/api/wind`、`/api/weather/manifest`、`/api/radio/stations`、`/api/infra/static/cables`、`/api/infra/static/datacenters`、`/api/infra/static/dams`、`/api/sources/health`

### 6.3 28 项验收实测结果（2026-10-23 终局）

| 源 | 实测数据量 | 源 | 实测数据量 |
|---|---|---|---|
| 航班 | 300 架 | 卫星 TLE | 21 条 |
| AIS 船舶 | 9305 艘 | 公交 | 7 城 |
| GBFS 单车 | 2519 | 美区流速 | 300 段 |
| 国内路况 | 9 格 | 台风（中央气象台） | 1 |
| 中国地震 | 50 条 | USGS 地震 | 233 条 |
| 精简地震 | 50 条 | 行政区 | 11 区县（448 段折线） |
| 野火热点 | 9245（2 源） | 火场边界 | 109 |
| 航天发射 | 19 | 气旋 | 1 |
| 风场网格 | 360×181 | 天气 | 13 时次 |
| 世界电台 | 43 | 近期影像 | 2026-10-23 |
| 路线规划 | 52.6 km / 42 min | 海底光缆 | 1913 |
| 数据中心 | 4351 | 水坝 | 704 |
| 镜像地名 | 6 | 健康面板 | `down=0`（34/40 通道可用） |

---

## 7. 视觉与交互规范

### 7.1 主题与排版

- **5 套主题**：`amber`（琥珀，默认）、`cinema`（影院）、`ghost`（幽灵）、`predator`（捕食者）、`xray`（透视）。
- **字号 6 档**：18 / 21 / 24 / 26 / 32 / 40 rpx；历史 17 种字号已归一（映射规则：≤19→18、20–22→21、23–25→24、26–27→26、28–33→32、≥34→40）。
- **玻璃材质**：实底不透明度分层（胶囊 0.80 / 统计条 0.88 / 顶栏 0.94）+ 单条 `inset 0 1rpx 0 rgba(255,255,255,.30)` 内高光。**禁止再加 `::after` 斜向高光**——浅色底图上会变成灰白渐变压住图标。
- **图标 5 套色系**：`ui`（白模）/ `dark`（深描边，浅底图用）/ `tint`（彩色+深边）/ `tint_d`（彩色+白边）/ `tint_s`（选中亮黄 #FFD400）。选中只换色**不改尺寸**（`f.size || 26` 恒定）。

### 7.2 组件

| 组件 | 规格 | 要点 |
|---|---|---|
| `jelly-toggle` | md 84×48 rpx / sm 72×42 rpx | 轨道灰 `rgba(38,48,62,.92)` → 黄 `#F7D247`，350 ms `cubic-bezier(0.34,1.56,0.64,1)`；切换时 `jt-jelly` 播 scaleX 1→1.42→0.88→1；组件 `pointer-events:none` 把点击交给行；`observers.checked` 只在真翻转时播动画（避免列表刷新整排抖） |
| `awareness-hud` | 吸边 peek | `translateX(200px) + opacity 0 + pointer-events none`；把手竖排「态势」；左右吸附持久化 `gev_aw_side`；空闲 3 s 收边；详情打开时 `hidden` 整块消失 |

### 7.3 交互约定

| 交互 | 规范 |
|---|---|
| 定位 | **只能用户点按钮触发**；`jumpTo()` 一次 setData 原子落点（不做 20 步动画）；`_vpLockUntil` 2 s 视口锁防止 `syncViewport` 把旧中心写回 |
| 刷新/定位坞 | 右停靠 `lx=92.5`，左停靠 `lx=7.5`，peek 75，`holdMs=3000`；收起态右缘 96×260 rpx 透明命中区，内滑 >20 px 或轻点都展开；**按钮用 `bindtouchend` 触发**（父级 catchtouch* 会吞掉子按钮的合成 tap） |
| 态势面板 | 常态侧边只留触发把手；展开后把手消失；3 s 无操作自动收起 |
| 大类开关 | 语义 = 「全部子项都开 → 点一次全关；否则 → 全开」：`turnOn = !(onCount === total)` |
| 单选聚焦 | `_soloIds` 渲染过滤，**不动** `settings.layerOn`；极端天气层自动叠加风场；左上提示条「仅显示 · X　恢复全部图层」 |
| 预警 | 4 级色：红 `#FF4D4D` / 橙 `#FF963C` / 黄 `#F7D247` / 蓝 `#5AA0FF`；`minor→蓝、moderate→黄、severe→橙、extreme→红`；标题前带对应等级图标；同一预警按 `title|type` 去重；「定位 →」固定在卡片右下角；跳转后收敛到对应图层 |
| 详情卡 | 按 `selRef`（坐标锚点 + 同图层最近邻 <0.0025°）在整层重取后把要素认回来；脏值（全 `@`/`?`/`�`）替换为「未知呼号 / —」 |
| 长按地图 | 已移除（误触率过高），落点只由点选产生 |

---

## 8. 性能分级与自适应

### 8.1 三档参数（`utils/perf.js`）

| 档位 | markers 上限 | 风场密度 | 网格列数 | 网格上限 | 风箭头 | tick | DPR | 3D 帧率 |
|---|---|---|---|---|---|---|---|---|
| 高性能 `high` | 1200 | 130% | 16 | 40 | 420 | 95 ms | 2 | 60 |
| 均衡 `BASE` | 800 | 100% | 12 | 30 | 320 | 150 ms | 1.5 | 30 |
| 省电 `low` | 420 | 70% | 8 | 20 | 180 | 240 ms | 1 | 30 |

判定链：手动档位 → iOS 机型代号 → Android `benchmarkLevel` → 旗舰关键字表 → 内存 → 兜底 `BASE`；开发者工具固定按 `BASE`。

### 8.2 自适应规则

| 场景 | 规则 |
|---|---|
| 风场动画节拍 | 按 markers 总数分档：≤260 → 95 ms、≤600 → 150 ms、>600 → 240 ms（setData 成本取决于 markers 总量，不是字段数） |
| 3D DPR | 暖机 6 s 不动；单帧 `spend>34 ms` 持续 3 s → DPR −0.5（最低 1）；`spend<12 ms` 持续 6 s → +0.5（上限 `min(iOS?1.5:2, dpr)`）；只 `renderer.resize` 不重建场景 |
| 渲染合并 | 常态 250 ms；整轮刷新期间 900 ms 且整轮结束统一出一次；几何签名 `geoSig()` 未变直接 return |
| 视口裁剪 | 按 region 裁点（含 20% 余量）；坐标 5 位小数；省略默认字段（1180 点 → 678 marker，JSON 144 KB → 121 KB） |
| 折线抽稀 | >240 点等距采样 |
| 快照写盘 | 异步 + 40 ms 延后 + 60 s 同层节流 |
| 卫星 SGP4 | 按缩放取 60 / 150 / 400 颗 |

---

## 9. 质量门：代码质量 / 包体 / 自检

### 9.1 开发者工具「代码质量」三条硬规则（反编译 `app.asar` 求证，非官方文档口径）

| 规则 | 实际实现 | 结论 |
|---|---|---|
| `IMAGE_AND_AUDIO_LIMIT` | 把 compiledPkg 内所有 `.png/.jpg/.mp3` **字节数加总**再与 200 KB 比较（**不是单文件上限**，主包+分包合并算） | 364 张图标合计 527 KB 必挂 → 必须让图片不进包 |
| `CONTAINS_UNUSED_*` | 只扫 compiledPkg；`packOptions.ignore` 内的文件不进包也不被查 | 开发产物（`cloudfunctions/`、`tools/`、`docs/`、`.claude/`、`.agents/`）移出或忽略即可 |
| `CONTAINS_APPSECRET` | 正则 `\W([0-9a-fA-F]{32})\W` | base64 里的 `AAAA…` 零填充会被误判 → base64 每 24 字符切段 |

### 9.2 图标运行时落盘方案（本项目最关键的一次架构调整）

```
源码 assets/icons/**.png（335 张，只被 JS 引用）
   ↓ 构建期：base64 内联
assets/iconpack.js（约 437 KB，计入代码而非资源）
   ↓ 运行时首次使用
utils/render.materializeIcon(path)
   → wx.getFileSystemManager().writeFileSync(USER_DATA_PATH + '/icons/' + 名, base64, 'base64')
   → 返回本地临时路径给 marker.iconPath / <image src>
```

- `marker.iconPath` 必须是真实文件路径，**不能是真删或 dataURL**，所以只能「字节换位置」：同一份 PNG，像素完全不变，字节不计入代码包。
- 压缩必须用 **imagequant**（alpha 参与调色板，PSNR 67 dB+）；PIL `Image.quantize()` 会把 alpha 压成 0/1，抗锯齿边缘立刻发毛（PSNR 仅 14–19 dB）。
- 包内只保留 **29 张**：WXML 静态引用 20 张 + tabBar 6 张 + 3D 纹理 3 张。

### 9.3 结果对比

| 指标 | 整改前 | 整改后 |
|---|---|---|
| 图片音频字节 | 527 KB / 364 文件 | **100.1 KB / 29 文件** |
| 无使用或无依赖文件 | 有（.claude / .agents / docs / tools） | **0** |
| AppSecret 误报 | 1 条 | **0** |
| 主包 | 1.31 MB | **866 KB** |
| 合计 | 2.02 MB | **1.57 MB** |
| 编译告警 | 若干（undefinedpx、Skyline） | **0** |

### 9.4 功能自检（`tools/selftest.py`，19 项）

| # | 用例 | 关键断言 |
|---|---|---|
| 1 | 编译与控制台 | `compile_wxml` / `compile_wxss` success，error+warn = 0 |
| 2 | 首屏 | 11 层、markers ≈482、failed 层为空 |
| 3 | 图标完整性 | 700 个 marker `accessSync` 全通过、图标库 160 个全在 |
| 4 | 单层开关 | cables 549→489 可逆 |
| 5 | 分组主开关 | movement 8 层 onTotal 12→20→12 |
| 6 | 单选聚焦 | 野火+风场 470 点，退出还原 |
| 7 | 详情卡 | 电缆 4 行 / 野火 9 行，持续 6 s 不自关 |
| 8 | 搜索 | 「福州」8 条，首条福州理工学院（gcj02） |
| 9 | 天气 | 7 天 + 4 指标，更新时间正确 |
| 10 | 底图 | normal ↔ satellite 切换生效 |
| 11 | 坞 | `tx=0` → 3 s 后 peek 75 |
| 12 | 测距 | 进 pick 模式并写 `settings.measureA/B` |
| 13 | 图层容量 | flights 300→120 |
| 14 | 主题 | 5 套切换 |
| 15 | 收藏 | 书签增删 |
| 16 | 态势 | SIA825 cohorts 4，`subjectMissing=false` |
| 17 | 3D 地球 | `dbg=7 就绪`、points 300 / layers 12 / fps 12、`px=17,35,40,255`（非全黑） |
| 18 | 设置页 | 「共 28 层 · 通道 38/40 可用」 |
| 19 | 全屏页 | url 正常、err 为空 |

复跑：`python D:\Hermes\gods-eye-miniprogram\tools\selftest.py`（需先 `export PATH="/usr/bin:/bin:/c/Program Files/nodejs:$PATH"`）。

---

## 10. 全周期问题库（155 条）

> 来源：`PROGRESS.md` 全文（约 2500 行，2026-10-19 → 2026-10-24）逐段抽取，按类归并、去重。
> 每条固定五要素：**时间 / 问题（含现象）/ 根因 / 落地解决 / 验证**。「未定位」= 当时未查实根因，只记录了可用的规避方案。

### 渲染与 3D 地球（18 条）

| 时间 | 问题 | 根因 | 落地解决 | 验证 |
|---|---|---|---|---|
| 2026-10-24 04:45 | **风场动画在标记刷新裁点后越界**<br>刷新把 markers 裁短后，风场 tick 仍按旧索引取粒子，越界写 setData | tickWind 没有对 markers 长度变化做守卫 | tickWind 增加 markers 长度守卫（清空即停动画、索引越界跳过） | devtools 刷新+开风场，控制台零 error |
| 2026-10-23 16:49 | **精度调高后箭头数不变，看不出差别**<br>把网格精度从 8×10 拉到 26×32，屏幕上箭头数量没变。 | pages/index/index.js 的 layerCapOf('wind') 吃 LAYER_CAP.def.wind（未配置 → 兜底 200），细网格抽稀后永远只有 200 个箭头。 | layerCapOf('wind') 改为按档位 perf.windArrows 取上限；weather.js 箭头上限由硬编码 240 改为 min(档位 windArrows, max(240, 面积×0.55))。 | 8×10 = 80 个 → 26×32 = 200 个 → 40×48（高性能）= 384 个，箭头数随精度真实变化。 |
| 2026-10-23 16:49 | **固定网格行数被屏幕比例重算，26×32 实跑 26×13**<br>滑块标着 26×32，实际渲染出来是 26×13 的网格。 | 固定模式下仍会按屏幕宽高比重算行数，把用户设的行数覆盖掉。 | utils/layers/weather.js 固定模式直接用用户设的行数；列数上限 24 → 按档位 gridMax（高性能 40），行数上限同步放开。 | windLattice 返回 26×32（修复前被改成 26×13）。 |
| 2026-10-23 14:20 | **render 里连续 setData 触发 recursive update 警告**<br>组件报 [Component] recursive update detected。 | render() 里 setData 后立刻同步调 syncSelectedDetail() 再 setData，同一轮渲染内递归更新。 | 改为 wx.nextTick() 后再调 syncSelectedDetail()。 | grep 确认该警告 0 条。 |
| 2026-10-23 04:34 | **台风单选后看不到风场**<br>单选台风只剩台风轨迹，风场箭头消失，看不出风圈影响。 | soloLayers 只按点击的图层过滤，没有极端天气层的叠加规则。 | soloLayers(list) 内判断 isExtremeWeatherLayer(list[0])（cnTyphoon/cyclones/cnQuakes/fires/lightning），命中就自动 push 'wind'，提示条文案变成「台风 + 风场」。 | _soloIds=["cnTyphoon","wind"]，markers 137（台风 10 + 风场 127），台风轨迹与风场箭头同时可见。 |
| 2026-10-23 03:38 | **风场基础密度偏稀/偏密，观感空旷**<br>默认密度下风场箭头偏稀显空旷，调高后又挤成一片。 | 基础间距公式 60-(scale-3)*3 偏大，且总数上限约束过紧。 | 公式改为 base = clamp(52-(scale-3)*2.5, 34, 56) px 间距，列数 = 窗宽/间距，行数 = 列数 × 高宽比；保留 onResize + regionchange 重算。 | 100% 密度、scale 6、390×762 → 162 个箭头（上一版 128 略稀）；scale 9 仍随缩放变密。 |
| 2026-10-23 03:07 | **风场密度只按缩放算，横屏/宽屏间距不均**<br>横屏、分屏、折叠屏下风场箭头横竖间距不一致，一边留白一边挤成团。 | 列数只按地图 scale 算，没有用 viewW/viewH 参与，也没监听尺寸变化。 | windColsForScale(scale, viewW) + 行数 = 列数 × (viewH/viewW)；间距 60-(scale-3)*3，clamp 36~64px（放大更密）；新增 onResize()，400ms 防抖后重算并重刷风场。 | 390×762：scale 3 → 72 个、scale 9 → 81 个；窗口加宽到 600 → 126 个；scale 6 铺满 128 个，间距均匀约 40px。 |
| 2026-10-23 03:07 | **风场只有前 70 个箭头会动**<br>风场里只有排在前面的 70 个箭头跟随动画漂移，其余箭头静止不动。 | 粒子上限硬编码 70，tickWind() 只驱动粒子表前 70 个。 | 去掉「只动前 70 个」限制，全部风场箭头统一由 tickWind() 驱动，粒子表按实际箭头数建。 | 实测 128 个箭头 → 128 个粒子同步流动。 |
| 2026-10-23 02:02 | **风场动画不跑（span=NaN、alpha=null）**<br>风场箭头不流动，marker alpha 变 null | geo.regionBboxWgs84() 返回 'w,s,e,n' 字符串不是对象，bbox.e - bbox.w 全 NaN | 改 split(',') 解析成数值算 span（视野经度/14）；tickWind 只 patch markers[i].latitude/longitude/alpha 三个路径，每粒子相位错开 0.137，onHide 停表 | anim=true、list=110、span=1.22°；1.3s 后同一粒子 44.5476/108.9305 α0.77 → 44.5901/109.269 α0.97 |
| 2026-10-23 00:53 | **iOS 真机 3D 页整屏黑屏**<br>iOS 微信打开 3D 全黑，开发者工具正常 | globe.js 的 startGL() 先用 canvas.getContext('webgl') 探测，iOS 微信里外部先拿上下文后 three 再取返回 null，WebGLRenderer 构造失败 | 删探测，直接 G3.createRendererAsync(canvas,null,cb)；threeScene 去掉 powerPreference:'high-performance'，补 failIfMajorPerformanceCaveat:false、iOS 下 preserveDrawingBuffer:true；失败 400ms 重试一次，仍失败 HUD 显示「三维内核初始化失败：xxx」并出诊断面板 | 无 iOS 真机未复验，需用户确认；HUD 报错行用于继续定位 |
| 2026-10-23 00:12 | **风场图层错用飞机图标**<br>风场三层在地图上全显示成飞机 | iconFor() 彩色映射找不到 kind 时 fallback 到 map.plane，wind/wind_lo/wind_hi 未进彩色映射 | 三套彩色补 wind→arrow_warm、wind_lo→arrow_cool、wind_hi→arrow_hot；fallback 改 map[kind] ／／ KIND_ICON[kind] ／／ plane | KIND_ICON 46 key 对其余 4 套各 46 key，0 缺失；风场三档箭头恢复 |
| 2026-10-23 00:12 | **选中前后图标尺寸不一致**<br>卫星选中后从 16px 突然变 34px，飞机 26px 也变大 | 为突出选中把尺寸下限抬到 34px，isSel 为真即改尺寸 | buildMarkers 里 width/height 恒为 f.size ／／ 26，选中只换配色 tint_s 亮黄 | 卫星选中前后均 16px、飞机 26/26 |
| 2026-10-22 23:23 | **3D 页底部三键被屏幕下边缘切掉**<br>新增缩放条后底部 图层/刷新/设置 三键被裁 | glH = winH - hudTop - bottom 没扣新增缩放条行高 | globe.js 把 .zoombar-row 一起查询并计入扣减 | 截图确认三键完整可见 |
| 2026-10-22 23:11 | **3D 页缩放条被原生 canvas 盖住 + UI 图标离线生成链路**<br>缩放条绝对定位看不见，z-index:10 无效；改 cover-view 在开发者工具里也不出图 | 原生 canvas 是原生组件，层级高于同层 view，z-index 无效；工具对 cover-view 渲染支持不足 | 缩放条改文档流一行（canvas 之后、底部栏之前，右对齐，包 .zoombar-row）；UI 图标走 tools/make_ui_icons.js：lucide node 数组拼 SVG（stroke #FFF、width 2、24 viewBox）→ 无头 Chrome + CDP Page.captureScreenshot 裁 96×96 → assets/icons/ui/*.png | compile_wxml/compile_wxss（index、pkg/globe）success；console error 空；截图 3D 顶栏/统计条/缩放/底部键玻璃化且图标就位 |
| 2026-10-22 20:35 | **3D 地球数据落点与贴图对不上（整体偏 90° 经度）**<br>中国的航班/卫星/船舶/线面跑到非洲、大西洋上空，与地球贴图错位 | 两套互不兼容的坐标：pkg/three/geo3d.js 的 latLngToVec 是 (sinθ,…,cosθ)（经度 0→+Z），而 three.js SphereGeometry 的 UV 是 u=0→经度-180、u=0.5（贴图正中）→经度 0→+X，两者差 90° | 两处必须同时改：geo3d.latLngToVec 返回 [r*cp*cos(theta), r*sin(phi), -r*cp*sin(theta)]；threeScene.updateCamera 的 camera.position 同步改成 (r*cp*cos(lngR), r*sin(latR), -r*cp*sin(lngR))；昼夜 sunDirection 一并改 [cp*cos(subLng), sin(decl), -cp*sin(subLng)]；yaw 语义仍为"视角中心经度"，拖动/自转手感不变 | 相机对准 119.30E/26.07N 放福州点 → 标记正落福建沿海球心；对准 60E/20N 放福州/纽约/伦敦/圣保罗 → 只有福州在右边缘其余在背面；贴图自检 u=(119.3+180)/360、v=(90-26.07)/180 取 earth_day.jpg 为中国东南沿海、(0,0) 为几内亚湾；node --check 通过 |
| 2026-10-22 | **地图 polygons 在开发者工具里完全不绘制**<br>行政区/区域用 polygons 画，开发者工具里一个都不显示（纯洋红矩形也验证过） | 开发者工具对 polygons 渲染支持有问题（同一数据换 polyline 正常） | 行政区边界改用 polyline 画线（市界黄、区县界青） | 截图确认边界线正常显示；cnAdmin lines 448 |
| 2026-10-22 | **地图 circles/polygons 在开发者工具不上屏，颜色格式只认 #RRGGBBAA**<br>路况用 circles 画的彩色圆点不显示 | 开发者工具对 circles/polygons 渲染不稳定；颜色只接受 #RRGGBBAA 格式 | 路况改成自绘 4 个等级圆点 marker（绿畅通/黄缓行/橙拥堵/红严重），点开显示官方路段描述与畅通/拥堵占比 | 福州视口 4 格圆点稳定可见，最堵显示"缓行 |
| 2026-10-22 | **东经 90° 以东的折线/多边形全被静默丢弃**<br>光缆亚洲段、台风路径、公交线路不显示，欧美数据正常所以长期没发现 | buildPolylines/buildPolygons 的点是 [lng,lat]，校验函数却按 (lat,lng) 传参，经度 119 被当成纬度判为非法→静默丢弃 | 修正校验的传参顺序（按 [lng,lat] 传） | 修正后 lines 从 0 变 80 |

### 定位与坐标系（9 条）

| 时间 | 问题 | 根因 | 落地解决 | 验证 |
|---|---|---|---|---|
| 2026-10-23 01:48 | **冷启动每次都飞到巴西**<br>每次刷新页面都飞到巴西利亚，不回上次视野 | 冷启动 700ms 后 autoLocateOnStart() 无条件 getLocation + flyTo，工具模拟定位默认在巴西利亚 | platform 含 devtools 时跳过自动定位，保持当前/上次视野；真机继续 getLocation；新增 gev_last_region，regionchange 结束 2s 后存一次，冷启动先恢复 | 刷新后 region=118/31.5（默认中国视野），不再跳 -15.78/-47.92 |
| 2026-10-23 01:26 | **国内路况采样点偏移约 500m**<br>路况点整体偏移，跟道路对不上 | 高德交通态势返回本就是 GCJ02，render.js 对所有点无条件 wgs84ToGcj02() 造成二次转换 | render.js 支持点自带 crs:'gcj02' 命中即跳过（line/area/circle 同样支持 o.crs），cnTraffic 每点打 crs；另加 settings.trafficNative 默认 true：cnTraffic 返回空点集，页面用 map enable-traffic 官方图层，nativeTrafficOn 由 syncNativeTraffic() 随开关同步 | trafficNative=true → cn_traffic markers=0、meta 提示已切原生图层；false → pts=2 且 crs=gcj02 不再二次转换 |
| 2026-10-23 01:04 | **路线面板多出琥珀色途经点针 + 重开沿用上次起终点**<br>路线算完地图多一个琥珀针像自动加的途经点；重开面板上次起终点还在 | directions() 成功后主动 push directions:mid 针；打开面板没清 dirFrom/dirTo/dirVia | 删 directions:mid 针（路程耗时只在面板显示）；打开 directions 即清空 dirFrom/dirTo/dirVia（起点 0/终点 0/途经点 0/8），途经点只能由「＋添加途经点」或点槽位产生 | Node 直跑：起终点点 lines=1 viaCount=0，请求 coords 只有 2 段；加一个途经点 viaCount=1 |
| 2026-10-23 00:53 | **测距/路线只设起点不落钉 + 长按误触落点**<br>点完起点无标记；长按地图易误加一点；连线虚线且中间多一个针 | measure() 要求 A、B 都有才出点；onMapTouchEnd 有按住 ≥650ms 落点判定 + bindlongpress 绑定；连线画虚线并额外输出中点针 | 只设 A 也返回 A 大头针并提示「再点一次地图设置终点」，连线改实线 width 5 + arrowLine:true，去掉中点针；删 bindlongpress 绑定并停用 650ms 长按判定 | Node 直跑适配器：只有A → points=[measure:from] lines=0；A+B → points=[from,to] lines=1 width=5 arrow=true 254.602 km |
| 2026-10-23 00:12 | **测距工具默认开着且收起后留残余大头针**<br>冷启动 measure 层就开着，收起面板地图上还留 pin | 工具图层随 layerOn 一起持久化，点地图即落点 | pickToolOn() 加前置条件（面板未开直接 return false）；收起面板关掉 measure/directions；getSettings() 强制 layerOn.measure/directions=false | 冷启动 measure=false、0 pin；打开 true；收起 false |
| 2026-10-22 18:50 | **拖动地图后点定位，画面不动或跳了又弹回**<br>把地图拖到北京后点定位，落点被冲掉/弹回旧位置 | 不在 wx.getLocation，而是两处视口回写：flyTo 用 20 步×110ms setData 动画，真机地图应用慢，动画期间 syncViewport()（refreshAll 第一步就调）读到旧中心直接写回 this.region 打断动画；动画结束 700ms 后 refreshNow() 再 syncViewport 一次 | 新增 jumpTo(lat,lng,scale) 一次 setData 原子落点（直接到 15 级，不做动画）；新增 _vpLockUntil 2 秒视口锁，锁定期内 syncViewport/onRegionChange 都不许把 getRegion 写回 region；syncViewport 在 flying===true 或锁定期直接 cb() 返回；定位加坐标 toast | 拖动到 39.9,116.4 scale 12 → 点定位 t+2.8s 为 -15.783,-47.917 scale 15，t+10s 仍为同点（markers 372），刷新完成后没被弹回 |
| 2026-10-22 18:30 | **"定位/刷新挂了"——误报，实际是 IDE 位置模拟在巴西利亚**<br>点定位地图飞走/刷新没反应，看起来功能坏了 | wx.getLocation 在开发者工具返回 -15.7833,-47.9167（IDE 默认模拟点，巴西利亚），flyTo 从 scale 3.2 推到 15 确实飞了——只是飞到南美；刷新实际正常（_refreshing 正常翻转、markers 照渲染），"看着挂了"是被下面 3D 崩溃打死了 appService | 定位成功加 toast 显示坐标（已定位 · 26.07,119.30），一眼看出有没有反应；渲染改 jumpTo 原子落点 | toast 显示 -15.783,-47.917 确认链路通；真机为真实位置 |
| 2026-10-22 17:00 | **搜"东景家园"跳到无锡**<br>地名搜索同名 POI 命中外地（无锡），不是当前视口内的那个 | 搜索无位置偏置，按上游打分取第一条 | 地名搜索加视口距离偏置，优先返回当前视口附近的同名 POI；地名主通道换高德（0.18–0.25s，东景家园 26.0679,119.3491） | 实测"东景家园"落在福州晋安区坐标 |
| 2026-10-22 | **高德坐标被二次转换，落点偏约 500m**<br>用高德搜索到的坐标在地图上偏移约 500 米 | 高德返回 GCJ-02，前端又按 WGS84 再转一次 | 服务端结果带 crs 字段，前端识别 crs 后跳过二次转换 | 东景家园等 POI 落点与地图底图对齐 |

### 数据源与接口（26 条）

| 时间 | 问题 | 根因 | 落地解决 | 验证 |
|---|---|---|---|---|
| 2026-10-24 05:15 | **godsEyeProxy 文本响应带 UTF-8 BOM 导致 JSON.parse 抛错**<br>上游/云托管回包若带 BOM(EF BB BF)，前端 JSON.parse 直接抛错拿不到数据 | 云函数只做 gzip/deflate 解压后原样透传文本，未剥离 BOM；GBK 上游无 core 解码器（需 iconv），但本案 27 个上游均为 UTF-8，实际风险≈0 | cloudfunctions/godsEyeProxy/index.js 文本响应统一剥离 UTF-8 BOM，GBK 不支持处加注释标注 | 部署后 invoke /api/cyclones 返回 ok:true/200 无回归 |
| 2026-10-24 04:45 | **云函数默认超时被平台 kill，风场清单 40s 慢上游拿不到**<br>风场类慢接口偶发超时失败，前端拿不到清单 | godsEyeProxy 函数超时配置低于慢上游 40s 的耗时，被平台先终止 | godsEyeProxy updateFunctionConfig timeout=60 | 超时配置生效；devtools 开风场 270 点、error 空 |
| 2026-10-24 04:25 | **风场网格二进制在真机生产不可达**<br>风场 manifest 走云函数正常，但网格 .bin 直连 127/LAN 地址，正式版真机取不到→风场整体失效 | utils/api.js getBuffer 只走 getBufferDirect 直连 baseUrl，正式版 127/LAN 不可达且非白名单域名 | utils/api.js getBuffer 优先走云函数二进制通道（godsEyeProxy binary:true → base64 → wx.base64ToArrayBuffer）；上游明确 HTTP 状态（如 404 网格过期）不吞、交 weather.js 重取清单；仅传输/函数错误才回退 getBufferDirect，直连加 failover 重试 | devtools(USE_CLOUD=true) 开风场 270 点/error 空/unavailable=false；直测云二进制通道：新 gridUrl → ok:true/status:200/base64=695040（≈679KB，符合 521280B×4/3）；过期网格 id → 云返回 binary:true/404 |
| 2026-10-24 04:10 | **二进制端点经代理被 toString + JSON.parse 破坏**<br>风场 .bin / 图片经 godsEyeProxy 会被转成字符串再 JSON.parse，二进制不可用 | main 对所有响应无条件 JSON.parse(body) | 新增 binary 参数：.bin/.png/.jpg/.webp/.gif/.tif 或 /grid/ 或 event.binary 走 Buffer 直出 base64、不 toString、不 JSON.parse；文本路径不变 | base64 往返本机通过；部署后文本主链路 /api/cyclones 无回归；后续风场网格经此通道取到 695040 base64 |
| 2026-10-24 04:10 | **上游回 content-encoding: br 时解压不命中，前端拿到乱码**<br>若云托管/CDN 返回 brotli 压缩，云函数解不出正文，JSON.parse 拿到乱码字符串 | fetchUrl 只处理 gzip/deflate，Accept-Encoding 未声明 br，无 brotli 分支 | godsEyeProxy/index.js fetchUrl 增 br 分支(zlib.brotliDecompressSync)，Accept-Encoding 加 br | 本机 node brotli roundtrip 通过；updateFunctionCode 部署成功；invoke /api/cyclones 返回 ok:true/status:200 真实风暴数据（冷启 99ms） |
| 2026-10-24 03:55 | **同一 openid 出现多条收藏/设置文档，读回旧数据**<br>线上偶发多设备或快速连续增删后，gev_favorites/gev_settings 同一 openid 多条文档，get 取 limit(1) 命中旧条→收藏"回档/丢最新 | 旧 set 逻辑"读→判存在→update 或 add"非原子，并发两次 set 都判不存在各 add 一条 | cloudfunctions/gevUserData/index.js set 改为幂等 upsert：文档 _id 固定为 OPENID，doc(OPENID).set() 只覆盖同一文档；set 后 best-effort 删除同 openid 旧随机 _id 冗余文档；get 优先 doc(OPENID)，兜底兼容旧随机 id | 模拟器 set×2 均 ok、get 返回单条；MCP 查 gev_favorites 原 2 条→触发全量 set 后收敛为 1 条（_id==_openid，6 条真实收藏，smoke 清除）；updateFunctionCode 部署成功 |
| 2026-10-24 03:25 | **航班详情页呼号显示 @@@@@@@@**<br>点航班（如 N291SR）打开详情卡，标题与"呼号"行显示 8 个 @，像乱码 | 不是渲染/编码问题——上游 OpenSky 对未广播呼号的飞机把 callsign 填成 8 个 @ 占位，数据层原样带进 f.label 与 f.detail，详情页照显 | pages/index/index.js 加 _isGarbageVal/_scrubDetail/_scrubTitle（整串只由 @ ? ？ 空白 U+FFFD 组成且≥2 字符判脏）；onMarkerTap 与刷新重认两处详情构造改走 _scrubDetail(this.detailOf(f)) 与 title:_scrubTitle(f,rows)，呼号脏值→"未知呼号"、其它脏值→"—"、标题脏则回退注册号/"未知目标 | 点该航班标题 N291SR、呼号 未知呼号、注册号/机型不变；点野火标记 68 MW 正常通过；截图 GLM-4V 复核卡片无连续 @；node --check 通过、编译零 error |
| 2026-10-24 02:32 | **收藏只存本地，重装/换设备即丢**<br>卸载重装或换手机后收藏全空 | utils/favorites.js 纯端内存储，无云端 | 新增云函数 gevUserData（按 OPENID 读写 gev_favorites/gev_settings/gev_subscriptions）；utils/favorites.js 改为"本地优先+云同步兜底+失败静默"，list/add/remove API 不变；index onShow 加 favorites.onSync(...)+sync() | mock wx 单测 4/4（本地优先/重装从云恢复/并集合并/云端挂掉本地照常）；MCP invoke 返回 {ok:false,"no openid"}（服务端无 openid 属正常，证明代码在线）；模拟器控制台零 error |
| 2026-10-24 02:32 | **gevHealth 探活一直 ECONNREFUSED，但业务接口正常**<br>gevHealth 探 47.104.22.0:64362 始终 ECONNREFUSED，而 godsEyeProxy 调 /api/wind 返回 200 真数据 | 后端早已迁到 CloudBase 云托管 https://gev-api-334102-12-1508335678.sh.run.tcloudbase.com，godsEyeProxy 用环境变量 GEV_BASE 指向它；gevHealth 用的是写死的旧家宽隧道地址（已失效） | gevHealth 默认 BASE 改为云托管地址，探 /api/sources/health | gevHealth invoke 返回 ok:true/200/126ms；并从 godsEyeProxy getFunctionDetail 取到 GEV_BASE 真值确认 |
| 2026-10-23 23:59 | **火场边界偶发被判 down**<br>perimeters 层健康状态时好时坏，偶发 down，但重新探测又正常。 | NIFC 上游偶发 502，单次探测失败就把整层判死。 | 探针遇 5xx / 网络错误重试一次再判 down。 | 火场边界稳定 200 · 110 个。 |
| 2026-10-23 23:59 | **卫星与军机层健康探针误判 down**<br>satellites / militaryFlights 在健康面板显示 down，但数据实际能正常取到。 | 探针直连上游 celestrak.org（腾讯云 TLS reset）与 api.adsb.lol/v2/mil（不通），而实际数据走的是自家代理端点。 | 卫星改探 /api/celestrak/stations（kind: text）、军机改探 /api/adsblol/mil；radio 三镜像同样改探自家聚合端点。 | 复测这些通道全部正常，健康面板 down=0。 |
| 2026-10-23 23:59 | **云端 /api/wind 恒返回 unavailable**<br>小程序切到 CloudBase 后 /api/wind 一直返回 unavailable:true，风场层全空。 | provider 的 GFS 走 noaa-gfs-bdp-pds.s3.amazonaws.com（AWS S3），从腾讯云上海出网不可达；ECMWF data.ecmwf.int 可达（3.5s/200），IFS 冷启动 12.7s、暖缓存 60ms。 | utils/layers/weather.js 默认模型 gfs 改为 ifs：const model = st.windModel === 'gfs' ? 'gfs' : 'ifs'。 | 28 项验收第 19 项：风场 IFS 200 · 360×181 格点。 |
| 2026-10-23 23:59 | **云端 /api/firms 报 fetch failed，野火层空**<br>/api/firms 返回 firms fetch failed and no cache available，野火热点整层没有数据。 | /api/area/csv/{key}/{source}/world/2 × 4 个源合计 100MB+，受容器出口带宽与 60s 超时限制四源全灭；mapkey_status 从容器侧 936/5000 正常，说明 key 与主机没问题，纯粹是体积/带宽。 | gev-cloudrun/server/providers/firms.js：源清单可配（默认 VIIRS_SNPP_NRT,MODIS_NRT，FIRMS_SOURCES 覆盖）、天数默认 1（FIRMS_DAYS）、串行拉取、单源超时 90s；无缓存时立刻返回 warming 并后台继续拉；lastError 回传；serve.mjs 监听后 2s 后台预热 /api/wind?model=ifs 与 /api/firms（GEV_WARMUP=0 可关）。 | 28 项验收第 15 项：野火热点 200 · 9241 个热点 / 2 源。 |
| 2026-10-23 23:59 | **/api/traffic-flow 400、国内路况返回 0 格**<br>/api/traffic-flow 直接 400；国内路况图层拿不到真实流速。 | 高德交通态势当日配额耗尽（USER_DAILY_QUERY_OVER_LIMIT，10044 次）；TomTom 流速在中国大陆无覆盖，只能按设计降级为路网模拟。 | 不改代码，按设计降级（大陆用路网模拟流速）；配额次日 00:00 重置。 | 00:00 配额重置后复测高德交通态势返回 9 格，链路本身正常。 |
| 2026-10-23 02:55 | **四色圆点被误判为腾讯 POI（更正）**<br>地图上出现深色圆环+彩色填充+白心的黄/绿圆点 | 初判腾讯 POI 是错的——形态与 assets/icons/cn_traffic_1..4.png 完全一致，是我们自己的路况采样点（绿畅通/黄缓行/橙拥堵/红严重） | 三重处理：一次性迁移 layerOn.cnTraffic=false（cnTrafficOffDone 只跑一次）；collect() 在 trafficNative !== false 时直接跳过 cnTraffic 层；enable-poi 保持显式 true 才显示 | cnTrafficOn=false、trafficNative=true、cn_traffic markers=0 |
| 2026-10-23 01:26 | **天气面板中英混排、预警等级是英文**<br>小标题 WEATHER，等级 minor/moderate/severe/extreme，境外坐标还回葡语 | 面板文案与等级枚举直接透出服务端原值，没有本地化映射；服务端 lang 未强制 | 小标题改「实况·预报·预警」；7 天标签改 今天/明天/周X；等级汉化 minor→蓝、moderate→黄、severe→橙、extreme→红；服务端强制 lang=zh | 定位福州 details 1 条预警 + 7 天预报全中文，横幅显示福州市气象台台风黄色预警 |
| 2026-10-23 01:22 | **真机所有请求失败（默认 127.0.0.1）**<br>真机首页与图层数据全失败，只有设置页自动探测可用 | 只有设置页提供自动探测，首页/图层仍用存下来的旧地址，真机默认 127.0.0.1 | api.js 新增 candidates() + failover()：按平台排序（工具 127.0.0.1 优先、真机局域网优先）逐个探 /api/setup/status（1.5s）命中即写；request() 连不上自动换址重试一次（_retried 防死循环）；app.js 启动后台跑一次 failover 不阻塞首屏；设置页显示「当前生效：地址」 | 真机与工具均取到数据；设置页显示生效地址；console 无 error |
| 2026-10-22 22:26 | **实时航班/军机一直陈旧（adsb.lol 走代理被 429）**<br>面板显示 STALE · adsb.lol · Source snapshot 46 min old，军机 1h 前 | start-dev.cmd 只把 opensky 放进 NO_PROXY，adsb.lol 全部走 Clash 7890 → 上游限流 429 → provider 只能吐旧快照 | start-dev.cmd 的 NO_PROXY 补 .adsb.lol,adsb.lol,api.adsb.lol,.adsb.fi,adsb.fi,.airplanes.live,airplanes.live,pocketworld.org,.pocketworld.org；start_gods_eye_hidden.vbs 改为直接调 start-dev.cmd（原来自己 set 环境变量漏了 NO_PROXY） | 直连(NO_PROXY) /v2/mil 200/215KB/2.9s、走代理 429/1.15s；重启后端后 /api/adsblol/mil 返回 214,522 字节实时数据 |
| 2026-10-22 | **高德个人 key QPS 太低，并发请求静默失败**<br>并发拉 13 个区县时部分请求无返回、无报错 | 个人 key QPS 很低，超限静默失败 | 串行请求 + 140ms 间隔 + 末轮补漏重试 | 13 区县全齐（448 段折线） |
| 2026-10-22 | **高德 district 用 adcode 参数只回全国**<br>按 adcode 查行政区，结果永远只返回全国一条 | adcode= 参数在该接口下失效（只回全国） | 改用 keywords= 传行政区名（如"福州市"），有服务端 24h 缓存 | 福州+13 区县逐条取到边界 |
| 2026-10-22 | **天地图新建 key 提交后表单被重置、接口报系统异常**<br>删除 Hermes1 后重建 Hermes-C / Hermes-Search 两次，提交即表单重置、接口回"系统异常 | 未查实，判断为天地图侧当日新建 key 限制 | 暂不新增，沿用可用 key accfdfea… 与 d5b0b311…（共 2 个） | 现有 2 个 key 可正常搜索/兜底 |
| 2026-10-22 | **天地图拿不到行政区边界**<br>天地图 v2 行政区接口调不通，福州市/区县边界拿不到 | key 是"浏览器端"类型，服务端调 v2 接口被拒；加 Referer 后 administrative 能通但不返回 polygon；控制台 console.tianditu.gov.cn 返回 000/502（连接被关闭）；用高德 key 调 district 只返回"中华人民共和国 | 改用高德 config/district 取边界，服务端缓存 24h；福州市+13 个区县全部拿到（448 段折线），首次 4s | 实测 448 段折线；后续 cnAdmin 层 lines 448、首次 5.5s 之后 0.01s（服务端缓存） |
| 2026-10-22 | **和风天气一直 403 Invalid Host**<br>/api/cn/weather 调 devapi.qweather.com 一直 403 Invalid Host，误以为是缺域名白名单 | 和风免费版必须先在控制台绑定专属 API Host（带域名的个性化 host），用公共 devapi 域名会被拒 | 登录和风控制台「设置」取专属 Host mk5u9ym9a8.re.qweatherapi.com，替换请求 Host，接入 /api/cn/weather（实况+预警） | 顶部品牌行出现天气胶囊（17° 雾 · 预警1） |
| 2026-10-22 | **卫星 TLE 用到 19 天前的旧数据**<br>卫星位置明显漂移，用的是陈旧轨道根数 | TLE 主通道（celestrak）在中国大陆不稳定，未优先用镜像 | TLE 镜像优先：GitHub raw → retlector → celestrak，失败依次降级 | 实测把 19 天前的旧 TLE 刷新到当天，2.1s |
| 2026-10-22 | **中国地震台网两个官方入口全挂**<br>地震图层取不到数据：news.ceic.ac.cn/ajax/google 空响应连不上；www.ceic.ac.cn/ajax/speedsearch 302 跳到 HTML 页 | 官方接口不可达/已改行为跳转页 | 换用 wolfx.jp 的 CENC 镜像 api.wolfx.jp/cenc_eqlist.json，新建图层"地震 · 中国地震台网"，按震级分色分大小 | 国内直连 1.1s 拿回 50 条官方记录（reviewed/automatic），最新 M4.1 四川绵阳北川 |
| 2026-10-22 | **subdistrict=1 时子区 polyline 为空**<br>一次请求连同子区查，市级有边界、区县全是空折线 | subdistrict=1 返回的子区不带动画/边界坐标 | 子区改为单独请求且 subdistrict=0 逐个查 | 13 个区县各拿到边界折线 |

### UI 与交互（47 条）

| 时间 | 问题 | 根因 | 落地解决 | 验证 |
|---|---|---|---|---|
| 2026-10-24 05:15 | **长文本/emoji 截断把代理对劈成乱码**<br>图层 hint、定位 toast 等按字符数截断时，末位 emoji 被切成半个代理对，显示为乱码方块 | 截断只按字符下标切，未判断 UTF-16 代理对边界 | cloudfunctions/godsEyeProxy/index.js 加 _safeTrunc（不劈开代理对），用于图层 hint(110)、搜索定位 toast(12)、预警定位 toast(14)、逆地理名称(40) | node --check 通过；selftest boot/marker_detail 全绿 |
| 2026-10-24 02:10 | **点野火后详情卡约 3 秒自己收起**<br>点野火 marker 详情卡正常弹出（68 MW / 9 行），约 3 秒后自己关闭；电缆层点开则不会。 | onMarkerTap 每次都把该图层切成单选 → soloLayers() 整层重取 → render() → syncSelectedDetail()；syncSelectedDetail 只用 f.key === selKey 找目标，而 fires/quakes/flights 的 key 带实时数值（fire:39.6188,113.5056:0），重取后 key 变了 → 判「目标已离开视野」→ 关面板 + toast。 | pages/index/index.js（24 行）：onMarkerTap 记 this.selRef = { layerId, key, lat, lng, label } 作坐标锚点；syncSelectedDetail 在 key 失配时按「同图层 + 坐标最近邻 <0.0025°（约 250m）」把要素认回来并把新 key 写回 selKey / selRef；closeDetail 与「确实找不到」分支清 selRef。 | 点野火 → 68 MW / 9 行 / sheet=true，6 秒后仍然在（修复前 3 秒被清空）。 |
| 2026-10-23 16:49 | **网格精度不可调，硬上限 24 列**<br>想要更细的风场网格只能吃默认值，高性能机也拉不满。 | 列数上限 24 硬编码在 weather.js，设置页只有 3 个固定 chip。 | utils/perf.js 每档新增 gridCols / gridMax / windArrows：高性能 16/40/420、均衡 12/30/320、省电 8/20/180；settings 网格精度改滑块（4~档位上限、step 1、绿色轨道），拖动中只回显、松手落盘并自动切固定网格，onWindGridChange 按档位上限 clamp，删掉失效的 pickWind 与 windOptions。 | 档位上限 mid 30 / high 40 / low 20；mid 拖到 36 存成 30、high 拖到 36 存 36；40 列细网格密布全屏、三色按风速；两端刻度对齐无换行。 |
| 2026-10-23 16:08 | **「风场箭头密度」三个 chip 点了完全没效果**<br>设置页风场配置分散在两处，「风场箭头密度」的低 6×6 / 中 10×12 / 高 16×18 三个 chip 点了没有任何变化。 | weather.js 的 windLattice() 靠 settings.windAutoDensity === false 才走固定网格，而全项目没有任何地方把这个值置为 false（默认 undefined）→ 永远走自动密度，chips 改的 windCols/windRows 从来没被读过。 | config.js 显式加 windAutoDensity: true；settings.js 新增 pickWindMode()（auto/fixed），pickWind() 连带置 windAutoDensity=false；settings.wxml 删掉独立「风场箭头密度」分组，重写成单一「风场配置」区块（采样方式/密度滑块/网格精度/说明），非当前模式的控件禁用并降透明度（.sub-row 缩进、.dim）。 | 自动模式：高亮「自动」、滑块可用显示 100%·自动、网格 chips 变暗；固定网格：滑块禁用、10 × 12 命中「中」；scale 6/390px 下固定 cols 10、自动 cols 9；档位联动 mid 9 / high 11 / low 6 列；布局无重叠无溢出。 |
| 2026-10-23 06:01 | **设置页三个开关点了没反应**<br>「只显示空中飞机 / 显示地面飞机 / 显示呼号」三个开关点了无反应，控制台抛 Cannot read properties of undefined。 | 这三行从原生 switch 换成 JellyToggle + 行级 bindtap 后，事件里没有 e.detail，而 toggleAirborne / toggleGround / toggleLabels 仍在读 e.detail.value。 | 改为：有 e.detail.value 就用它，否则按当前值取反。 | 三个开关实测恢复正常；设置页 6 个果冻开关逐一验证可切换。 |
| 2026-10-23 04:34 | **点一个要素把其它图层的开关全关掉了**<br>点地图上某个要素后，其它图层的开关全部变成关闭状态，退出单选还得手动一个个打开。 | soloLayers() 把 settings.layerOn 整个替换成只剩目标层（退出再从备份还原），把「渲染过滤」做成了「改配置」。 | 新增 this._soloIds；activeIds() 有 solo 时直接返回 _soloIds，否则走 settings.layerOn；只 refreshLayer() solo 的那几层，其它层 layerData 保留在缓存；exitSolo() 只清 _soloIds 并 refreshAll。 | onBefore=11 → solo 后 onStill=11，layers 始终 11；退出后 hud.activeLayers=11、solo=''。 |
| 2026-10-23 04:34 | **单选提示条浮在统计条上方压住 UI**<br>「仅显示 · 台风」提示条浮在统计条上方，压住了别的界面元素。 | .solo-chip 用 position:absolute; top:176rpx 硬定位。 | 改成 .hud-top 内的流式元素，紧跟 .stats 之下（margin-top:10rpx、width:fit-content）。 | 位置正好落在原来那条空带上，不再遮挡统计条。 |
| 2026-10-23 04:34 | **「没找到服务端」错误提示常驻不消失**<br>黄字提示条下面一直挂着「没找到服务端…」，服务端后来通了也不消失。 | 这句是启动探测失败时写进 pickHint 的，之后没有任何清理路径。 | refreshLayer 成功回调里检测到这条提示就清掉。 | 服务端恢复后提示条自动消失（自检时首屏 failedLayer 为空）。 |
| 2026-10-23 04:22 | **统计条下方多出一条空黑带**<br>HUD 统计条下面有一条空白黑带（用户截图红框标出）。 | .hud-top 的 padding-bottom: 22rpx 让渐变 scrim 溢出到卡片下方。 | .hud-top 的 padding-bottom 22rpx → 0。 | 截图确认黑带消失，统计条与下方内容贴合。 |
| 2026-10-23 04:22 | **单图层聚焦时 HUD 统计条还在说航班**<br>solo「仅显示·台风」时统计条第一列仍显示「实时航班 0」，第四列仍是「航班快照」。 | render() 里 hud.primaryLabel / primaryCount / snapshotLabel 只在全图层语义下取值，没处理 solo 状态。 | render() 中 solo 时 hud.primaryLabel / primaryCount 改为当前图层名 + 该层条数，snapshotLabel 显示「数据快照」，非 solo 仍为「航班快照」。 | solo 台风实测 hud.primaryLabel=台风、primaryCount=10、snapshotLabel=数据快照。 |
| 2026-10-23 04:15 | **分组总开关语义错，点一次全开后关不掉**<br>数据图层的组总开关点一下全开，再点不是全关；状态显示也和子项不一致。 | toggleGroupAll 的判定写成 turnOn = (onCount === 0)，与「总开关 = 全部子项都开」的语义相反。 | 改为 turnOn = !(onCount === total)；WXML checked="{{item.onCount === item.total && item.total > 0}}"；设置页新增「全部分类」总开关 .row-master，toggleAllCats() 全开→全关、否则全开，persist() 里重算 catsAllOn 让子项变化自动带动总开关。 | 事件组 7/7 点总开关 → 0/7，再点 → 7/7；关掉 cnQuakes → 6/7 且总开关显示为关；设置页 catsAllOn=true → 点总开关 false/0 → 打开 1 子项 false/1 → 再点 true/5。 |
| 2026-10-23 04:10 | **图层列表刷新时整排果冻开关一起抖**<br>每次图层列表重渲染，整排开关同时播一遍果冻动画，像被批量打开。 | observers.checked 无条件播动画，而图层列表每次刷新都会重建组件。 | observers.checked 里对比 _last，只有值真的翻转才播动画；圆点颜色改为关 #12171E、开 #FFFFFF（transition 350ms 同曲线）。 | 图层 beforeN=10 → afterN=11，added=["cnQuakes"]、removed=[]（只动自己）；设置分类 changed=["movement:false>true"]。 |
| 2026-10-23 04:10 | **全屏网页页 pages/full 打开是空白黑屏**<br>进入 pages/full 一片黑，没有任何提示，也不知道是加载失败。 | web-view 是原生组件，不能在其上叠加提示层，加载失败时既看不到网页也看不到兜底。 | 4.5s 内没收到 bindload 就撤掉 web-view，改显兜底面板（地址切换 / 复制地址 / 用原生图层 / 说明）。 | pages/full 实测兜底面板生效（自检时该页 err 为空）。 |
| 2026-10-23 03:56 | **开关控件三套实现、风格与交互不统一**<br>设置页 6 处原生 switch、图层分组标题右侧 .gswitch、每层右侧 .layer-dot 三种开关并存，样式各异且没有动效。 | 各页面各写各的开关，没有共用组件。 | 新建 components/jelly-toggle：轨道 .jt 灰 rgba(38,48,62,.92) → 黄 #F7D247，transition background-color 350ms cubic-bezier(0.34,1.56,0.64,1)；滑行 .jt-knob translateX(36rpx) 同曲线；切换时 .jt-blob 加 .jelly 播 jt-jelly 350ms（scaleX 1 → 1.42 → 0.88 → 1）；尺寸 md 84×48rpx / sm 72×42rpx；.jt pointer-events:none 把点击交给父行；替换设置页 6 处 switch 与图层列表 .gswitch / .layer-dot，原本只有 switch bindchange 的三行补行级 bindtap。 | 图层列表移动目标 0/8 灰、事件 7/7 黄；设置页 POI 灰、腾讯原生路况黄且行布局未错位；点击 cnQuakes true→false，行点击仍生效、组件不吃事件。 |
| 2026-10-23 03:48 | **坞贴边收起后无法再唤起**<br>坞自动贴边后只露一条边，点不到也滑不出来，等于消失。 | .dock-edge-hit 热区没有触摸处理，只有 catchtap 且未覆盖滑动。 | .dock-edge-hit（96rpx×260rpx 透明热区）新增 catchtouchstart / catchtouchend：向内滑 >20px 且纵向 <40px → openDock()，轻点仍走 catchtap；方向按 dockEdge 判定。 | 坞拖到 x=60（左侧）后向内轻滑 → dockOpen:true；dockPos 由 15.6 归位 7.5 贴边。 |
| 2026-10-23 03:48 | **坞与态势面板自动收纳时间不一致**<br>坞 8 秒收纳、态势 6 秒收纳，两个侧边控件节奏不统一。 | cfg.DOCK.holdMs = 8000 与 armIdle 的 6000 分别写死。 | cfg.DOCK.holdMs 8000 → 3000（openDock / dockLocate / dockRefresh 都重置计时），armIdle 6000 → 3000。 | openDock() 后 4s 查询 dockOpen:false；态势展开后 4s 查询 peek:true。 |
| 2026-10-23 03:45 | **没选目标时侧边看不到「态势」把手**<br>冷启动（未选中任何目标）时状态栏里根本没有「态势」把手，用户「默认露出」的要求落空（实测 avis:false）。 | awareness-hud 整块由 awareness.visible 控制，而 visible 只有在选中目标时才为 true。 | 宿主改 wx:if="{{!hidden}}" 只受详情页开关影响；组件 peek 初值 false→true（一进页面就是收起态）；展开时 triggerEvent('open') → 页面 openAwareness()：有选中目标就 updateAwarenessHud()，没有就填 subjectMissing:true 的空面板（罗盘 + 「未选目标：点选航班/军机/舰船/军事设施启用」），绝不出现空白框。 | 冷启动 peek=true、side=right、avis=false，右缘可见竖排「态势」；点开 peek=false、avis=true、missing=true，面板显示罗盘与未选目标提示且把手消失；再收起 peek=true 把手回归。 |
| 2026-10-23 03:38 | **风场密度没有用户可调项**<br>用户无法按设备/偏好调风场疏密，只能吃默认值。 | 密度纯算法推导，未暴露设置项。 | 设置页新增「风场密度」滑块：50%~200%、步进 5%、默认 100%、黄色滑块 #F7D247，bindchanging 实时回显数字、bindchange 落盘 settings.windDensity；间距 = base/(density/100)，行数上限 12→30、总数上限 130→240；回地图 onShow 检测到设置变化即 refreshAll(true)。 | 60% → 32 个、100% → 162 个、150% → 200 个。 |
| 2026-10-23 03:28 | **面板只支持点按钮展开，侧边滑动无响应**<br>贴着屏幕边缘向内滑，面板不出来，只有点把手这一条路。 | 没有边缘热区和滑动手势处理。 | 新增 .aw-edge-hit 26px 热区 + onEdgeSwipeStart/onEdgeSwipeEnd，向内滑动 >24px 且纵向位移 <40px 判定为展开。 | 侧边内滑 (2 → 90px) → peek=false，面板展开。 |
| 2026-10-23 03:28 | **态势把手只能贴右缘、换边后不记忆**<br>面板只能从右侧出来，拖不到左边；重启小程序又回到右侧。 | side 状态没持久化，没有拖拽判定逻辑，左侧镜像样式缺失。 | 按住把手拖动时跟手，松手按屏幕中线吸附到最近一侧（side: left／right），写 wx.setStorageSync('gev_aw_side')；左侧镜像 .aw-host.left 贴左边、border-radius 0 9 9 0。 | 拖动把手 → side=left、peek=true，左缘只显示竖排「态势」，坞仍在右侧（截图 both_left.png）；重启后仍在左侧。 |
| 2026-10-23 03:28 | **定位/刷新坞换边后不持久化**<br>坞拖到屏幕另一侧，下次进页面又回到原来那侧。 | 换边只改了内存里的 dockPos，没有写 settings。 | dockTouchEnd 里按 dockPos.lx < 50 判定 → settings.dockEdge 落盘（store.saveSettings）。 | 拖动 x=360→60 → dockEdge right→left、dockPos.lx 15.6 → 归位 7.5、dockOpen false，下次进入仍在左侧。 |
| 2026-10-23 03:19 | **首屏默认开启的图层不符合规则**<br>进页面就打开一堆图层（航班、舰船等），与「事件 + 气象默认开、其余全关」的要求不符。 | DEFS 里各图层的 defaultOn 是历史上随手设的，没按分组规则重排。 | 重排 DEFS 的 defaultOn：默认开 11 层（earthquakes/cnQuakes/fires/perimeters/launches/cyclones/cnTyphoon/wind/radar/clouds/lightning），默认关 20 层；加 layerDefaultsV2 标记一次性重置旧存档，之后用户手动开关照常保存。 | 刷新后 layerOn 正好 11 层。 |
| 2026-10-23 03:19 | **详情页显示的是别的图层/别的目标的数据**<br>点开某一要素，详情页标题和字段却是另一个图层、另一个目标的。 | marker id 是每次渲染从 1 递增的序号；15~30s 刷新一次后点位顺序变化，界面上点到的 id 已指向别的要素。 | 改稳定 id：stableMarkerId(f.key)（FNV-1a → 1..2e9），同一航班/卫星刷新前后 id 不变，byId 只按稳定 id 建索引；新增 syncSelectedDetail() 按 selKey 重新找要素，还在就刷新详情（有变化才写），已离开视野才收起并提示「目标已离开视野」。 | 选中 STARLINK-6199（sat:56551）等 26 秒跨多次刷新，selKey/标题/字段不变、rows 10~12；卫星/航班/电缆三类字段互不串味。 |
| 2026-10-23 03:19 | **详情页「数据源」出现两行**<br>详情卡里「数据源」字段重复显示两行。 | 部分适配器的 detail 里已经带了「数据源」，页面渲染时又追加一次。 | 页面追加前先做字段去重。 | 卫星/航班/电缆三类详情里「数据源」均只有 1 行。 |
| 2026-10-23 03:19 | **吸边时面板与右缘按钮同时出现**<br>收起态仍能看到面板本体，右缘「态势」按钮和面板同时出现在屏幕上。 | peek 态只做了位移，没做透明度/命中控制；把手在展开态也没隐藏。 | .aw-wrap.peek → translateX(200px) + opacity 0 + pointer-events none；.aw-tab 只在 peek 时 opacity 1，展开后自动隐藏。 | 吸边后屏幕上只剩右缘竖排「态势」按钮，展开后把手消失。 |
| 2026-10-23 03:07 | **态势感知面板常驻占屏且与坞重叠**<br>态势面板一直浮在屏幕上，压住坞按钮；打开详情页时还盖在详情卡上。 | 面板没有吸边/收纳机制，也没接详情页的显示状态。 | 页面传 hidden="{{sheet}}"（详情打开即收边隐藏）；空闲 6s 自动吸附屏幕右缘 .aw-wrap.peek translateX(166px) 只露 16px；右缘竖排「态势」把手点击展开，卡片上左滑收起、右滑展开；有操作重新 armIdle() 计时。 | 展开态完整显示罗盘/三行计数/上一目标-下一目标；8s 后自动吸边且把手不压坞按钮；sheet:true 时整块消失。 |
| 2026-10-23 02:55 | **4 个图层的图标与别的图层撞图**<br>图层列表里国内路况与降雨雷达、火场边界与野火热点、近期影像与卫星云图、中国地震台网与 USGS 地震用的是同一张图标，视觉上分不清是哪个图层。 | KIND_ICON 图标映射直接复用了同组图标，没有按「一图层一图标」做过审计。 | 新增 4 张图标 cntraffic / perimeter（橙色虚线多边形）/ imagery（蓝色图框）/ seismic（红色地震波形），每张都生成 ui、dark、tint、tint_d、tint_s 五套，并写入 KIND_ICON / KIND_ICON_DARK / KIND_TINT_LIGHT / KIND_TINT_DARKBG / KIND_TINT_SEL；只保留 cyclones 与 cnTyphoon、directions 与 measure 两处同图（同一现象 / 非数据图层）。 | 校验脚本遍历所有 kind 引用的 PNG，缺失 0。 |
| 2026-10-23 02:09 | **预警卡定位按钮随框宽漂移**<br>不同宽度预警框里「点击定位」位置不一致 | 原来用「时间范围 ／ 点击定位」左右分栏，按钮位置取决于左侧内容宽度 | 卡片改两行：时间范围单独一行，下一行只放右对齐「定位 →」（21rpx 金色描边胶囊），与台风横幅同位置同字号 | 注入橙/黄/蓝三条预警，三个「定位 →」都贴各自框右下角 |
| 2026-10-23 02:02 | **风场三档箭头形状不一致**<br>arrow_cool/warm/hot 轮廓有细微差异、空心状态不同 | 三张图分别制作，未共用轮廓 | 取同一 alpha 轮廓 → 四角洪水填充把空心箭头填实 → 三色填充 + 统一 1px 深色描边 rgba(12,16,22,210) | 三图仅 RGB 不同，轮廓/大小/描边完全一致 |
| 2026-10-23 02:02 | **预警框永远红色，只有徽标随等级变色**<br>黄橙蓝预警的框体都是红的 | .wx-alert 边框、底色、色条写死红色，没按 item.level 走 | .wx-alert 按 level 上色（左 8rpx 色条 + 边框 + 底色 + 标题同步）：red #FF4D4D、orange #FF963C、yellow #F7D247、blue #5AA0FF | 注入四色预警：台风红、暴雨橙、雷电黄、大风蓝，一一对应 |
| 2026-10-23 01:40 | **同一条预警在横幅和列表重复出现**<br>横幅已展示的预警，列表又出现一份 | 列表直接用服务端 alerts 全量渲染，没排除横幅已展示那条，也没按标题去重 | alerts 先按 title／type 去重；列表改用 weatherRest（非极端项），标题从「预警 · N（含极端 M）」改「其他预警 · N」，只有一条极端预警时下面整块不出现 | 福州实测 all=1 extreme=1 rest=0，界面只有一个黄色预警框且带台风图标 |
| 2026-10-23 01:22 | **天气面板右侧内容被裁**<br>展开天气面板后四宫格与 7 天预报溢出右边界被切 | .wx-m 的 width:50% + flex 子项默认 min-width:auto 把容器撑宽 | .wx-metrics{width:100%;max-width:100%;overflow:hidden}、.wx-m{min-width:0}、.wx-mv{flex:1;min-width:0;text-align:right}、.wx-day{overflow:hidden}，面板宽 calc(100vw - 32rpx) | metrics 右边界 371.6 < 面板 382.4；截图完整 |
| 2026-10-23 00:22 | **图层列表图标与地图 marker 图标对不上（4 处）**<br>路况列表雷达而地图车辆、军事设施列表通用设施而地图盾牌、实时航班列表客机而地图通用机、测距列表信号塔而地图大头针 | 列表取 R.iconFor(LAYERS[id].icon)，marker 的 kind 由适配器决定，两边各写各的；国内路况地图用 cn_traffic_1..4 分色图而列表写死 radar | DEFS icon 分别改 car/military/plane_unknown/pin；LAYERS.cnTraffic.iconPath='/assets/icons/cn_traffic_3.png'，渲染处 iconPath: L.iconPath ／／ R.iconFor(L.icon)；同类概念共用图标：cn.js 两处 tornado 改回 cyclone、中国地震台网 seismic 改回 quake | 运行时比对脚本 checked=6，除 wind（同层三档箭头特例）全部一致；cn.js 残留 tornado/seismic 0 处 |
| 2026-10-23 00:12 | **点 marker 只变暗不出详情卡 + 详情行数值溢出**<br>点 marker 全屏遮罩变暗但底部卡不出现；详情行右侧长数值贴边溢出 | onMarkerTap 只 setData({sheet:true}) 没走 _sheetTo(true)，抽屉仍 translateY(100%)；.row-v 只有 max-width:66% 无 min-width:0，flex 不肯收缩 | tap 后补 this._sheetTo(true)；.row-v 改 flex:1;min-width:0;word-break:break-word，.row-k 收窄 30% | sheetTf=translateY(0px)、详情 14 行、标题 GTI8701，无溢出 |
| 2026-10-22 23:44 | **浅色底图下白色图层图标看不清**<br>腾讯默认浅色底图上白模图标糊在米色陆地，几乎认不出 | 只有一套白模且无描边，仅深色卫星底图对比度够 | 同一份白模做 alpha 外扩 2px 的 #060A0F 描边层再压白模，58 个图标输出 assets/icons/dark（241KB）；settings.iconMode 新增 auto（普通/路况走描边、卫星走白模），iconModeFor() 并入 geoSig()，pickBasemap() 显式清 geoSig 再 render，旧存档用 imAutoDone 一次性迁回 auto | pickBasemap('satellite') → ui/satellite.png；('normal') → dark/ui/satellite.png；KIND_ICON 42 key 对 KIND_ICON_DARK 42 key、0 缺文件 |
| 2026-10-22 23:36 | **字号散成 17 种 + 场景标签换行不齐**<br>全站 16~44rpx 共 17 种字号层级不清；场景标签换行、右下边距不齐 | 样式无字号令牌；标签用 flex-wrap:wrap + margin 拼间距；index.wxss 第 388/250 两处 .scene-row{flex-wrap:wrap} 覆盖新样式 | 字号归一 6 档 18/21/24/26/32/40rpx（≤19→18、20-22→21、23-25→24、26-27→26、28-33→32、≥34→40），改 5 个 wxss；标签改 scroll-x 单行 + nowrap + inline-flex，24rpx 字/56rpx 高/0 24rpx 内边距/12rpx 间距，隐藏滚动条，改掉两处 flex-wrap | 实测 21rpx 83 处、24rpx 46、18rpx 23、26rpx 17、32rpx 9、40rpx 7，无杂项；applyScene('航空') 31→4 层、allLayersOn() 回 31 层 |
| 2026-10-22 23:23 | **设计令牌 @import 后分组标题 Sticky 失效**<br>图层分组标题不钉顶，滚动时跟着内容走（滚到 1260 才发现） | styles/design.wxss 用 @import 放最前，index.wxss 第 621 行 .group-head{position:relative} 后写覆盖了 sticky | index.wxss 末尾再声明 .group-head{position:sticky;top:0;半透明底;backdrop-filter:blur(8px)} | setData sheetScrollTop 1180→1260，标题「摄像头 2/2」钉在内容区顶部不动 |
| 2026-10-22 21:40 | **玻璃层高光变成灰白渐变 + 顶栏胶囊错位**<br>::after 112° 斜向高光在浅色底上成一块灰白渐变压住图标；主题胶囊与天气胶囊上下错开，右侧时间/底图被挤偏 | 高光是自己加的 GLASS SHEEN（覆盖上半部 opacity .75）；错位真因是老规则 .brand-text,.pill,.btn,.tip{white-space:normal;word-break:break-word} 让天气文案在胶囊内折行，胶囊高度翻倍 | 整段删除 GLASS SHEEN，只留 inset 0 1rpx 0 rgba(255,255,255,.30) 内高光；末尾追加 .bar-row{flex-wrap:nowrap}、.bar-left/.bar-right 强制 row+nowrap+column-gap:10rpx、.pill{nowrap;ellipsis;line-height:1}；右侧统一 .upd-chip 72rpx 与 .bm-btn 72rpx、.bm-ico 42rpx | compile_wxss success、console grep error/invalid 为空；截图顶栏单行（主题+天气｜刷新+底图），右侧两控件同高同轴 |
| 2026-10-22 19:30 | **坞内定位按钮点不动（先误判为 data-dockbtn 缺失）**<br>点胶囊里的 GPS 图标，什么都没出现，面板还自己缩回去 | 先按 19:30 判断为 data-dockbtn 只挂在按钮外层 view 上、touchend 的 e.target 是 <image class="dock-ico"> 判成"点空白"→面板收起；最终真因（20:10 查实）：.dock-zone 上的 catchtouchstart/catchtouchmove/catchtouchend 拦下 touch 序列后，子按钮依赖的合成 tap 在真机上不再派发，catchtap 永远不触发。多次误判源头是 automation_element_action tap 直接派发 tap、绕过 touch | （19:30 补）data-dockbtn="1" 挂到 .dock-panel 和两个 image；（20:10 根治）按钮改用 bindtouchend="onDockBtnEnd" 触发、catchtap 保留兜底、两者 400ms 去重，拖动后（_dockDrag.moved）不算点击；定位优先走 mapCtx.moveToLocation() 再用 getLocation 精确 jumpTo | 改用真实 touchstart+touchend 序列测：chip=已定位 -15.783,-47.917、scale=15、dock 保持展开、_lastDockAct=locate |
| 2026-10-22 19:15 | **自动定位被用户否决，回退为"只展开**<br>点胶囊自动跳转不符合用户预期 | 产品决策：用户明确要求点定位按钮才跳转 | 回退 .dock-edge-hit 的 catchtap 为 openDock，dockTap() 收起态也只 openDock()；删除 openDockAndLocate() 防误用；dockLocate() 里点完重开 8s 自动收回计时；cfg.DOCK.holdMs 4500→8000 | dockTap()→dockOpen=true、chip=''、scale 5（只展开不跳）；dockLocate()→chip=定位中…→region 为定位点 scale 15 |
| 2026-10-22 19:05 | **收起态点胶囊"点了没反应"，什么都没发生**<br>用户点黑边后没有提示条、地图也不动 | 收起态 .dock-zone:not(.open) .dock-btn{pointer-events:none}，点黑边只命中 .dock-edge-hit → openDock()，只展开不定位；用户以为那个圆点就是定位按钮 | 新增 openDockAndLocate()（openDock()+locate()），.dock-edge-hit 与 dockTap() 在收起态都走它；另加右下状态条（定位中…/已定位 x,y/定位失败：errMsg，6 秒消失） | 点黑边 → dockOpen=true、chip=定位中… → 已定位 -15.783,-47.917，region=scale 15，蓝点在画面中心 |
| 2026-10-22 18:30 | **WXML 里 {{x}}px 缺兜底渲染成 undefinedpx**<br>数据未到位时样式值变成 undefinedpx，出现 unsupported property 告警 | padding-top: {{capsuleTop}}px / height: {{capsuleH}}px / globe 页 glH 均无默认值 | 全部加默认值：{{capsuleTop ／／ 26}}、{{capsuleH ／／ 32}}、{{glH ／／ 32}} | 刷新后控制台不再出现 undefinedpx 相关告警 |
| 2026-10-22 17:20 | **顶部 HUD 被推到微信胶囊下面，左上留空带**<br>「上帝之眼」在系统胶囊下方，与胶囊同高的那条空白带一直空着 | .hud-top 的 padding-top = statusBarHeight + capsuleGap，而 capsuleGap 是"胶囊底部+8"，整个 HUD 被推到胶囊下方 | 把胶囊 top/height 存进 data（capsuleTop/capsuleH，来自 wx.getMenuButtonBoundingClientRect）；.hud-top padding-top=capsuleTop；新增 .brand-line 高=capsuleH、padding-right:208rpx 让出胶囊位；主题/天气移到第二行 .bar-left | 368×793 实测 ● 上帝之眼 与系统胶囊同一水平线（y 51–83），第二行 琥珀 ｜ 17° 小雨 ｜ 16:56 ｜ 3D 场景 均匀分布无重叠 |
| 2026-10-22 17:20 | **行政区图层一屏黄黑圆点**<br>宁德一带 9 个区县中心各一个黄环黑心 marker，挤成一屏圆点，盖住边界线 | utils/layers/cn.js 的 cnAdmin 给每个区县中心 push 了 iconPath:/assets/icons/cn_admin.png 的 marker | 删除该段 marker 生成，行政区只保留边界线（市界黄、区县界青） | 实测 cnAdmin points 0 / lines 448，截图只剩边界 |
| 2026-10-22 17:00 | **顶部品牌行与天气胶囊重叠**<br>品牌行、天气胶囊、更新时间/3D 场景在视觉上叠在一起 | 不是宽度问题，是 index.wxss 里 .bar-row 有两条规则：后一条旧的 flex-wrap: wrap; min-height: 64rpx 覆盖了新的单行规则 → 品牌行被强制换行 | 删掉重复的 .bar-row 块只留 flex-wrap:nowrap；结构改为左「品牌+主题」右「天气+时间+3D 场景」，.pill 加 flex:0 0 auto + nowrap，.brand 加 overflow:hidden + min-width:0；nowText() 由 HH:MM:SS 改 HH:MM；时间胶囊降级 18rpx/#6E7C8C | 368×793 实测单行完整：上帝之眼 琥珀 ｜ 18° 小雨 16:47 3D 场景，右侧距微信胶囊≥8px，无重叠无截断 |
| 2026-10-22 | **胶囊收起态点那条黑边没反应**<br>坞胶囊收起后露出的黑边，手指点上去不展开 | 点击判定挂在被 translateX 移出屏幕的元素上，露出的那条边落在该元素框外侧，不算命中 | 新增独立透明命中区 .dock-edge-hit（右缘 96rpx×260rpx，z-index 61）；dockTouchEnd 内再判一次点击（位移<6px 且 <500ms）双保险；状态只读 this.data.dockOpen | 点右缘胶囊完整弹出，GPS+刷新都在屏内；命中区实测 341.4~390.4 × 565~700 |
| 2026-10-22 | **胶囊拖出去再吸附会往上跑**<br>把坞胶囊拖到别的高度后松手，吸附后位置往上跳，不在预期高度 | 吸附时保留了拖动过程中的临时高度值 | 松手只决定吸附左/右，位置一律写回默认值；自动收起同样回默认位 | 收起态 panel 376.1~436.1（屏宽 390），peek 75 时露出约 14px |

### 性能与 setData（20 条）

| 时间 | 问题 | 根因 | 落地解决 | 验证 |
|---|---|---|---|---|
| 2026-10-24 05:15 | **相同并发 GET 重复调用云函数浪费配额**<br>页面多处同时请求同一接口，触发多次云函数调用，配额消耗高、冷启动叠加 | utils/api.js 的 request 无并发去重，每个调用各自发起 | utils/api.js request 加单飞(in-flight dedupe)，相同并发 GET 复用同一 Promise | 4 文件 node --check 通过；后续 selftest 全绿、控制台零 error |
| 2026-10-24 05:15 | **服务端风场 finally 无条件 abort + 大网格 O(n) 全量校验**<br>风场接口成功返回后仍被 abort，白做取消；大网格每点 Number.isFinite 全量遍历拖慢响应 | wind.js finally 里无条件 controller.abort()（成功路径也执行）；hasNonFinite 用 every(Number.isFinite) 走全量 O(n) | gods-eye-view/server wind.js：finally 去掉无条件 abort（取消交给 close()/fetch）；改为有界抽样 hasNonFinite（≤~4096 点+末点必查） | node --check 通过；重启本地 4173 后 wind 网格 521280 字节、stale:false；CloudRun gev-api 013 部署后生产 wind 网格返回 521280 字节，devtools 开风场 270 点、error 空 |
| 2026-10-24 04:45 | **辅助定时器泄漏，页面卸载后仍 setData**<br>page 卸载后计时器仍在跑，触发 setData 报错/内存滞留 | _renderTimer/_resizeTimer/_saveRegionTimer/_flyTimer 等十余个定时器没有统一清理入口 | index.js 新增 stopAuxTimers()（清 _renderTimer/_resizeTimer/_saveRegionTimer/_flyTimer/_flyEndTimer/_locTimer/_dockTimer/_dragPlanTimer/_bounceTimer/_aliveTimer），onHide/onUnload 调用 | node --check 通过；devtools 刷新与 selftest 全绿，控制台零 error |
| 2026-10-24 04:45 | **回前台时设置"变了"误判，触发全量刷新风暴**<br>从后台切回小程序，即使设置没改也会整页 refresh，请求风暴 | 设置比对用 JSON.stringify，对象键顺序不同即判为变更 | pages/index/index.js 改为按键排序的稳定签名 _sigOf，_lastSettingsSig 基线首帧不刷，仅真变更才全量 refresh | devtools 刷新控制台零 error；selftest 13 项全绿 |
| 2026-10-24 02:32 | **栅格层与主层同批刷新，抢首屏带宽**<br>首屏要等 4 个栅格层一起回来才出图，主层被拖慢 | index._refreshAllInner 把所有图层放在同一批并发请求 | _refreshAllInner 把 4 个栅格层拆出首屏阻塞，+300ms 补图 | 模拟器渲染正常，首屏不再等栅格层 |
| 2026-10-24 02:32 | **云函数未要求 gzip，大端点原样传输**<br>/api/flights 等大端点传输体积大，弱网首屏慢 | godsEyeProxy 的 fetchUrl 未声明 Accept-Encoding，上游回未压缩正文 | godsEyeProxy fetchUrl 加 Accept-Encoding: gzip,deflate + zlib.gunzipSync（失败回退原文） | /api/flights gzip 后 180KB→14.8KB(≈-92%)；本地端到端解压正确；模拟器渲染正常 |
| 2026-10-23 15:04 | **所有设备跑同一套渲染参数**<br>高低端机共用一套 DPR/帧率/图层上限/风场密度，高端机跑不满、低端机卡。 | 没有任何设备性能识别与分档机制。 | 新增 utils/perf.js：判定链为 手动档位 → iOS 机型代号（iPhone17,x → A19）→ Android benchmarkLevel → 旗舰关键字表 → 内存 → 兜底 mid，开发工具固定按 mid；三档参数（高性能 DPR2/60fps/1200/1.3×/130%/95ms/1.2×；均衡 1.5/30/800/1.0/100%/150ms/0.8×；省电 1/30/420/0.65/70%/240ms/0.45×）；接线 settings 卡片（四档+重新检测）、index totalCap() 乘系数加天花板、weather.js 风场密度走 perf.windDensity、globe.js 的 dprMax 与线条数、config.js 新增 perfMode:'auto' 与 windDensityAuto。 | 工具识别 iPhone 12/13 (Pro)·均衡，摘要 DPR 1.5 / 30fps / 800 / 100% / 96 段；切高性能 DPR2/60fps/1200/130%/128 段；切省电 DPR1/30fps/420/70%/64 段；3D high → dprMax 2、lines 29，low → dprMax 1、lines 12；风场 auto 100 / high 130 / low 70 / 手动 175。 |
| 2026-10-23 14:38 | **3D 地球弱设备帧率掉到 5~14**<br>3D 地球在弱设备/软件渲染下单帧 60~190ms，帧率 5~14，拖动明显卡顿。 | DPR 固定取设备像素比（2）导致渲染像素量翻倍，且没有自适应降档机制。 | pkg/globe/globe.js：dprMax = min(iOS?1.5:2, devicePixelRatio)、dprCur = dprMax；判定依据改用单帧渲染耗时 spend 而非 rAF 帧率（窗口被遮挡时 rAF 被节流到 1~2fps）；暖机 6s 内不调整；spend>34ms 连续 3s → dprCur -= 0.5（最低 1）；spend<12ms 连续 6s → +0.5（上限 dprMax）；只调 renderer.resize 不重建场景，变更写 hud.diag；保留 wx.onError 打印 [globe-err] 堆栈。 | 进入 8s：dpr 2 / spend 193ms 不降档；进入 26s：dpr 1 / spend 183ms（2→1.5→1）；截图地球/轨道/目标点清晰无报错条。 |
| 2026-10-23 03:07 | **全图层打开时 setData 堆队列、动画卡顿**<br>多图层同时开启时风场动画一卡一卡，帧间隔跟不上。 | 实测 setData 耗时不在字段数而在 markers 总数：36 marker/160 字段 37ms、128 marker/256 字段 44ms、1386 marker/196 字段 767ms——每次 setData 都要 diff 整个 markers 数组，而节拍是固定值。 | 节拍按 markers 总数分档：≤260 → 95ms（≈10 帧/秒）、≤600 → 150ms、>600 → 240ms。 | 单图层聚焦（100 来个 marker）跑满 10 帧/秒；全图层同时开自动降速，不再堆队列。 |
| 2026-10-23 02:36 | **风场动画一卡一卡（看着几分钟才动一下）**<br>风场箭头明显卡顿、不连续 | setInterval 1300ms + 相位步进 0.10 → 每循环 13s，每帧只挪约 0.35px | TICK_MS=100（10 帧/秒）、CYCLE_MS=1600（约 20px/s），相位步进按 TICK/CYCLE 计算不写死；粒子上限 110→70；alpha 只在 ／Δalpha／>0.06 的头尾段写 | 每 100ms 采样同一粒子经度步长恒为 +0.102°、无停顿，末尾循环回起点 |
| 2026-10-23 02:09 | **预警定位后仍渲染全部图层（慢且乱）**<br>点预警「定位」飞到位置后仍带 20+ 图层，实测 767 marker | 跳转只做 flyTo，没有收敛图层，layerOn 仍 28 层 | layersForAlert() 把预警类型映射到图层（台风/气旋→cnTyphoon、地震→cnQuakes、雷电→lightning、森林火险→fires）；跳转后 soloLayers([该层], 名称) 只留一层并清缓存重刷；左上「仅显示 · 台风 恢复全部图层」可 exitSolo()；无对应图层的预警（暴雨/高温）不做 solo | 福州台风黄色预警定位：layerOn 28 层 → ['cnTyphoon']，markers 767 → 6，region 21.7/124.4 |
| 2026-10-22 22:49 | **逐帧 setData 跑弹簧动画把页面卡成 PPT**<br>按 Feel 参数逐帧 setData 驱动坞/抽屉弹簧动画，页面卡顿不可用 | 模拟器实测本页单次 setData（只改 sheetTf 一个字段）约 700ms，8 次共 5659ms；页面含 31 行图层 + scroll-view | 新增零依赖 utils/motion.js（FEEL 预设 + 半隐式欧拉 spring + settleMs 只算时长）；位移交给 CSS transition：dock 171ms cubic-bezier(.2,.9,.25,1)、sheet 392ms cubic-bezier(.22,.9,.28,1.02)；index.js 加 _measureMotion/_dockTo/_sheetTo，wxml 绑预拼 dockTf/sheetTf | dockW=60px、sheetH=565px、收起 dockTx=45px、打开 dockTf=translateX(0px)、sheetTf=translateY(0px)；截图坞与抽屉完整弹出 |
| 2026-10-22 19:50 | **15s 定时刷新叠加并发，主线程焊死导致点击被丢**<br>26 层全开时一轮 10s+，定时器继续叠加，界面点击无响应（这也是"点定位没反应"的来源之一） | refreshAll() 无并发闸门，15s 定时器在上轮未结束时又发起新一轮，叠成 2~3 层并发 | refreshAll() 增加 _refreshing 闸门：上一轮没结束不叠加 | 叠加消失；当前主包 0.985MB、分包 0.74MB |
| 2026-10-22 18:20 | **/api/launches 单次 712KB**<br>发射计划接口体积 712KB，弱网慢、占带宽 | 服务端返回上游完整对象，小程序只用少数字段 | 新增 ?slim=1 只回 id/slug/name/net/window_start/window_end、pad{name,lat,lng,location.name}、mission{name,orbit{name,abbrev}}、status{name,abbrev}、rocket{configuration.name,payloads[].name}、launch_service_provider{name}、image{image_url,thumbnail_url,name}；slimMemo 按源文本只转换一次；网页版仍取完整对象 | full=728,894 → slim=15,091（48×），叠 gzip 约 4KB；小程序佛州视口 matched=3，详情行（名称/状态/T-0/窗口/火箭）正常 |
| 2026-10-22 18:00 | **风场/气旋/发射首个用户要等冷启动**<br>第一个打开慢层的用户承担全部首次取数耗时 | 服务端启动后无预热，缓存全靠首个请求填充 | server/standalone/mini-speedup.js 的 warmupPlugin：启动 1.5s 后后台预热 /api/wind?model=gfs、/api/cyclones、/api/launches、/api/celestrak/stations | 首个用户点开时缓存已建好 |
| 2026-10-22 18:00 | **气旋层每次缓存过期都白等 NHC 6 秒**<br>cyclones 层端内 6.3s，打开就转圈 | TTL 5min 到点即同步重取，NHC 在大陆出口 6s+ | TTL 5min→30min，并改 stale-while-revalidate：过期但仍有旧数据立刻返回旧数据，后台去 NHC 拉新 | 过期时不再阻塞等待，层内耗时不再出现 6s 空等 |
| 2026-10-22 18:00 | **卫星层逐颗 SGP4 计算耗时 3.85s**<br>satellites 层端内 3.8s，360 颗全部参与计算 | 不论缩放层级都对全部卫星做 SGP4 + TLE 解析 | 加缩放下限：scale<5 → 60 颗、<7 → 150 颗、否则 400 颗，再与设置 satelliteMax 取小 | 该层 3.85s → 1.72s（含 gzip 与 TLE 缓存） |
| 2026-10-22 17:40 | **一轮刷新 render 调用 38 次，纯主线程约 3.4s**<br>31 层全开时每次刷新卡顿，点击被吞 | 每层数据回来就整页重算（单次 90~184ms×38），没有合并与早退 | scheduleRender() 250ms 合并；geoSig() 签名（图层 updatedAt+选择+缩放+旋转+轨迹点数）没变直接 return 不跑 collect()；折线 thinPoints() >240 点等距采样 | render 38 次→17 次；几何没变 0ms、变了 ~150ms；首屏 firstPaint 757ms |
| 2026-10-22 17:40 | **snapshot 每层 setStorageSync 阻塞主线程**<br>保存快照时每层同步写盘，600 点时单次阻塞 5~15ms，累积卡顿 | 快照用同步存储 API 且每层都写 | snapshot.save 改异步 setStorage + 40ms 延后 + 60s 同层节流 | 改后刷新时无同步写盘卡顿，render 次数与首屏时间同步改善 |
| 2026-10-22 17:40 | **recentImagery 单层网络 20.5s**<br>近期影像层要 20 秒才返回，首屏被它拖住 | 服务端 /api/imagery/available 串行逐天 HEAD 探测 NASA（25s 超时 × 3 天） | 服务端改并行 + 6s 单次超时 + 结果缓存（命中 1h、未命中 10min）；客户端超时 40s→10s | recentImagery 20.5s → 5.46s 首次 → 0.007s（服务端探测缓存） |

### 构建、包体与代码质量（19 条）

| 时间 | 问题 | 根因 | 落地解决 | 验证 |
|---|---|---|---|---|
| 2026-10-24 03:10 | **自检里 globe/full 在设置页上空跑出"假 OK**<br>settings 检查之后，globe3d/full 两项报 OK 但其实没在首页执行 | c_settings_page 用 switchTab 到设置页后没有回首页，后续依赖首页方法的检查在设置页空跑 | selftest.py 加 ensure_index() 兜底，让依赖首页的检查先回首页 | 13 项自检全绿（boot/icons/layer_toggle/group_master/solo/marker_detail/search/weather/basemap/dock/settings/globe3d/full，800 标记/31 图层/failed=""） |
| 2026-10-24 03:10 | **自检 harness 在无 PATH 后台跑不起来、被强杀后 automator 卡死**<br>后台运行时 python/bash 都找不到；前台整套约 7min 超工具超时；进程被强杀后 automator 报 timeout waiting for automator response | 后台进程无 PATH；单次全套超工具超时；强制中断使 automator 会话悬挂 | 改为前台分两半跑；卡死时用 close_project_window + open_project_window 重建会话恢复 | 拆两半后 13 项全绿 |
| 2026-10-24 03:10 | **selftest 的 globe3d 检查假报错**<br>自检报 3D 页异常，但截图看球体/星空/轨迹线都正常 | c_globe 探的是过期字段 px/lines/tgt，3D 页实际用 glH/dbg/error/chips/hud/autoRotate | tools/selftest.py 改为探真实字段 | 实测 glH=433、dbg=7就绪、error=""、chips=31，截图确认 3D 正常 |
| 2026-10-24 00:50 | **代码质量扫描误报 AppSecret**<br>扫描报 CONTAINS_APPSECRET（疑似硬编码密钥），项目里并没有密钥。 | 规则正则 \W([0-9a-fA-F]{32})\W，base64 里的 AAAA… 零填充被当成连续 32 位十六进制串。 | assets/iconpack.js 的 base64 每 24 字符切段用 + 连接，主动打断连续十六进制串。 | AppSecret 误报 0 条。 |
| 2026-10-24 00:50 | **代码质量扫描「无使用或无依赖文件」未通过**<br>扫描报存在无使用/无依赖文件。 | CONTAINS_UNUSED_CODES / _COMPONENTS / _PLUGINS 会扫 compiledPkg 里没被任何入口依赖的文件，而 .claude/、.agents/、cloudfunctions/、docs/、*.md 这些开发产物都还在工程里。 | project.config.json 的 packOptions.ignore 补 cloudfunctions / skills-lock.json / .claude / .agents / minitest / tools / scripts / docs / *.md，并置 ignoreDevUnusedFiles=true；.claude/ 与 .agents/（各 209 文件 1.6MB）移出工程到 D:\Hermes\gods-eye-miniprogram-dev；删除零引用的 cn_traffic_{1,2,4}.png。 | 该项扫描通过；主包降到 1.09MB，包内无开发产物。 |
| 2026-10-24 00:50 | **代码质量扫描「图片和音频资源」未通过**<br>微信开发者工具「代码质量」扫描报「图片和音频资源」超过 200K。 | 反编译 app.asar 确认规则 IMAGE_AND_AUDIO_LIMIT limit=200、checkImageAndAudioSizeLimit 是把 compiledPkg 里所有 .png/.jpg/.mp3 字节数加总再与 200KB 比（不是单文件上限），本项目 364 张图标合计 527KB 必然超。 | 新增 assets/iconpack.js（437KB）把 335 张只被 JS 引用的图标压成 base64 内联；utils/render.js 新增 materializeIcon(path) 首次用到时 fs.writeFileSync(USER_DATA_PATH/icons/...) 返回本地路径，iconFor / iconForSelected / buildMarkers 出口统一过它；pages/index 的 iconPath 与 alertIconFor()（15 个 return）全部包裹；iconlib 的 ICON_LIB → ICON_LIB_RAW + map(materializeIcon)；assets/icons/** 删 341 张只留 29 张（20 静态 + 6 tabBar + 3 3D 纹理）；earth_day 59→30KB、earth_night 24.7→12.9KB（768×384 q58）。 | 图片/音频合计 527KB → 100.1KB（29 文件）；compile_wxml / compile_wxss 均 success；console grep error 无输出；首页 800 markers 的 iconPath 全部 http://usr/icons/... 且 accessSync 0 缺失；图标库 160 个全在；主包 1.31MB → 1.09MB。 |
| 2026-10-23 14:20 | **3D 分包页返回主包时路由竞争**<br>从 pkg/globe 回主包时控制台报 routeDone with a webviewId … is not found，真机可能白屏。 | 返回走 navigateBack + switchTab 两步，同一个 webview 上两个路由动作竞争。 | 新增 leaveTo()：reLaunch 一步清栈，失败再降级 switchTab → navigateBack。 | 点 2.5D 地图 → 回到 pages/index/index，栈深 1；工具里仍偶发一行框架级 routeDone，但页面状态正确、不白屏。 |
| 2026-10-23 06:01 | **index.wxss 残留 10 组死 CSS**<br>样式表里还有一批选择器对应的 class 在 WXML/JS/组件里全都不存在。 | 组件替换（.layer-dot/.gswitch 等）后旧规则没回收。 | 只删「选择器里所有 class 在 WXML/JS/组件里都不出现」的规则，一条一条删（.layer-dot / .detail-row,.sheet-row / .mode-switch / .gswitch-knob / .icon-btn / .icon-btn-hover / .icon-badge 等 10 条），删完立即编译+截图验证。 | 共删 10 条（59919 字符），页面渲染正常、无样式缺失。 |
| 2026-10-23 05:44 | **清理无用 CSS 后 WXSS 编译中断、页面白屏**<br>删掉一批「无用 CSS 规则」后微信开发者工具开始报「编译 .wxss 文件错误」，页面渲染成无样式/白屏。 | 具体触发写法未定位；已排除 CSS 语法错——tinycss2 解析 0 错误、括号/注释/花括号全平衡，判断是 WXSS 编译器的方言限制。 | 以 00:24 的历史副本 index.wxss.new（当时能正常编译）作基线，计算差集（78 条 .wx-* 天气面板等新规则），分块追加并逐块验证渲染；预警框等级色改为 JS 内联样式（styleStr），绕开该 CSS 风险点。 | 78 条全部追加成功、页面恢复正常；最终 index.wxss 规则数 463，旧文件 451 条全部包含、无丢失。 |
| 2026-10-23 05:44 | **jelly-toggle 全局注册触发按需注入告警**<br>控制台报「全局自定义组件影响按需注入」告警。 | 把 jelly-toggle 注册在 app.json 的全局 usingComponents 里。 | 改为页面级注册，在 settings.json / index.json 的 usingComponents 中声明。 | 告警消失，全量核验 console error/warn 0 条。 |
| 2026-10-23 05:44 | **index.js 里两处方法重复定义**<br>index.js 中 noop 与 layersForAlert 各定义了两次，后一份覆盖前一份。 | 多次 patch 追加方法时没有回查同名方法是否已存在。 | 删除重复定义，保留唯一实现。 | 全量方法核验 fails: []（12 个主要方法无异常）。 |
| 2026-10-23 04:10 | **包内残留无引用图标、调试日志与废弃样式**<br>包里有 8 个没人引用的 PNG、一批调试 console.log 和已被替换的旧开关样式。 | 图标/样式迭代替换后没有回收旧文件，调试日志没摘。 | 删 8 个无引用图标（wx/zap、wx/cloud-lightning、wx/tornado、ui/tornado、ui/activity、perimeter／imagery／seismic 根副本，约 16KB）；删废弃样式 .gswitch / .gswitch.on / .gswitch-knob / .layer-dot；清掉 PERF onLoad、[dbg-icons]（连同 m2 统计循环）、[perf] first paint。 | index.js 里 console.log 归零；主包 ≈1.31MB、分包 ≈0.75MB；默认图层单次 render 24ms、markers 78；packOptions.ignore 已覆盖 tools/ scripts/ docs/ *.md。 |
| 2026-10-23 00:28 | **包体逼近上限（2.02MB）+ 死资源死代码**<br>主包加分包合计 2.02MB，主包接近 2MB 限额 | 零引用 PNG（重复件、被 ui/ 取代的旧图、弃用配色集）、CSS 重复块与不存在选择器、未调用 JS 函数 | 删 35 个零引用 PNG + 8 套弃用配色共 43 个 43KB（删前备份 scratch/gev_cleanup_backup）；删 docs/_removed/sources.js；packOptions.ignore 加 tools/、minitest/；index.wxss 55.1→53.1KB、globe.wxss 13.5→12.2KB、app.wxss 删 .muted/.amber；render.js 删 tornado/seismic 映射，cn.js 删 squareAround() | 5 套图标映射各 44 key 0 缺失；全项目 339 条资源引用 0 真缺失；四页编译 success、console error 空；主包 0.98MB、分包 0.746MB、合计 1.726MB |
| 2026-10-22 20:50 | **网页版打开报 ERR_INVALID_HTTP_RESPONSE（curl 却 200）**<br>浏览器打开 http://127.0.0.1:4173/ 直接报该网页无法正常运作，而 curl 返回 200 内容正常，容易误判成服务没起来 | 为省流量加的全局 gzipRes 劫持了 res.writeHead/res.end：Node 在 end() 里会调 _implicitHeader()→内部再调 this.writeHead，被替换的 writeHead 把头部存进 pending 不发，响应变成"只有裸 body、没有状态行"；/api/setup/status 是 setHeader+res.end（不显式 writeHead）写法，前端启动即挂在这步，Vite 的 HTML/CSS/JS 同样被波及 | server/providers/local.js 的 withGzipPatch 直接 return plugin（停用），函数里留"不要这么干"注释；send-json.js 的 gzipRes 加保险（headersSent 时绝不改长度、压缩前 removeHeader 清长度/编码/Transfer-Encoding）；显式压缩只保留在 sendJson() 内 | headless Chrome + CDP 实测 FAILS 0，所有请求 200；/api/setup/status 恢复 HTTP/1.1 200 OK + application/json；/、/style.css、/src/main.js 长度与 Content-Length 一致 |
| 2026-10-22 19:50 | **清理死代码时误删 hud-bottom 起始标签，WXML 编译 10040**<br>清理后 WXML 编译报 10040 | 删 .loc-fab 块时连带删掉 <view class="hud-bottom"> 起始标签 | 补回该起始标签，其余死代码照删（.loc-fab 样式、onLocFab/dockTap、RENDER_CAP/renderCap、server/gzip-debug.log） | WXML 编译通过 |
| 2026-10-22 18:30 | **双击 3D 把 appService 打崩，全页按钮失灵**<br>点 3D 场景后所有按钮（定位/刷新）都没反应 | switchMode() 同时做 wx.loadSubpackage({name:'pkg'}) 与 wx.navigateTo('/pkg/globe/globe')，两者抢同一分包 → pkg: loadSubPackage:fail Your subpackages configuration is invalid → LifeCycle.load fail: Cannot set a non-pending waiting value → SystemError (appServiceSDKScriptError) | 分包未就绪时只加载分包，跳转挂到 _navPend，加载完成(success/fail/complete)后再执行；_navBusy 互斥 + 4s 兜底；preload3D() 的 complete 里统一 _flushNav() | 连点 3 次 switchMode()：栈里只有 pages/index/index → pkg/globe/globe 一层，不再重复压栈 |
| 2026-10-22 18:30 | **Skyline 渲染开关引入 unsupported property 告警**<br>加载时出现一批 unsupported property 告警，页面表现不稳 | project.private.config.json 里 skylineRenderEnable: true，Skyline 对自定义组件/属性支持比 WebView 严格 | 关闭 skylineRenderEnable | 告警消失，页面正常渲染 |
| 2026-10-22 17:20 | **WXSS 去重脚本把最后一块的选择器吞掉，编译报 10041**<br>合并重复选择器后 WXSS 编译 10041 失败，模拟器控制台不给任何详情 | 脚本按"合并到最后一处"替换时只写了 {...}，没带选择器，留下悬空的前缀 | 替换改为 sel + ' {' + merged + '}'；index.wxss 合并 48 个选择器删 74 块、settings.wxss 13/14、full.wxss 8/8 | 三个文件 compile_wxss 全 success，页面/抽屉视觉与去重前一致 |
| 2026-10-22 | **GEV 服务端 4173 没监听，小程序整站数据全空**<br>小程序一片空白，所有图层无数据 | 排查发现 4173 端口没有监听，服务端进程没在跑 | 重启服务，并注册登录自启计划任务 GodsEyeView_Server，开机自动拉起 | 服务恢复后各图层有数据；自启任务已注册 |

### 部署与云端（3 条）

| 时间 | 问题 | 根因 | 落地解决 | 验证 |
|---|---|---|---|---|
| 2026-10-23 23:59 | **静态数据包接口 500 static_dataset_unavailable**<br>/api/infra/static/cables／datacenters／dams 三个接口都返回 500 static_dataset_unavailable。 | Dockerfile 只 COPY server/api/src/config/scripts，没把 public/data/gev/*.json 打进镜像；sourceRoot = /app → 文件不存在。 | gev-cloudrun/Dockerfile 新增 COPY public ./public，补进 cables(334KB) / datacenters(149KB) / dams(26KB)。 | 海缆 1913 条 / 数据中心 4351 个 / 水坝 704 个，三项均 200 带真实数据。 |
| 2026-10-23 23:59 | **设置页「数据源健康」28 层里 18 层假 down**<br>「数据源健康」显示 28 层里 18 层 down，而同一时刻 /api/ais-live 明明返回 4000+ 艘船。 | mini-sources.js 里 const LOCAL = 'http://127.0.0.1:4173' 写死为本机 dev 端口，容器监听 8080 → 所有 local:true 通道探到 ECONNREFUSED（16ms fetch failed）。 | LOCAL 跟随 process.env.PORT；探针超时 9s → 30s。 | 复测数据源健康 35~42 通道正常、down=0（35/40 通道可用，其余 5 条为备用通道）。 |
| 2026-10-23 21:37 | **上游依赖本机内网穿透，一断线所有图层 502**<br>小程序走 godsEyeProxy 云函数本身没问题，但上游是 http://47.104.22.0:64362（本机穿透），穿透一断全程 502，真机上所有图层一起空。 | 数据 API 只跑在家里那台机器上靠内网穿透暴露，云函数只是转发壳，没有云端算力。 | API 做成独立服务：api/index.js（27 个 provider 中间件按最长前缀分发）+ serve.mjs（node:http + PORT）→ D:\Hermes\gev-cloudrun，运行期依赖只留 @mapbox/vector-tile / pbf / ws / eccodes-wasm（约 40MB，不带 cesium 380MB）；CreateCloudRunEnv 开通 → tcb cloudrun deploy，服务 gev-api，1C2G / MinNum 0 / MaxNum 2 / 端口 8080 / PUBLIC+MINIAPP；godsEyeProxy 用 cloudbaserc.json 的 envVariables.GEV_BASE 指向云托管域名，函数超时 3s→60s、fetchUrl 上游超时 25s→55s（风场冷启动 40s+）。 | /healthz 200（node v24.22.1）；/api/flights 200 300 架；/api/ais-live 200 真实船舶；小程序刷新后 markers 800，flights 293 / vessels 302 / cables 116 / datacenters 129 / dams 68 / cnAdmin 8，无 error。 |

### 工具链与自检（8 条）

| 时间 | 问题 | 根因 | 落地解决 | 验证 |
|---|---|---|---|---|
| 2026-10-24 02:10 | **没有可复跑的功能自检手段**<br>「各功能是否正常」只能靠零散手点和截图，无法一次跑全。 | 缺自动化自检脚本。 | 新增 tools/selftest.py，走 wechatide CLI 驱动运行时逐项断言 19 项（编译/控制台、首屏、图标完整性、图层开关、分组主开关、单选聚焦、详情、搜索、天气面板、底图、坞、测距、图层容量、主题、收藏、态势感知、3D 地球、设置页、全屏页）。 | 19 项全部通过（首屏 11 层/markers 482/天气 14°雾、flights 300→120 容量生效、3D points 300 fps 12 非全黑、设置页 28 层 38/40 通道可用），并抓出野火详情自关 bug。 |
| 2026-10-24 02:10 | **tabBar 页用 navigateTo 静默失败、开发者工具两次卡死**<br>pages/settings、pages/full 用 navigateTo 打不开（无报错无跳转）；工具两次卡死，pageStack 为空，日志 routeTo appLaunch timeout 10003ms。 | 这两个页面是 tabBar 页，navigateTo 不支持 tabBar 页；工具进程自身挂死。 | tabBar 页统一用 switchTab；卡死时 quit + 重启工具 + simulator_refresh 恢复。 | switchTab 后页面正常打开；重启刷新后自检继续跑完 19 项。 |
| 2026-10-24 02:10 | **MCP automation 工具重启后必挂，callMethod 上下文失效**<br>工具重启后 MCP automation_* 必挂（Render frame was disposed / 300s 超时）；automation_page_action --action callMethod 报 No context found for objectId 1，且 --args 已弃用。 | MCP automation 通道与工具重启不兼容；callMethod 依赖的 objectId 上下文重启后失效。 | 一律改走 CLI wechatide -c Hermes <tool>；页面方法改为在 automation_evaluate 里用 s.method.apply(s, args) 调用。 | 19 项自检全程走 CLI 跑通，无超时。 |
| 2026-10-24 00:50 | **PIL quantize 压图标导致边缘发毛**<br>用 Image.quantize() 压带抗锯齿的图标后，边缘立刻发毛、白边变硬。 | PIL 内置 quantize 把 alpha 压成 0/1，透明度不参与调色板。 | 改用 imagequant（libimagequant，pngquant 同引擎），把 (r,g,b,a) 一起放进调色板。 | 合成图 PSNR 仍有 67dB+；图标库截图确认飞机/轮船/火箭形状正常。 |
| 2026-10-23 23:59 | **28 个数据源没有可复跑的验收集**<br>之前只能零散手测，说不清 28 个数据源哪几个真通、数据量对不对。 | 缺少一次性覆盖全部数据源的自动化验收脚本。 | 新增 gev-cloudrun/verify-all.mjs：28 项逐个断言状态码 + 耗时 + 数据量 + 业务判定（如 0 格要区分无覆盖还是配额耗尽）。 | 终局跑 28/28 全部 200 且带真实数据（舰船 4269 艘、USGS 地震 230 条、路线 52.6km/42 分等）；另用 tcb fn invoke godsEyeProxy 验证 callFunction 链路 ok:true。 |
| 2026-10-23 21:37 | **CLI 设置云托管环境变量不落库**<br>用 @cloudbase/cli 的 UpdateCloudRunServer 传 ServerConfig.EnvParams，命令返回成功，但环境变量没真正注入。 | CLI 收下 EnvParams 却不落库（接口层丢字段）。 | 改走 MCP manageCloudRun(updateConfig)，EnvParams 传 JSON.stringify(env) 一次性写入 12 个 key（TOMTOM / FIRMS / AISSTREAM / OPENSKY / AMAP / TENCENT / TIANDITU / QWEATHER 等）。 | manageCloudRun 的 verify 通过；AISSTREAM key 生效使 /api/ais-live 返回真实船舶数据。 |
| 2026-10-23 05:44 | **项目损坏时 compile_wxss / getCurrentPages 都不能当探针**<br>排查编译失败时 compile_wxss 对所有文件都返回 fail，getCurrentPages().length 返回 1，误以为页面还活着。 | 项目已损坏时 compile_wxss 全线 fail 失去区分度；编译失败时旧页面实例仍存活，getCurrentPages 照常返回旧栈。 | 放弃这两个信号，改以截图渲染结果为唯一可靠判据。 | 恢复后逐块截图确认样式回来，页面恢复正常渲染。 |
| 2026-10-23 02:55 | **patch 定位串未命中，改动静默不生效**<br>三次改动（isExtremeWeatherLayer、_soloLayer、onMarkerTap 里的 solo 调用）都「看着写了」，功能却没生效。 | str.replace 找不到定位串时静默返回原串，不抛异常，所以写盘成功但内容没变。 | 每处改动前先 assert 目标串存在、assert 替换后内容发生变化，再写盘；改完读回文件复核。 | 用运行时返回值验证功能真实生效：点实时航班后 layers 28 → ["flights"]、solo="实时航班"、详情打开。 |

### 其他（5 条）

| 时间 | 问题 | 根因 | 落地解决 | 验证 |
|---|---|---|---|---|
| 2026-10-24 05:15 | **gevHealth 探活结果不落库，历史无从查**<br>健康检查只返回当次结果，连续失败次数/最后成功时间无法追溯 | gevHealth 只做一次性 http 探测返回，没有持久化 | 探活结果写 gev_health/latest（ok/status/latencyMs/consecutiveFail/lastOkAt），cloudfunctions/gevHealth 补 wx-server-sdk 依赖 | invoke 返回 consecutiveFail=0，MCP 查 gev_health 集合确认文档已写入 |
| 2026-10-24 04:45 | **旧结构快照被读入导致脏渲染**<br>升级后读到上一版结构的本地快照，渲染出残留图形/错位 | snapshot 没有版本标记，结构变更后旧快照仍被直接复用 | snapshot 加 SCHEMA=2，结构不符的旧快照直接丢弃 | devtools 刷新控制台零 error，selftest boot 800 标记/31 层/failed 空 |
| 2026-10-24 04:45 | **gevUserData 无输入上限，可撑爆文档/配额**<br>收藏或设置写入无边界，异常数据可把文档写到超限 | set 未校验条数与字节数 | cloudfunctions/gevUserData/index.js set 加输入校验（收藏≤200 条、设置 value≤200KB） | gevUserData 重新部署成功，模拟器 set/get 正常 |
| 2026-10-24 01:30 | **上传报 Failed to load native binding**<br>点上传直接失败，报 Error: Failed to load native binding [2.02.2609231]win32-x64]，弹窗「上传失败」；日志 task type:upload exec error。 | 不是工程配置问题：字符串唯一出现在 @swc/core 的 binding.js（requireNative 全失败后抛出），即 53MB 的 swc.win32-x64-msvc.node 在那一刻加载失败——当时正批量删 341 张 PNG + 写 437KB iconpack.js，文件监视器与杀软扫描同时压磁盘；已排除 asar 路径问题（process.noAsar=true 报 Cannot find module，与现象不符），DLL 本身完好（system node dlopen OK、用工具自带 Electron 的 ELECTRON_RUN_AS_NODE 跑 require+transformSync OK、worker_threads 也 OK），预览走同一 swc 压缩能成功。 | 不动工程，直接复测上传；预防：Windows Defender 排除 D:\App\微信web开发者工具 与 D:\Hermes\gods-eye-miniprogram。 | 复测上传（1.0.0）成功：COS 分片 + commitTask 完成，[uploadFile] 15613ms，mcpStatus=success、toolStatus=success，包体 1.57MB。 |
| 2026-10-22 18:30 | **两条"项目内"告警实为 IDE 自身噪音（误判排除）**<br>unsupported property: font-size: undefinedpx；21 listeners of event WindowInfoChanged | 全项目搜 font-size + {{ 零命中，无数据绑定在拼 font-size；项目里也没有 onWindowInfoChanged / onWindowResize 订阅——均为开发者工具内部告警 | 不处理，确认非项目代码问题 | 全项目 grep 0 处命中 |

---

## 11. 高危根因 TOP 12（跨 155 条问题提炼）

| # | 根因模式 | 典型表现 | 铁律 |
|---|---|---|---|
| 1 | **规则口径误解** | 以为「图片音频 200 KB」是单文件上限，实际是全包加总 | 报错规则一律去工具内部求证，不看文档猜 |
| 2 | **setData 成本被低估** | 逐帧 setData 跑弹簧动画，单次 700 ms，页面卡成 PPT | 动画位移交给 CSS transition，物理模型只用来算时长 |
| 3 | **key 含实时值** | 详情卡 3 s 自关（整层重取后 `fire:lat,lng:0` 变 key） | 选中态用坐标锚点 + 最近邻，不用易变 key |
| 4 | **坐标系二次转换** | 路况点/POI 整体偏 500 m | 上游给 GCJ02 就打 `crs` 跳过转换；新源先确认坐标系 |
| 5 | **原生组件层级** | 缩放条被 canvas 盖住、`z-index` 无效；web-view 上不能叠提示 | 原生组件（canvas / web-view / map / cover-view）按「无法用 CSS 覆盖」处理 |
| 6 | **工具自身不可信信号** | 项目损坏时 `compile_wxss` 全 fail、`getCurrentPages().length` 仍返回 1 | 渲染/截图结果才是唯一可靠判据 |
| 7 | **CSS 覆盖顺序** | `@import` 的 design.wxss 被后面同名规则覆盖（sticky 失效、字号折行） | 覆盖规则集中写到文件末尾，同类规则只留一处 |
| 8 | **flex 收缩** | 详情行/天气四宫格溢出被裁 | 溢出容器必须 `min-width:0`（或 `overflow:hidden`） |
| 9 | **渲染过滤 vs 改配置** | 单选把用户其它图层开关全关掉 | 过滤用独立状态（`_soloIds`），永不写 `settings` |
| 10 | **境内不可达** | GFS GRIB 在 AWS S3、vercel.app 超时、adsb.lol 走代理 429 | 选源先测可达性；不可达就换源（GFS→ECMWF IFS） |
| 11 | **云端配置不落库** | CLI `UpdateCloudRunServer` 的 `EnvParams` 静默不生效 | 用 MCP `manageCloudRun(updateConfig)` + `JSON.stringify(env)`，改完必须回读 |
| 12 | **图标一一对应无审计** | 4 处图层撞图、列表与地图图标不一致、风场变飞机 | 每次增删图层跑 `scripts/check-icons.js` + 运行时比对脚本 |

---

## 12. 运维手册

### 12.1 云端部署（云托管）

```bash
cd D:/Hermes/gev-cloudrun
# 首次/重建
printf '\n\n\n' | tcb cloudrun deploy --service-name gev-api --source . \
  --port 8080 --min-num 0 --max-num 2 --open-access-types PUBLIC,MINIAPP --force
# 查版本
tcb cloudrun detail --service-name gev-api   # JSON 前有引导行，取 data.DeployRecords
```

- 环境变量（12 个 key：数据源密钥、`GEV_WARMUP` 等）用 MCP `manageCloudRun(updateConfig)` 写入，`EnvParams` 必须 `JSON.stringify`；改完 `detail` 回读确认。
- `Dockerfile` 必须含 `COPY public ./public`，否则 `/api/infra/static/*` 全部 500。
- `serve.mjs` 的 `GEV_WARMUP` 在启动 1.5 s 后预热 `/api/wind`、`/api/cyclones`、`/api/launches`、`/api/celestrak/stations`。

### 12.2 云函数更新

```bash
cd D:/Hermes/gods-eye-miniprogram
tcb fn deploy godsEyeProxy --force          # 或 MCP updateFunctionCode
tcb fn invoke godsEyeProxy --params '{"path":"/api/cyclones"}'
```

- `godsEyeProxy` 超时 60 s、内存 256 MB、`fetchUrl` 上游超时 55 s（风场冷启动 40 s+）。
- `GEV_BASE` 指向云托管域名，改后端地址只改这一个环境变量。

### 12.3 发布前检查单

1. `python tools/selftest.py` → 19/19
2. `node scripts/check-icons.js` → 0 缺失 / 0 悬空
3. 开发者工具「代码质量」三项 → 全过
4. 包体：total ≤ 2 MB、主包 ≤ 2 MB
5. `node verify-all.mjs`（在 `D:/Hermes/gev-cloudrun`）→ 28/28
6. `create_preview_qrcode` 预览 → 真机扫码自测
7. `upload`（写操作，需二次确认）→ 记下版本号与 `commitTask`

### 12.4 故障速查

| 症状 | 根因 | 处置 |
|---|---|---|
| 所有图层 502 / 空白 | 云托管实例挂或域名变 | 查 `/healthz`；`tcb cloudrun detail` 看实例；必要时 `deploy --force` |
| 风场恒 `unavailable` | 上游模型不可达（GFS 在 S3） | 改 `model=ifs`；查 manifest 冷却 |
| 野火层空 / `warming:true` | FIRMS 冷启动 45–90 s | 等预热或先触发一次后端预热 |
| 健康面板大量 down（但接口 200） | 探针探的是旧地址/境外直连 | 探针改探自家聚合端点；`LOCAL` 跟随 `PORT` |
| 图标全变白块/加载失败 | 走 `materializeIcon` 前被手拼路径绕过 | 所有 `iconPath`/`src` 出口统一过 `materializeIcon` |
| 上传报 `Failed to load native binding` | `@swc/core` 53 MB DLL 瞬时加载失败 | **原样重试**；Defender 排除工具目录与工程目录 |
| 真机全部请求失败 | 地址还是 127.0.0.1 | 确认 `failover()` 跑过；设置页「当前生效」显示局域网地址 |
| tabBar 页打不开且无报错 | 用了 `navigateTo` | 改 `switchTab` |
| 详情卡 3 s 自关 | key 含实时值 | 走 `selRef` 坐标锚点兜底 |
| 3D 页全黑（iOS） | 外部先取 webgl 上下文导致 three 构造失败 | 已删探测；若仍黑看 HUD「三维内核初始化失败：xxx」 |
| 开发者工具卡死（pageStack 空） | `routeTo appLaunch timeout 10003ms` | `quit` → 重启 → `simulator_refresh` |
| MCP automation 全挂 | 工具重启后通道失效 | 改走 CLI `wechatide -c Hermes <tool>`；页面方法用 `automation_evaluate` 内 `s.method.apply(s,args)` |

---

## 13. Agent 协作配置（Hermes）

### 13.1 运行环境

| 项 | 值 |
|---|---|
| Agent | Hermes Agent（Nous Research），桌面端 |
| 主模型 | `deepseek-flash`（provider: deepseek） |
| 审批模式 | `off`（YOLO，危险命令免确认） |
| 辅助视觉 | 智谱 `glm-4v-flash`（`vision_analyze` 400 时改直连 `open.bigmodel.cn`） |
| 工作目录 | `D:\Hermes\gods-eye-miniprogram`；Hermes 配置在 `C:\Users\13680\AppData\Local\hermes` |
| 系统加固 | Windows Defender 排除 `D:\App\微信web开发者工具` 与工程目录 |

### 13.2 MCP 与工具通道

| 通道 | 工具数 | 用途 | 注意 |
|---|---|---|---|
| `wechat-devtools`（MCP） | 49 | 编译、预览、上传、模拟器、云开发 | 工具重启后 `automation_*` 必挂（`Render frame was disposed` / 卡 300 s） |
| `wechatide`（CLI） | 同 49 | 上述能力的稳定替代 | `bash C:/Users/13680/AppData/Local/hermes/bin/wechatide -c Hermes <tool> --project "D:\\Hermes\\gods-eye-miniprogram"` |
| `cloudbase`（MCP） | 42 | 云托管配置、函数部署、数据库 | 新会话需 `/reload-mcp` 才可见 |
| `windows-mcp` | 25 | 桌面窗口/进程/剪贴板 | 兜底用 |
| `vercel`（MCP） | 240 | 网页版线上部署 | 与小程序无关时不用 |

### 13.3 使用的 Skill（及它在项目里解决的问题）

| Skill | 作用 |
|---|---|
| `wechatide-skill`（v0.3.11） | 根入口：门禁 `check_wechatide_status --skill-version`、编译/预览/上传标准流程、上传报错排障 |
| `wechat-miniprogram-ai-dev` | 十步工作法：需求→骨架→数据→单任务迭代→云函数→报错五要素→七情况测试 |
| `miniprogram-code-quality-audit` | 代码质量三项规则的真实口径（已回写：200 KB 是总量、`CONTAINS_UNUSED_*` 只扫 compiledPkg、AppSecret 正则误判） |
| `miniprogram-dev-sop` / `miniprogram-development` | 目录四件套、包体约束、WXSS 排障纪律 |
| `cloudbase` / `cloudbase-backend-deploy` / `auth-wechat-miniprogram` | 云托管部署、环境变量、函数、数据库、小程序侧鉴权 |
| `glass-effects` / `frostpane` | 玻璃材质（最终结论：只留内高光，删 `::after` SHEEN） |
| `feel` | 动效物理参数（最终落成 `utils/motion.js`：只算时长，位移走 CSS） |
| `ui-ux-pro-max` / `apple-design` / `emil-*` | 视觉方向与交互细节参考 |
| `hermes-agent` / `hermes-ops` | Hermes 自身配置与故障恢复 |

### 13.4 工程内自动化脚本

| 脚本 | 作用 | 调用 |
|---|---|---|
| `tools/selftest.py` | 19 项功能自检（编译/首屏/图标/图层/详情/搜索/天气/底图/坞/测距/容量/主题/收藏/态势/3D/设置/全屏） | `python tools/selftest.py` |
| `scripts/check-icons.js` | 5 套图标映射一致性（key 数、文件存在、无悬空） | `node scripts/check-icons.js` |
| `tools/make_ui_icons.js` | lucide → SVG → 无头 Chrome 截图 → 96×96 透明 PNG | `node tools/make_ui_icons.js` |
| `verify-all.mjs`（在 `gev-cloudrun`） | 28 项数据源验收 | `node verify-all.mjs` |

### 13.5 协作纪律（沉淀下来的操作规范）

1. **改代码先出 diff**：说明改哪个文件、为什么、怎么验；不做「看着写了其实没生效」的静默替换——每次 patch 先 assert 定位串命中。
2. **写操作二次确认**：上传体验版、删项目、云数据库写、云存储删除。
3. **日志三段式**：`PROGRESS.md` 固定「时间 + 现象 + 根因 + 改动 + 验证」，同步副本到 `C:\Users\13680\Desktop\.MD\docs\logs\`（索引见 `[DocsAgent]-文档索引.md`）。
4. **不可信信号清单**：`compile_wxss` 全 fail、`getCurrentPages().length===1`、`simulator_refresh` 成功、`automation_page_action callMethod` 的 objectId。
5. **验证分层**：静态（node --check / 编译）→ 运行时（evaluate 断言）→ 视觉（截图 + 直连视觉模型）→ 真机（只能用户确认）。
6. **凭据处理**：一律从 `.env` 读，不落文档、不进通知。

### 13.6 本次归档的产出方式

`PROGRESS.md` 约 2500 行，按 1–860 / 861–1700 / 1701–2500 切三段，并行派 3 个子 Agent 抽取 `{date,title,symptom,cause,fix,verify,category}`，再合并去重（155 条）、按类归并。第一轮因模型在 JSON 字符串里写入了未转义双引号导致解析失败，改为「字符串内禁止双引号、用「」代替」后一次通过。

---

## 14. 遗留风险与待办

| 项 | 状态 | 影响 | 下一步 |
|---|---|---|---|
| iPhone 17 Pro 真机 3D 黑屏 | 待真机验证 | 3D 页在部分 iOS 可能全黑 | 需要用户回传 HUD 诊断面板 `px=` 内容 |
| `web-view` 网页版 | 受限 | 需业务域名 + HTTPS 备案域名；和风天气发布同理 | 备案后配置业务域名 |
| 高德交通态势配额 | 受限 | 每日 10044 次上限，超额返回 0 格 | 次日 00:00 重置；必要时换源 |
| TomTom 大陆流速 | 产品限制 | 中国大陆无覆盖，已降级为路网模拟 | 保持降级，不投入 |
| 云托管冷启动 | 设计取舍 | `MinNum=0`，重接口首请求慢 | 接受；必要时调 `MinNum=1`（成本↑） |
| `/api/firms` 冷启动 | 设计取舍 | 无缓存时 `warming:true`，45–90 s | 已加预热 |
| 彩云天气 | 不可用 | `token is invalid` | 未接入，不影响主链路 |
| CloudBase MCP 热加载 | 工具限制 | 新会话不可见 | `/reload-mcp` |
| `PROJECT_SUMMARY.md` | 待补 | 早于 CloudBase 接入，缺云托管/云函数章节 | 以本文档第 2/12 章为准 |

---

## 15. 网页端（gods-eye-view）设计资源与落地

> 本章服务 `D:\Hermes\gods-eye-view`（Cesium 网页版）。小程序端受包体与原生组件限制用不了的方案，网页端基本都能用；两端的取舍差异见 15.1。

### 15.1 双端能力差异（同一套设计语言，两套实现）

| 能力 | 小程序端（当前） | 网页端（gods-eye-view） | 结论 |
|---|---|---|---|
| 玻璃材质 | `backdrop-filter` 在 WebView 生效但不稳；最终只留不透明底 + 内高光 | `backdrop-filter: blur() saturate()` 稳定可用，可叠 SVG 折射 | 网页端可做**真液态玻璃**，小程序端不要照搬 |
| 动效引擎 | 只有 CSS transition/animation；逐帧 setData 单次约 700 ms | GSAP + ScrollTrigger + Lenis 全可用，requestAnimationFrame 正常 | 网页端用 GSAP 时间线，小程序端只能用 CSS |
| 层级 | 原生组件（canvas/web-view/map）永远在最上层，`z-index` 无效 | DOM 正常，`z-index`/`pointer-events` 全可控 | 小程序端 HUD 靠**文档流**排布，网页端可用浮层 |
| 单位 | rpx（750 基准） | px/rem/clamp，可做响应式 | 设计稿换算不要混用 |
| 图标 | 5 套 PNG，图内已烘焙颜色 | SVG 内联，可 `currentColor` 随主题变 | 网页端统一 Lucide，不混多套线条风格 |
| 数据 | 31 图层经云函数代理 | 同源 `/api/*`，可直连本地 4173 | 设计时图层密度上限不同（网页端可到 1200+） |

### 15.2 本机已装的设计类 Skill（可直接触发，不必再装）

| Skill | 本机位置 | 能解决什么 | 网页端落点 |
|---|---|---|---|
| `claude-design` | `skills\creative\claude-design`（411 KB / 9 references + 6 assets） | 完整设计流程：Priority#0 事实核验 → 素材协议 → 10 流派 advisor → 输出形态（deck/canvas/prototype/animation/wireframe）→ 反 AI-slop | 改版首页、做宣传 deck、出新 HUD 视觉方案前先用它定方向 |
| `0-ui-ux-pro-max`（UI/UX Pro Max） | `skills\creative\0-ui-ux-pro-max` | 84 种 UI 风格 / 192 套配色 / 74 组字体 / 98 条 UX 准则 / 25 类图表 / 161 条推理规则 | 选主题配色、图表样式、无障碍基线 |
| `taste-skill` | `skills\creative\taste-skill` | 反 slop：大留白、层叠卡片、克制动效，1–10 旋钮（设计变异/动效强度/视觉密度） | 网页端「高级感」调校，避免廉价渐变与霓虹 |
| `frontend-design-anthropic` | `skills\creative\frontend-design-anthropic` | Anthropic 官方反同质化基准（禁 Inter/Roboto、拒紫白配色陈词） | 落地页/介绍页文案与排版 |
| `emil-design-eng` / `emil-animate` / `emil-apple-design` / `emil-improve-animations` | `skills\creative\emil-*` | Emil Kowalski 系列：先判断**该不该动**，再定曲线时长；整库动效体检并排优先级 | HUD 显隐、详情卡、图层切换的动效审计 |
| `transitions-dev` / `transitions-polish` | `skills\creative\transitions-*` | 生产级微交互配方（角标、下拉、模态、数字滚动、Tab、骨架屏）+ 打磨流程 | 工具栏、通知、数字统计的过渡 |
| `gsap-core` / `-timeline` / `-scrolltrigger` / `-plugins` / `-react` / `-frameworks` / `-performance` / `-utils` | `skills\creative\gsap-*`（官方 8 个） | GSAP 全 API、时间线编排、滚动联动、性能守则 | 相机飞行、图层淡入、时间轴播放、滚动叙事 |
| `motion-design-lottie` | `skills\creative\motion-design-lottie` | timing/easing/choreography/多元素排序 + Lottie 导出 | 空状态、加载动画、图标微动 |
| `liquid-glass-js` / `glass-effects` / `frostpane` | `skills\creative\liquid-glass-js`、`skills\glass-effects`、`skills\creative\frostpane` | 玻璃实现谱系：CSS 模糊 → SVG 位移折射 → 性能预算 | HUD/坞/详情卡的材质升级 |
| `feel` | `skills\web\feel`（含 demo，端口 5182） | 用 mass/stiffness/damping 描述手感，`Feel.words()` 把「沉重/磁吸/抛出」翻成物理参数，可导出 CSS/Framer/react-spring | 拖拽坞、抽屉、滑块的手感 |
| `popular-web-designs` | `skills\creative\popular-web-designs` | 54 个真实设计系统（Stripe/Linear/Vercel…）作范式参考 | 快速对齐成熟产品的版式与密度 |
| `design-md` | `skills\creative\design-md` | 生成/校验 Google `DESIGN.md` 设计令牌规范 | 给网页端沉淀自己的 token 文件 |
| `architecture-diagram` / `excalidraw` / `baoyu-infographic` / `p5js` | `skills\creative\*` | 架构图（暗色 SVG/HTML）、手绘风图、信息图、生成艺术 | 数据源说明图、运维图、演示页 |
| `apple-design` | `skills\apple\apple-design` | WWDC 17 条交互原则 | 手感与层级判断的底线依据 |

### 15.3 清单里值得再装的设计 Skill（用户 2026-10-19 提供的 GitHub 清单）

| 优先级 | Skill | 仓库 | 装它解决什么 |
|---|---|---|---|
| P0 | Impeccable | `pbakaus/impeccable` | `npx impeccable install`；craft/critique/audit/polish/distill/animate 六命令 + 58 条确定性检测 + 浏览器内迭代 |
| P0 | UI Skills | `ibelick/ui-skills` | 15 个专项：`fixing-motion-performance`（动效性能）、`fixing-accessibility`、`baseline-ui`、`12-principles-of-animation` |
| P1 | scroll-craft / scroll-world | 见清单 | 滚动驱动叙事；scroll-world 可做 Cesium 落地页的场景旅程 |
| P1 | Three.js Skills | `CloudAI-X/threejs-skills` | 场景/材质/着色器/后处理——网页端 3D 层直接用得上 |
| P1 | better-icons | 清单第 4 节 | CLI + MCP 搜图标、SVG 批量导出（比手挑 Lucide 快） |
| P1 | Garden Skills | `ConardLi/garden-skills` | oklch 色彩理论 + 六步工作流 + 反陈词黑名单 |
| P2 | Owl-Listener/designer-skills | 同左 | 63 skills + 27 命令（用户研究→设计系统→原型测试） |
| P2 | refactoring-ui-skill / MengTo/Skills / material-3-skill | 见清单 | 间距/排版/配色规则、跨端素材、M3 token |
| P2 | awesome-design-skill | `FuturizeRush/awesome-design-skill` | 设计 skill 目录，按需再挑 |

通用安装：`npx skills add <owner/repo>`；Claude Code 用 `/plugin marketplace add <owner/repo>`。**第三方 skill 先 review 源码再装**（无 `curl | sh`、无凭据采集、无混淆/base64）。

### 15.4 组件库与动效库（本机已装，含实测版本）

| 库 | 版本 | 角色 | 本地/入口 |
|---|---|---|---|
| `gsap` | 3.15.0 | 动效主引擎 + ScrollTrigger | `D:\Hermes\ui-motion-lab` |
| `lenis` | 1.3.27 | 惯性平滑滚动 | 同上 |
| `vanta` | 0.5.24（依赖 three 0.180.0） | 3D 动态背景（FOG 等） | 同上 |
| `lucide` | 0.544.0（1861 图标） | 统一线性图标，`stroke-width` 可调 | 同上 |
| `vite` | 7.3.7 | dev server / 构建 | 同上 |
| **React Bits** | 218 组件 | Animations 38 / Backgrounds 64 / Components 48 / Micro 35 / TextAnimations 33，jsx+tsx 双版本 | `D:\Hermes\ui-motion-lab\_refs\react-bits`（精简 38 MB，已删演示素材与 git 历史） |

启动实验台（PowerShell detached，**不要**用 Hermes 后台 terminal，管道断开会把 vite 带走）：

```powershell
Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' `
  -ArgumentList 'D:\Hermes\ui-motion-lab\node_modules\vite\bin\vite.js','--host','127.0.0.1','--port','5180','--strictPort' `
  -WorkingDirectory 'D:\Hermes\ui-motion-lab' -WindowStyle Hidden `
  -RedirectStandardOutput 'D:\Hermes\ui-motion-lab\vite.log' -RedirectStandardError 'D:\Hermes\ui-motion-lab\vite.err'
```

### 15.5 术语 → 实现映射（对着 AI 直接报名字，比描述半天准）

| 术语 | 表现 | 网页端实现 |
|---|---|---|
| Scroll-triggered | 滚进视口就播完 | `IntersectionObserver` / `ScrollTrigger.batch()` / `toggleActions` |
| Scroll-linked | 滚多少动多少 | CSS `animation-timeline: scroll()` / GSAP `scrub: true` |
| Parallax | 背景比前景慢 | 不同 `translate3d` 速率（0.12 / 0.28 是耐看档） |
| Sticky | 到位置钉住 | `position: sticky`（父级不能 `overflow:hidden`） |
| Scroll Snap | 一次停一屏 | `scroll-snap-type: y mandatory` + `scroll-snap-align` |
| Horizontal Scroll | 往下滚横着走 | sticky 容器 + 被滚动驱动的横向 `translateX` |
| 渐进模糊 | 列表底部渐隐过渡 | 悬浮按钮上方 120pt 起，`mask-image` + `blur()` 0→16，按钮保持清晰 |
| 液态玻璃 | 折射 + 边缘高光 | SVG `<feDisplacementMap>` + `backdrop-filter`；一屏只做一块，性能很贵 |
| 视觉对齐 | 看起来平衡 | 8pt 网格 + 同列左对齐 + 图标光学居中补偿 1–2 px |
| 物理手感 | 拖拽有重量 | `feel`：mass/stiffness/damping，禁写死 duration |

### 15.6 站点与参考（用户 2026-10-22 提供的资源，已核验可访问）

| 站点 | 用途 |
|---|---|
| https://lucide.dev/icons/ | 1861 个线性图标，调 stroke 即用；网页端图标统一从这里出 |
| https://gsap.com | GSAP 文档与示例（ScrollTrigger 的 pin/scrub 组合最常用） |
| https://lenis.darkroom.engineering/ | 惯性滚动，注意与 `position: sticky` 的兼容 |
| https://www.vantajs.com/ | 3D 动态背景（数据大屏氛围底） |
| https://reactbits.dev/ | 218 个可复制组件，AnimatedList / Spotlight / Decrypt 一类 |
| https://github.com/diip3sh/feel | 物理交互动效 skill，含 4 个 rig 测试台 |
| https://theplusaddons.com/blog/liquid-glass-ui/ | 液态玻璃性能与可访问性综述 |
| https://github.com/zoubingwu/llm-wiki | Liquid Glass 折射推导（CSS + SVG）镜像 |

### 15.7 落到「上帝之眼」网页端的具体位置

| 界面 | 现状 | 建议方案（skill/库 → 做法） |
|---|---|---|
| 顶部 HUD / 统计条 | 半透明底 + 内高光 | `glass-effects` + `liquid-glass-js`：`backdrop-filter: blur(18px) saturate(140%)` + 1px 内描边；一屏最多 2 块玻璃，避免掉帧 |
| 坞（GPS/刷新） | 位移吸附 | `feel` 出参数 → GSAP `quickTo` 跟手 + 释放速度决定吸附；拖动中禁用 `transition` |
| 详情卡 / 抽屉 | 位移 + 遮罩 | `transitions-dev` 模态配方 + GSAP timeline（遮罩 180 ms、卡片 240 ms `power3.out`），出栈用 `power2.in` 更短 |
| 图层开关 | 即时显示 | `transitions-dev` 的 toggle/开关配方；列表批量淡入用 `ScrollTrigger.batch`，禁用逐项 `setTimeout` |
| 相机飞行 | Cesium `flyTo` | 不要用 GSAP 改相机（会和 Cesium 的 requestRender 抢帧）；用 `flyTo` 的 duration/easingFunction，UI 侧只用 GSAP 做伴随动效 |
| 风场动画 | 逐帧画箭头 | WebGL/Canvas 里跑，别用 DOM marker；帧率用 `gsap.ticker` 与 Cesium 渲染循环对齐 |
| 大屏演示页 / 介绍页 | 无 | `claude-design` 定方向 → `popular-web-designs` 取范式 → `gsap-scrolltrigger` 做滚动叙事 |
| 数据源说明图 | 无 | `architecture-diagram`（暗色 SVG）或 `excalidraw`（手绘风） |

### 15.8 可直接复制的提示词（网页端）

```
滚动动效：导航栏用 Sticky，首屏背景做成 Parallax，下面的卡片用 Scroll-triggered 依次淡入；
进度条用 Scroll-linked，图库一次翻一屏用 Scroll Snap，作品集用 Horizontal Scroll。

手感：用 feel（本机 skills/web/feel）——用质量/刚度/阻尼描述手感，禁止 transition 时长和 cubic-bezier；
拖拽保留释放速度、可中途打断。

玻璃：HUD 用一层 backdrop-filter: blur(18px) saturate(140%) + 1px 内高光，
不要渐变叠加、不要 ::after 斜向高光（浅色底图会变成灰白块），一屏最多两块玻璃。

排版：标题字距收紧到 -0.02em；正文行距 = 字号 × 1.5~1.8；
数字用西文字体且禁用全角；中英文之间留 1/4 字空隙；不用纯黑 #000000。
```

### 15.9 使用纪律

1. **先判断该不该动**：`emil-animate` 的第一问永远是「这个动作为用户解决了什么」，答不出来就不加。
2. **性能预算**：60 fps；`backdrop-filter` 一屏 ≤2 层；长列表用虚拟化 + `transform/opacity`，不动 layout 属性。
3. **可访问性**：`prefers-reduced-motion` 必须降级；正文对比度 ≥4.5:1，`focus-visible` 不能删。
4. **反 slop 清单**：禁紫白渐变、禁 Emoji 当项目符号、禁「圆角卡片 + 左侧色条」模板、禁 Inter/Roboto 当唯一字体、禁假 logo/假产品截图。
5. **设计文档先行**：改版前用 `design-md` 落一份 token（色/字阶/间距/圆角/动效时长），后面所有页面只引用 token，不再各写各的。

---

## 16. 附录

### 16.1 提交与版本

| 项 | 值 |
|---|---|
| commits | 59（2026-10-19 → 2026-10-24） |
| tags | `v1.0.20261023`、`backup-20261024-032441` |
| 关键提交 | `22eb452`（云托管上线）· `60a6949`（代码质量三项整改）· `b87859e`（上传排障记录）· `9dc3baa`（详情卡修复 + 自检脚本） |
| 体验版 | 1.0.0 / `async_4751052686148698112` |
| 云端版本 | `gev-api-012`（线上）、`gev-api-013`（风场优化后） |

### 16.2 关键常量

| 常量 | 值 | 用途 |
|---|---|---|
| `DOCK` | `{lx:92.5, ty:83, peek:75, holdMs:3000}` | 坞停靠与自动收起 |
| 预警色 | red `#FF4D4D` / orange `#FF963C` / yellow `#F7D247` / blue `#5AA0FF` | 四级预警 |
| 选中色 | `#FFD400`（`tint_s`） | 选中态只换色 |
| `stableMarkerId` | FNV-1a（`2166136261 × 16777619`）→ `>>>0 % 2000000000`，0 取 1 | 稳定 marker id |
| 详情重认阈值 | 同图层 + 距离 < 0.0025°（≈250 m） | key 变化后认回同一要素 |
| 风场 | `TICK_MS=100`、`CYCLE_MS=1600`、三色 `#5FD3E8` / `#F0CD3C` / `#FF5656`（<4.5 / 4.5–11 / ≥11 m/s） | 动画与配色 |
| 图标压缩 | `{"dark":(4,64),"tint":(4,64),"tint_d":(4,64),"tint_s":(4,64),"maki":(8,48),"ui":(8,48),"wx":(4,64),"icons":(4,64),"tabs":(4,64)}` | （色数, 最大边长） |

### 16.3 路径清单

| 用途 | 路径 |
|---|---|
| 小程序工程 | `D:\Hermes\gods-eye-miniprogram` |
| 网页版源 | `D:\Hermes\gods-eye-view` |
| 云托管源 | `D:\Hermes\gev-cloudrun` |
| 云函数部署副本 | `D:\Hermes\gev-proxy-deploy` |
| 开发日志 | `PROGRESS.md` + `C:\Users\13680\Desktop\.MD\docs\logs\[ProjectLogAgent]-上帝之眼小程序-改动日志.md` |
| 移出的开发产物 | `D:\Hermes\gods-eye-miniprogram-dev`（`.claude` / `.agents`） |
| 图标 base64 源字典 | `C:\Users\13680\AppData\Local\hermes\cache\scratch\iconpack.json` |

### 16.4 术语

| 术语 | 含义 |
|---|---|
| 单选聚焦 / solo | 只显示某一图层（必要时叠加风场），不改用户配置 |
| 坞 / dock | 右下角 GPS + 刷新的浮动控件，可左右停靠、自动收起 |
| 态势 / awareness | 选中目标的方位、距离、同型机等实时面板 |
| 落盘图标 / materializeIcon | 图标 base64 在运行时写入 `USER_DATA_PATH` 换取真实路径 |
| 七情况测试 | 空输入 / 连点 / 无数据 / 弱网 / 接口失败 / 无权限 / 真机 |

---

**文档结束** · 由 Hermes Agent 于 2026-10-24 归档 · 共 155 条问题记录、31 图层、32 数据源
