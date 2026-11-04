/**
 * 图层数据源：主通道 + 备用通道（健康探测 + 自动切换）
 *
 * 为什么放在服务端：
 * - 第三方 key、代理、缓存都在服务端，客户端只认一个地址；
 * - 上游能不能用，只有服务端探得准（真机/小程序端会被域名白名单干扰）；
 * - 探测结果缓存 60s，避免把 27 个图层的上游打死。
 *
 * 端点：
 *   GET /api/sources/health         → 每个图层每个通道的 ok/ms，以及当前选中的主通道
 *   GET /api/mini/earthquakes?...   → USGS 主通道，EMSC 备用，输出统一 quakes[]
 */

const PROBE_TIMEOUT = 30000; // 慢源（CelesTrak 22s / Radio Browser 24s）9s 会被误判 down
const PROBE_TIMEOUT_HEAVY = 25000; // 本机聚合端点（cctv/影像/静态包）本身要十几秒
// 云托管里没有 4173（那是本机 dev server），必须跟着 PORT 走，
// 否则所有 local:true 的通道都探到 ECONNREFUSED → 健康面板一片「down」。
const LOCAL =
  String(process.env.GEV_LOCAL_BASE || '').replace(/\/$/, '') ||
  `http://127.0.0.1:${process.env.PORT || 4173}`;
const CACHE_TTL = 60 * 1000;

const UA = 'gods-eye-mini/1.0 (+local proxy)';

/**
 * 通道表：layerId → [{ id, label, url, kind, note }]
 * kind: 'json' 只验证 HTTP 2xx 且能解析；'text' 只看状态码
 * 说明写在 note 里，直接透到设置页给用户看。
 */
