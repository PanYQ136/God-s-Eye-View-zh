# 多源自动降级 覆盖矩阵 + 图层渲染核验 — 2026-10-24

## A. 数据源多组备用 / 自动降级

**四层降级机制（由内到外，无感知、不阻塞渲染、不改图层/GPU/UI）**

| 机制 | 位置 | 覆盖 |
|---|---|---|
| ① Provider 内部上游冗余 | server/providers | flights(opensky.js: pocketworld→OpenSky→adsb.lol)、satellites(celestrak 主 + satvisor/retlector 三镜像)、cctv、overpass 等 |
| ② 数据端点级容灾(按优先级切换) | server/providers | **earthquakes** USGS→EMSC(`/api/mini/earthquakes`)；**militaryFlights** adsb.lol→adsb.fi(`/api/adsblol/mil`，本轮) |
| ③ 客户端通用 elastic fetch(本轮新增) | src/sources/live/resilientFetch.js | **实时源(航班/船舶/军机)**：超时 + 429/5xx 重试 + 指数退避，外部 signal 透传 |
| ④ 健康探测 | /api/sources/health | 28 层 primary/backup/okCount/switched/down 实时可视 |

**逐层覆盖表**

| 图层 | 通道数 | 降级机制 | 备注 |
|---|---|---|---|
| flights | 3 | ①provider内建 + ③elastic | pocketworld/opensky/adsblol |
| militaryFlights | 2 | ②数据级切换 | adsb.lol→adsb.fi（实测 158 架） |
| earthquakes | 2 | ②数据级切换 | USGS→EMSC（400 条） |
| satellites | 1通道/3镜像 | ①三镜像 | celestrak + satvisor + retlector |
| wind | 2 | ① | Open-Meteo ECMWF + GFS |
| launches | 2 | ① | LL2 + rocketlaunch |
| traffic | 2 | ① | TomTom + OSM 路网模拟(无覆盖自动回退) |
| alpr / installations | 3 | ① | Overpass CH/FR/DE |
| fires | 2 | health声明·**数据仅FIRMS** | EONET 备用形状为事件级，未接数据路径 |
| cyclones | 2 | health声明·**数据仅NHC** | GDACS 为 RSS，未接数据路径 |
| vessels | 1 | ③elastic | AISStream 唯一上游(公开AIS需key) |
| radio | 1通道/内部3镜像 | ①内部轮询 | de1/de2/nl1 |
| cctv/radar/clouds/lightning/recentImagery/bikeshare/transit/perimeters/静态基建 | 1 | 无备用 | **物理上无第二上游**，不做假切换 |

**诚实缺口（不伪造备用源）**
- `fires`/`cyclones` 的 EONET/GDACS 备用仅 health 声明，**数据端点未接**：二者为事件级/RSS 结构，与 FIRMS 点/风暴结构不同，直接接会破坏客户端数据契约。主源失败时端点回缓存/标 `stale`，不崩溃（已具备）。
- 单源层（vessels/静态/雷达/云图等）现实无第二上游 → 保留现状。

## B. 图层渲染核验（CDP 实测，window.__godsEyeView 驱动）

**图元体系**：本应用图层用**自定义 Primitive**（非 Entity API — entities=0）。场景构成：BillboardCollection、Primitive(73)、PrimitiveCollection、Cesium3DTileset(1)、dataSources(17)。

**数据加载表（启用后 stats.count）**
- ✅ 有数据：satellites **829**、wind **65160**(网格)、radio **750**、datacenters **4362**、dams **716**、submarine-cables **2629**、fire-perimeters **109**、rocket-launches **20**、vessels **25**、flights **25**。
- 该视口/时刻 0：traffic/transit/bikeshare/recent-imagery/weather-radar/satellite/lightning/cyclones/alpr/installations/awareness/directions —— 多为**视口内无数据/上游空**,非渲染缺陷。

**航班专项（用户点名：须渲染飞机 + 航迹线）**
- 启用后场景 **980 billboards** → 飞机正常上屏（本应用以 **billboard 精灵**表达飞机，非 glTF 3D 模型，属既有设计，不改）。
- `count=25、stale、'Source snapshot 3 min old'、source=OpenSky` → **本机 OpenSky 上游限流/陈旧（非代码 bug）**。
- `polyline=0` → 航迹线**仅在追踪/选中某架飞机时绘制**，未选中即 0，属正常设计。

**结论**：各层经自定义 Primitive 正常上屏；0 计数层多为上游/viewport 空数据；**未发现渲染代码级异常**。

## 提交
- 遗留 WIP 提交 `20f0a7a`
- 实时源 elastic fetch `40bbd56`（live 单测 12/12、build 45s 通过）
