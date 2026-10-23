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
