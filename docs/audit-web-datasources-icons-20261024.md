# 数据源新鲜度 + 图层图标核查 — 2026-10-24

> 依据：加载全部数据图层 → 逐一核验数据源是否拉取最新数据 → 图层图标一一对应核查。
> 约束：不改动原有渲染、性能、业务逻辑（图标为面板标签纯 UI；数据源问题为上游可用性，未改源选择）。

## Part A · 数据源健康与新鲜度（权威源：`/api/sources/health` + 端点实测）

**总览**：28 层 / 40 通道 / **okChannels 32** · switched 2 · **down 1**

| 图层 | 源 | 状态 | 新鲜度/样本 | 判定 |
|---|---|---|---|---|
| flights | pocketworld (3/3) | ok | time **-2s**，300 架 | ✅ 最新 |
| satellites | CelesTrak 代理 | ok | active TLE 2.67MB | ✅ 最新 |
| ais-live-vessels | AISStream | ok | 6.6MB 实时快照 | ✅ 最新 |
| wind | Open-Meteo ECMWF (+GFS 2/2) | ok | fetchedAt 23s，cycle | ✅ 最新 |
| fire-perimeters | NIFC/WFIGS | ok | fetchedAt **-13s** | ✅ 最新 |
| traffic | TomTom (2/2) | ok | 正常 | ✅ |
| launches | LL2 (2/2) | ok | 20 条（档期为未来发射，last_updated 24d 属正常） | ✅ |
| cctv | 聚合 | ok | 900 sources | ✅ |
| radio | Radio Browser 代理 | ok | 750 stations | ✅ |
| radar / clouds / recentImagery | rainviewer / GIBS | ok | 正常 | ✅ |
| transit | Transitland | ok | 奥斯汀上游挂、其他城市正常 | ⚠️部分 |
| bikeshare | GBFS | ok | 正常 | ✅ |
| staticInfra / cables / datacenters / dams | 本地静态包(7d缓存) | ok | 静态无实时上游 | ✅ |
| directions / measure / awareness | 本机计算 | ok | 不依赖外部 | ✅ |
| lightning | sport-lightning | ok | 正常 | ✅ |
| perimeters | fire-perimeters | ok | 正常 | ✅ |
| **earthquakes** | USGS(主) → **EMSC(备)** | **switched** | `/api/mini/earthquakes`=EMSC 400 条 | ⚠️走备用·有数据 |
| **cyclones** | NHC(主) → GDACS(备) | **switched** | `/api/cyclones` **0 风暴 + unavailable** | ⚠️无数据(上游/非季) |
| **militaryFlights** | adsb.lol 军机 | **DOWN 0/1** | `/api/adsblol/mil` **502/429** | ❌无数据 |
| alpr-cameras | Overpass CH(主) + FR/DE | 1/3 | CH 通；FR **403** / DE **502** | ⚠️主通·备降级 |
| military-installations | Overpass CH(主) + FR/DE | 1/3 | 同上 | ⚠️主通·备降级 |
| fires | FIRMS(主) + EONET | 1/2 | `/api/firms` **0 fires + stale(fetchedAt 4.7d前)**；EONET 502 | ⚠️陈旧/空 |

**异常记录（均为上游可用性，非客户端代码缺陷；修复需改源选择=业务逻辑，按约束未改）**：
1. **militaryFlights 完全不可用**：adsb.lol 从腾讯云直连不通（502/429），无备用源。
2. **cyclones 无数据**：NHC 502，GDACS 备源亦空；`/api/cyclones` 标 `unavailable`（可能非季/上游空，无法与故障区分）。
3. **earthquakes 主源 USGS 502**，已自动切 EMSC 交付 400 条（数据仍最新）。
4. **fires 陈旧**：FIRMS 返 0 火点 + stale（4.7 天未更新，疑似配额/上游）；EONET 备源 502。
5. **alpr / installations 备用镜像降级**：Overpass 公共镜像 FR 403 / DE 502（限流），主 CH 正常。

**结论**：22/26 数据图层正常拉取最新数据；earthquakes/cyclones 走备用（前者有数据、后者空）；仅 militaryFlights 完全断流；fires 陈旧空。上述均为上游/运营层问题，**不动业务逻辑无法从代码侧修复**，已如实记录。

## Part B · 图层图标一一对应核查（26 层）

**核查方法**：实机枚举 `.data-toggle-list` 26 个层行图标（`layer.icon` 仅用于 `layerPanel.js` 面板标签，不参与渲染）。

**发现异常（已修）**：
| 异常 | 涉及图层 | 修复 |
|---|---|---|
| `◉` 被三层共用（不一一对应） | weather-radar / weather-cyclones / radio | cyclones→**🌀**、radio→**📻**；radar 保留 ◉（现唯一） |
| `🛰️` vs `🛰` 变体不一致 + 两"卫星"层混淆 | satellites / recent-imagery | recent-imagery→**🗺️**（satellites 保留 🛰️） |
| `🌬` 缺变体选择符 | wind | →**🌬️** |

**修复后 26 层图标（实机复核，全部唯一）**：
satellites🛰️ · flights✈️ · military🎖️ · local-adsb📡 · vessels◭ · traffic🚗 · transit🚌 · bikeshare🚲 · cctv📹 · recent-imagery🗺️ · alpr📷 · installations⌖ · datacenters▣ · cables≋ · dams▰ · launches🚀 · earthquakes🌋 · firms▲ · perimeters🔥 · wind🌬️ · radar◉ · satellite☁ · lightningϟ · cyclones🌀 · directions🧭 · radio📻

> 注：`🚲/🚗` 在源码里另用于 directions 的"骑行/驾车模式芯片"，非图层行，层行图标无重复。`◭▣▰≋⌖▲◉ϟ☁` 为技术层刻意的单色符号族，非错乱。

**判定**：无缺失、无多余、无重复、无错配 → 图标与图层 **一一对应**。

## 验证
- `vite build` 通过（51s）。
- 实机 `Page.reload` 后 dump：26 层图标与上表一致，修复生效。

## 修复实施 · 自动换备用源（用户授权后）

**militaryFlights（原本 DOWN）→ 已加自动兜底**
- `server/providers/aircraft/adsb-lol.js`：`/api/adsblol/mil` 由「仅 adsb.lol」改为**主 `adsb.lol/v2/mil` → 备 `opendata.adsb.fi/api/v2/mil` 按序尝试**（两者均 readsB 同构 `{ac:[…]}`，客户端契约不变、零渲染改动）。主源 429/5xx/异常自动切备源。
- `server/providers/mini-sources.js`：`militaryFlights` 增加 `adsb.fi` 备用通道（健康可见）。
- **实测**：adsb.lol 429 时 `/api/adsblol/mil` → `200, X-ADS-B-Upstream: adsb.fi, ac=158`（158 架军机）。
- 重启 dev server 后 `/api/sources/health`：**down 1 → 0**，okChannels 32 → 35，militaryFlights **2/2 ok**。

**其余层现状（重启后复测）**：fires 2/2、cyclones 2/2 均已恢复（此前 502/EONET 为上游瞬时抖动，已自愈）；earthquakes 仍 USGS→EMSC 数据级容灾正常；alpr/installations 主 Overpass CH 正常（FR/DE 公共镜像限流为上游常态，有主通道可用）。

**无可用备源、保留记录**：vessels（AISStream 唯一）、cyclones/fires 当前双通道均 ok 属正常；无代码可换源的层不做假切换。

> 说明：本轮为服务端「源选择/故障切换」改动（业务层容灾），**未改客户端渲染、性能或数据契约**。