const CHANNELS = {
  flights: [
    {
      id: 'pocketworld',
      label: 'pocketworld',
      url: 'https://pocketworld.org/api/flights?limit=1',
      kind: 'json',
      note: '聚合 OpenSky + ADSB.fi + ADSB.lol，主通道',
    },
    {
      id: 'opensky',
      label: 'OpenSky',
      url: 'https://opensky-network.org/api/states/all?lamin=0&lomin=0&lamax=0.5&lomax=0.5',
      kind: 'json',
      note: '备用：官方直连，匿名限流 400 次/天',
    },
    {
      id: 'adsblol',
      label: 'adsb.lol',
      url: 'https://api.adsb.lol/v2/point/0/0/10',
      kind: 'json',
      note: '备用：社区源，军机覆盖好',
    },
  ],
  militaryFlights: [
    {
      id: 'adsblol-mil',
      label: 'adsb.lol 军机',
      url: `${LOCAL}/api/adsblol/mil`,
      kind: 'json',
      local: true,
      timeout: PROBE_TIMEOUT_HEAVY,
      note: '主通道：本地 /api/adsblol/mil 代理（内部 adsb.lol→adsb.fi 自动兜底）',
    },
    {
      id: 'adsbfi-mil',
      label: 'adsb.fi 军机',
      url: 'https://opendata.adsb.fi/api/v2/mil',
      kind: 'json',
      note: '备用：adsb.fi 军机快照（readsB 同构，实测 200/~155 架），adsb.lol 限流时自动切此',
    },
  ],
  vessels: [
    {
      id: 'ais-live',
      label: 'AISStream',
      url: `${LOCAL}/api/ais-live?limit=1`,
      kind: 'json',
      local: true,
      note: '唯一上游是 AISStream WebSocket 快照；公开 AIS 源基本都要 key，暂无可直连备用源',
    },
  ],
  // 探自己的聚合端点，而不是直连上游：celestrak.org 从腾讯云直连会 TLS reset，
  // 但 /api/celestrak/stations 有 GitHub 镜像兜底，实际给小程序的数据是好的。
  satellites: [
    {
      id: 'celestrak-proxy',
      label: 'CelesTrak（服务端代理）',
      url: `${LOCAL}/api/celestrak/stations`,
      kind: 'text',
      local: true,
      timeout: PROBE_TIMEOUT_HEAVY,
      note: '主通道：服务端 TLE 目录 + SGP4 推算，含 GitHub 镜像兜底',
    },
  ],
  earthquakes: [
    {
      id: 'usgs',
      label: 'USGS',
      url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
      kind: 'json',
      note: '主通道，全球 24h',
    },
    {
      id: 'emsc',
      label: 'EMSC',
      url: 'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=20&orderby=time',
      kind: 'json',
      note: '备用：欧洲-地中海地震中心，全球覆盖',
    },
  ],
  fires: [
    {
      id: 'firms',
      label: 'NASA FIRMS',
      url: `${LOCAL}/api/firms?bbox=119,25.9,120,26.2`,
      kind: 'json',
      local: true,
      note: '主通道：VIIRS 热点（服务端持 MAP_KEY）',
    },
    {
      id: 'eonet',
      label: 'NASA EONET',
      url: 'https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&limit=1',
      kind: 'json',
      note: '备用：野火事件级（有火场中心，无逐点热点）',
    },
  ],
  cctv: [
    {
      id: 'cctv-agg',
      label: 'CCTV 聚合',
      url: `${LOCAL}/api/cctv/sources`,
      kind: 'json',
      local: true,
      timeout: PROBE_TIMEOUT_HEAVY,
      note: '服务端聚合多家公开目录（state DOT / insecam 等）',
    },
  ],
  traffic: [
    {
      id: 'tomtom',
      label: 'TomTom 流速',
      url: `${LOCAL}/api/traffic-flow?bbox=-74.02,40.70,-73.97,40.74&zoom=12&limit=5`,
      kind: 'json',
      local: true,
      timeout: PROBE_TIMEOUT_HEAVY,
      note: '主通道：真实流速（中国大陆无覆盖，自动回退路网模拟）',
    },
    {
      id: 'osm-sim',
      label: 'OSM 路网模拟',
      url: `${LOCAL}/api/traffic-flow?bbox=119.2,26.0,119.4,26.1&zoom=12&limit=5`,
      kind: 'json',
      local: true,
      timeout: PROBE_TIMEOUT_HEAVY,
      note: '备用：无覆盖区按路网几何模拟车速',
    },
  ],
  wind: [
    {
      id: 'open-meteo',
      label: 'Open-Meteo',
      url: 'https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&hourly=wind_speed_10m&forecast_days=1',
      kind: 'json',
      note: '主通道：ECMWF 风场网格',
    },
    {
      id: 'open-meteo-gfs',
      label: 'Open-Meteo(GFS)',
      url: 'https://api.open-meteo.com/v1/gfs?latitude=0&longitude=0&hourly=wind_speed_10m&forecast_days=1',
      kind: 'json',
      note: '备用：同服务 GFS 端点',
    },
  ],
  // 探自己的聚合端点：radio-browser.info 三个镜像对高频探测会集体 fetch failed，
  // 且 /api/radio/stations 本身就在 de1/de2/nl1 之间轮询，探它才代表真实可用性。
  radio: [
    {
      id: 'radio-proxy',
      label: 'Radio Browser（服务端轮询）',
      url: `${LOCAL}/api/radio/stations`,
      kind: 'json',
      local: true,
      timeout: PROBE_TIMEOUT_HEAVY,
      note: '主通道：服务端在 de1/de2/nl1 三镜像间轮询，返回电台目录',
    },
  ],
  launches: [
    {
      id: 'll2',
      label: 'Launch Library 2',
      url: 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=1',
      kind: 'json',
      note: '主通道：发射计划 + 轨道/箭体',
    },
    {
      id: 'rocketlaunch',
      label: 'RocketLaunch.Live',
      url: 'https://fdo.rocketlaunch.live/json/launches/next/1',
      kind: 'json',
      note: '备用：只含时间/地点/任务名',
    },
  ],
  cyclones: [
    {
      id: 'nhc',
      label: 'NOAA NHC',
      url: 'https://www.nhc.noaa.gov/CurrentStorms.json',
      kind: 'json',
      note: '主通道：大西洋/东太平洋；西北太平洋为空属正常',
    },
    {
      id: 'gdacs',
      label: 'GDACS',
      url: 'https://www.gdacs.org/xml/rss.xml',
      kind: 'text',
      note: '备用：全球灾害聚合（含气旋，RSS）',
    },
  ],
  staticInfra: [
    {
      id: 'infra-static',
      label: '基础设施包',
      url: `${LOCAL}/api/infra/static/cables`,
      kind: 'json',
      local: true,
      note: '光缆/数据中心/水坝（本地静态包，端内缓存 7 天）',
    },
  ],
  cables: [
    {
      id: 'cables-static',
      label: '海底光缆包',
      url: `${LOCAL}/api/infra/static/cables`,
      kind: 'json',
      local: true,
      note: '静态数据（TeleGeography 整理），无实时上游',
    },
  ],
  datacenters: [
    {
      id: 'dc-static',
      label: '数据中心包',
      url: `${LOCAL}/api/infra/static/datacenters`,
      kind: 'json',
      local: true,
      note: '静态数据，端内缓存 7 天',
    },
  ],
  dams: [
    {
      id: 'dams-static',
      label: '水坝包',
      url: `${LOCAL}/api/infra/static/dams`,
      kind: 'json',
      local: true,
      note: '静态数据，端内缓存 7 天',
    },
  ],
  perimeters: [
    {
      id: 'fire-perimeters',
      label: '火场边界',
      url: `${LOCAL}/api/fire-perimeters?bbox=119,25.9,120,26.2`,
      kind: 'json',
      local: true,
      note: '主通道：NIFC/WFIGS 边界聚合（只在有大火场时有数据）',
    },
  ],
  radar: [
    {
      id: 'rainviewer',
      label: 'RainViewer',
      url: 'https://api.rainviewer.com/public/weather-maps.json',
      kind: 'json',
      note: '主通道：全球雷达拼图瓦片',
    },
  ],
  clouds: [
    {
      id: 'gibs-clouds',
      label: 'NASA GIBS 云图',
      url: `${LOCAL}/api/weather/manifest?product=clouds`,
      kind: 'json',
      local: true,
      note: '主通道：GIBS WMS 云图（服务端出图）',
    },
  ],
  lightning: [
    {
      id: 'sport-lightning',
      label: 'NASA SPoRT 闪电密度',
      url: `${LOCAL}/api/weather/manifest?product=lightning`,
      kind: 'json',
      local: true,
      note: '主通道：15 分钟闪电密度栅格（太平洋/美洲覆盖）',
    },
  ],
  alpr: [
    {
      id: 'overpass-ch',
      label: 'Overpass CH',
      url: 'https://overpass.osm.ch/api/interpreter',
      kind: 'json',
      body: '[out:json][timeout:15];node(1);out 1;',
      note: '主通道：瑞士镜像，实测 1.2s（本机走/不走代理都通）',
    },
    {
      id: 'overpass-fr',
      label: 'Overpass FR',
      url: 'https://overpass.openstreetmap.fr/api/interpreter',
      kind: 'json',
      body: '[out:json][timeout:15];node(1);out 1;',
      note: '备用 1：法国镜像，实测 ~1.3-2.4s',
    },
    {
      id: 'overpass-de',
      label: 'Overpass DE',
      url: 'https://overpass-api.de/api/interpreter',
      kind: 'json',
      body: '[out:json][timeout:15];node(1);out 1;',
      note: '备用 2：全球主镜像，限流严重（经常 429）',
    },
  ],
  installations: [
    {
      id: 'overpass-ch-inst',
      label: 'Overpass CH',
      url: 'https://overpass.osm.ch/api/interpreter',
      kind: 'json',
      body: '[out:json][timeout:15];node(1);out 1;',
      note: '主通道：军事设施 query',
    },
    {
      id: 'overpass-fr-inst',
      label: 'Overpass FR',
      url: 'https://overpass.openstreetmap.fr/api/interpreter',
      kind: 'json',
      body: '[out:json][timeout:15];node(1);out 1;',
      note: '备用 1',
    },
    {
      id: 'overpass-de-inst',
      label: 'Overpass DE',
      url: 'https://overpass-api.de/api/interpreter',
      kind: 'json',
      body: '[out:json][timeout:15];node(1);out 1;',
      note: '备用 2（限流严重）',
    },
  ],
  transit: [
    {
      id: 'transitland',
      label: 'Transitland',
      url: `${LOCAL}/api/transit/feeds`,
      kind: 'json',
      local: true,
      note: '主通道：按城市 GTFS-RT（奥斯汀上游已挂，其他城市正常）',
    },
  ],
  bikeshare: [
    {
      id: 'gbfs',
      label: 'GBFS',
      url: 'https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json',
      kind: 'json',
      note: '主通道：按城市 GBFS 目录（美/欧/澳）',
    },
  ],
  recentImagery: [
    {
      id: 'gibs-imagery',
      label: 'NASA GIBS 影像',
      url: `${LOCAL}/api/imagery/available?layer=VIIRS_SNPP_CorrectedReflectance_TrueColor&days=2&bbox=119,25.9,120,26.2`,
      kind: 'json',
      local: true,
      timeout: PROBE_TIMEOUT_HEAVY,
      note: '主通道：当日真彩（NASA 当日无图时为空）',
    },
  ],
  directions: [
    {
      id: 'local',
      label: '本机计算',
      url: `${LOCAL}/api/cyclones`,
      kind: 'json',
      local: true,
      note: '不依赖外部数据源（本机估算）',
    },
  ],
  measure: [
    {
      id: 'local',
      label: '本机计算',
      url: `${LOCAL}/api/cyclones`,
      kind: 'json',
      local: true,
      note: '不依赖外部数据源（本机精度计算）',
    },
  ],
  awareness: [
    {
      id: 'local',
      label: '端内聚合',
      url: `${LOCAL}/api/cyclones`,
      kind: 'json',
      local: true,
      note: '不依赖外部数据源（客户端按已加载图层聚合）',
    },
  ],
};

let cache = { at: 0, rows: null };

async function probe(ch) {
  // 5xx/网络抖动会瞬时把整层判成 down（实测 fire-perimeters 偶发 502），
  // 探两次都失败才算挂。
  const first = await probeOnce(ch);
  if (first.ok) return first;
  await new Promise((r) => setTimeout(r, 1200));
  const second = await probeOnce(ch);
  return second.ok ? second : first;
}

async function probeOnce(ch) {
  const t0 = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ch.timeout || PROBE_TIMEOUT);
  try {
    const r = await fetch(ch.url, {
      method: ch.body ? 'POST' : 'GET',
      body: ch.body || undefined,
      signal: ac.signal,
      headers: {
        'User-Agent': UA,
        Accept: ch.kind === 'json' ? 'application/json' : '*/*',
      },
      redirect: 'follow',
    });
    let ok = r.status >= 200 && r.status < 400;
    if (ok && ch.kind === 'json') {
      // 不能只解析前 N 个字符：大响应被截断后必然 parse 失败，
      // 会让 cables/cctv/perimeters 这类几百 KB 的层被误判成「全挂」。
      try {
        await r.json();
      } catch (e) {
        ok = false;
      }
    } else if (ok) {
      await r.text();
    }
    return {
      id: ch.id,
      label: ch.label,
      ok,
      status: r.status,
      ms: Date.now() - t0,
      note: ch.note,
      local: !!ch.local,
    };
  } catch (err) {
    return {
      id: ch.id,
      label: ch.label,
      ok: false,
      status: 0,
      ms: Date.now() - t0,
      note: ch.note,
      error: String((err && err.message) || err).slice(0, 80),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function buildHealth() {
  const ids = Object.keys(CHANNELS);
  const out = {};
  // 同一 URL（含 POST body）只探一次：Overpass 有 1 req/s 限流，
  // alpr 和 installations 共用镜像，重复探会把两边都探成 429。
  const memo = new Map();
  const probeOnce = (ch) => {
    const key = ch.url + '|' + (ch.body || '');
    if (!memo.has(key)) memo.set(key, probe(ch));
    return memo
      .get(key)
      .then((r) => ({ ...r, id: ch.id, label: ch.label, note: ch.note }));
  };
  await Promise.all(
    ids.map(async (layer) => {
      const list = await Promise.all(CHANNELS[layer].map(probeOnce));
      const primary = list.find((c) => c.ok) || list[0];
      out[layer] = {
        channels: list,
        primary: primary ? primary.id : null,
        primaryLabel: primary ? primary.label : '',
        okCount: list.filter((c) => c.ok).length,
        total: list.length,
        // switched=true 表示主通道挂了、已经自动降到备用通道
        switched: !(list[0] && list[0].ok) && !!primary && primary.ok,
        // down=true 表示这层现在一条通道都不通，前端要明确提示「该层暂无数据」
        down: list.every((c) => !c.ok),
      };
    }),
  );
  return out;
}

/** USGS → EMSC 容灾：GET /api/mini/earthquakes?feed=all_day&limit=300 */
async function quakesHandler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const limit = Math.max(
    1,
    Math.min(600, Number(url.searchParams.get('limit')) || 300),
  );
  const send = (status, payload) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'max-age=120',
    });
    res.end(JSON.stringify(payload));
  };

  // 主通道：USGS
  const usgs = await fetchJsonSafe(
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
    15000,
  );
  if (usgs.ok) {
    const feats = (usgs.data && usgs.data.features) || [];
    const quakes = feats
      .map((f) => {
        const c = (f.geometry && f.geometry.coordinates) || [];
        const p2 = f.properties || {};
        return {
          id: f.id || p2.code,
          lat: c[1],
          lon: c[0],
          depthKm: c[2],
          mag: p2.mag,
          place: p2.place,
          time: p2.time,
          updated: p2.updated,
          url: p2.url,
        };
      })
      .filter(
        (q) => Number.isFinite(Number(q.lat)) && Number.isFinite(Number(q.lon)),
      );
    if (quakes.length) {
      return send(200, {
        source: 'usgs',
        channel: 'usgs',
        count: quakes.length,
        quakes: quakes.slice(0, limit),
      });
    }
  }

  // 备用：EMSC（欧洲-地中海地震中心，全球覆盖）
  const emsc = await fetchJsonSafe(
    'https://www.seismicportal.eu/fdsnws/event/1/query?format=json&limit=400&orderby=time',
    18000,
  );
  if (emsc.ok) {
    const feats = (emsc.data && emsc.data.features) || [];
    const quakes = feats
      .map((f) => {
        const c = (f.geometry && f.geometry.coordinates) || [];
        const p2 = f.properties || {};
        return {
          id: p2.unid || p2.source_id,
          lat: c[1],
          lon: c[0],
          depthKm: c[2],
          mag: p2.mag,
          place: p2.flynn_region,
          time: p2.time ? Date.parse(p2.time) : null,
          updated: p2.lastupdate ? Date.parse(p2.lastupdate) : null,
          url: p2.url,
        };
      })
      .filter(
        (q) => Number.isFinite(Number(q.lat)) && Number.isFinite(Number(q.lon)),
      );
    if (quakes.length) {
      return send(200, {
        source: 'emsc',
        channel: 'emsc',
        count: quakes.length,
        quakes: quakes.slice(0, limit),
      });
    }
  }

  return send(502, {
    error: 'all_channels_failed',
    channels: ['usgs', 'emsc'],
  });
}

async function fetchJsonSafe(url, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, data: await r.json() };
  } catch (err) {
    return { ok: false, status: 0, error: String((err && err.message) || err) };
  } finally {
    clearTimeout(timer);
  }
}

import { sendJson } from './send-json.js';

export function miniSourcesProxy() {
  // 探活要打 43 个上游通道，冷启动一次 16 秒。旧实现是「请求来了才建」，
  // 小程序设置页每次冷启动都会卡 16 秒。这里改成：
  //   ① 服务站起来就后台预热一次；
  //   ② 有缓存就立刻返回（过期也先给，标 stale，同时后台刷新）；
  //   ③ 一次都没有时立刻返回 building:true，客户端轮询，别把连接吊着。
  let building = null;
  function ensureBuild() {
    if (building) return building;
    building = buildHealth()
      .then((rows) => {
        cache = { at: Date.now(), rows };
        return rows;
      })
      .catch(() => null)
      .finally(() => {
        building = null;
      });
    return building;
  }
  // 预热属于「服务器生命周期」，不属于「构造插件」。构造发生在配置文件导入、
  // 单元测试和路由捕获等场景，那时还没有任何服务器，也没有人要看 health；
  // 在构造里放定时器会让任何一次 import 都在 1.5 秒后打出 40+ 路真实上游
  // 探测，既污染调用方的 fetch，也让一次性脚本/测试进程被挂住。只在 Vite
  // 真正挂载中间件时调度，dev 与 preview 都挂载时只调度一次。
  let warmupScheduled = false;
  function scheduleWarmup() {
    if (warmupScheduled) return;
    warmupScheduled = true;
    const timer = setTimeout(() => {
      void ensureBuild();
    }, 1500);
    // 预热不该把一个没有其它 handle 的进程钉住（测试、构建脚本、SSR）。
    timer.unref?.();
  }

  const healthHandler = async (req, res) => {
    const has = !!(cache.rows && Object.keys(cache.rows).length);
    const age = Date.now() - (cache.at || 0);

    if (has) {
      // 先返回旧数据，过期就在后台刷新（stale-while-revalidate）
      if (age >= CACHE_TTL && !building) ensureBuild();
    } else {
      ensureBuild();
      sendJson(
        req,
        res,
        200,
        {
          at: 0,
          building: true,
          summary: {
            layers: 0,
            switched: 0,
            down: 0,
            channels: 0,
            okChannels: 0,
          },
          layers: {},
        },
        { 'Cache-Control': 'no-store' },
      );
      return;
    }

    const rows = cache.rows || {};
    const summary = Object.keys(rows).reduce(
      (acc, k) => {
        acc.layers += 1;
        if (rows[k].switched) acc.switched += 1;
        if (rows[k].down) acc.down += 1;
        acc.channels += rows[k].total || 0;
        acc.okChannels += rows[k].okCount || 0;
        return acc;
      },
      { layers: 0, switched: 0, down: 0, channels: 0, okChannels: 0 },
    );

    sendJson(
      req,
      res,
      200,
      {
        at: cache.at,
        stale: age >= CACHE_TTL,
        building: !!building,
        summary,
        layers: rows,
      },
      {
        'Cache-Control': 'max-age=30',
        'x-sources-cache': age >= CACHE_TTL ? 'stale' : 'hit',
      },
    );
  };

  return {
    name: 'mini-sources',
    configureServer({ middlewares }) {
      middlewares.use('/api/sources/health', healthHandler);
      middlewares.use('/api/mini/earthquakes', quakesHandler);
      scheduleWarmup();
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/sources/health', healthHandler);
      middlewares.use('/api/mini/earthquakes', quakesHandler);
      scheduleWarmup();
    },
  };
}

/** 供其它 provider 复用：取某层的可用通道（按顺序） */
export function channelsFor(layerId) {
  return CHANNELS[layerId] || [];
}
