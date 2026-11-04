/* ════════════════════════════════════════════════════════════════════════════
   tileWarmup.js —— 冷启动「提前取 + 缓存」关键路径资源（只搬运，不改渲染/判据）
   ----------------------------------------------------------------------------
   Phase6C4 基线（.gev-logs/lc/boot/冷启动基线-20261030.md）证实的两个真等待：
     ① `tileset:fetch`（prod 2 573 ms）：ion `/v1/assets/2275207/endpoint`
        （实测 0.7–2.1 s，`cache-control: no-cache`，不可 HTTP 缓存）→ 再串行
        `root.json`（0.9 s），且都要等 `viewer:ready` 之后才发起；
     ② `tileset:added → view:content`（prod 7 222 ms）：Google 3D Tiles
        **父→子串行阶梯**（探针实测 96–167 个瓦片请求，飞行期只发 3–8 个，
        其余落位后才发；单条 p50 304 ms）。

   本模块做两件「不改行为」的事：
     A. `warmIonAsset()` —— 在 `main:entry` 就发起 ion 端点请求，把 JSON 交给
        `createGoogleIonTileset` 直接构造 `IonResource`（attributions 走同一条
        `getCreditsFromEndpoint`，版权不变），于是端点往返从关键路径上消失。
     B. `startTilePrefetch()` —— 端点一回来就取 root.json，**并行**把
        ① root.json 里全部深度 2/3 瓦片（8+24 个，合计约 0.4 MB，任何目标都要）、
        ② 目标中心链路上每一层的 `.glb`（0.5–1.5 MB）与外部 `.json`
        预取进 HTTP 缓存。Google 瓦片响应是
        `Cache-Control: private, max-age=14400`（实测），Cesium 之后的同 URL
        请求直接命中缓存（≈0 ms），父→子阶梯的网络等待被抽掉。

   为什么不是「改 Cesium 的遍历」：Cesium 的 implicit/explicit 递归必须拿到父级
   内容才能算子级，这是正确性依赖，不该绕开。我们只把「网络往返」换成「缓存命中」。

   目标中心：`announceBootCenter({lon,lat})` 由 gev-autolocate 在拿到快速定位
   （高德 IP / 本地缓存，通常 <1 s）时立刻广播；没广播就用 localStorage 上次位置，
   再兜底福州（与 gev-autolocate 的 HOME 一致）。

   诊断：`window.__gevTileWarm = { stats() }`
     stats() = { endpoint: {ms}, root: {ms}, tiles: n, bytes, hits, errors,
                 chain: [{ge, ext, ms}], phases: [...] }
   全部失败静默降级（回落到原来的串行路径），绝不阻塞启动。
   ════════════════════════════════════════════════════════════════════════════ */
import * as timeline from '../boot-timeline.js';

const ION_ASSET_ID = 2275207;
const ION_ENDPOINT = (assetId, token) =>
  `https://api.cesium.com/v1/assets/${assetId}/endpoint?access_token=${encodeURIComponent(token)}`;

/* gev-autolocate 的 HOME（福州东景家园）—— 只在既没有广播也没有缓存时兜底 */
const HOME = { lon: 119.349185, lat: 26.067452 };

const now = () =>
  typeof performance !== 'undefined' ? +performance.now().toFixed(1) : 0;

const DEFAULTS = {
  maxTiles: 72, // 预取请求数上限（含外部 json）
  maxBytes: 14 * 1024 * 1024, // 预取字节上限，超了就停（不跟关键请求抢带宽）
  concurrency: 5, // 同时在飞的预取请求（Cesium 自己的瓦片请求优先级更高）
  minGeometricError: 24, // 追到 ~24 m 几何误差（12 km 高度 SSE=2 约需 36 m）
  wideGeometricError: 9000, // 几何误差小于这个值的层，额外带上视口半径内的兄弟瓦片
  viewRadiusM: 3600, // 中心 640×420 在 12 km 高度约覆盖 6.5×4.6 km → 半径 ~3.3 km
  centerWaitMs: 6000, // 等定位广播的上限；超时用缓存/HOME
};

/* ── 几何：WGS84 → ECEF，tileset box（有向包围盒）点包含/距离 ─────────────── */
const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

function ecefFromDegrees(lon, lat, height = 0) {
  const rel = (Math.PI / 180) * lat;
  const rlo = (Math.PI / 180) * lon;
  const sin = Math.sin(rel);
  const cos = Math.cos(rel);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sin * sin);
  return [
    (n + height) * cos * Math.cos(rlo),
    (n + height) * cos * Math.sin(rlo),
    ((1 - WGS84_E2) * n + height) * sin,
  ];
}

const len3 = (v) => Math.hypot(v[0], v[1], v[2]);

/** 有向包围盒 [cx,cy,cz, ux,uy,uz, vx,vy,vz, wx,wy,wz]：返回 {inside, dist} */
function boxRelation(box, p, padM = 0) {
  if (!box || box.length < 12) return { inside: false, dist: Infinity };
  const c = [box[0], box[1], box[2]];
  const axes = [
    [box[3], box[4], box[5]],
    [box[6], box[7], box[8]],
    [box[9], box[10], box[11]],
  ];
  const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
  let outside2 = 0;
  let inside = true;
  for (const a of axes) {
    const half = len3(a);
    if (!(half > 0)) return { inside: false, dist: Infinity };
    const proj = (d[0] * a[0] + d[1] * a[1] + d[2] * a[2]) / half;
    const over = Math.abs(proj) - half;
    if (over > padM) inside = false;
    if (over > 0) outside2 += over * over;
  }
  return { inside, dist: Math.sqrt(outside2) };
}

/* ── 端点预热 ─────────────────────────────────────────────────────────────── */
let ionWarm = null;

/** 交互后再开始 3D Tiles 瓦片预取（遮罩期把带宽留给底图）。 */
function startPrefetchAfterInteractive(rootUrl) {
  const go = () => {
    try {
      prefetch = startTilePrefetch({ rootUrl });
    } catch (_) {}
  };
  const gate = globalThis.__gevBoot;
  if (gate && typeof gate.whenInteractive === 'function') {
    gate.whenInteractive(30000).then(go, go);
    setTimeout(go, 15000); // 兜底：就绪门永不触发时仍会预取
    return;
  }
  setTimeout(go, 3000);
}

/**
 * 在 main:entry 调用：提前发起 ion 资产端点请求。
 * @param {{accessToken: string, assetId?: number}} options
 * @returns {{promise: Promise<object|null>, stats: object}}
 */
export function warmIonAsset({ accessToken, assetId = ION_ASSET_ID } = {}) {
  if (ionWarm) return ionWarm;
  const started = now();
  const stats = { beginAt: started, ms: null, ok: false, error: null };
  const token = String(accessToken || '').trim();
  const promise = token
    ? fetch(ION_ENDPOINT(assetId, token), {
        // 端点响应 cache-control: no-cache；这里只是抢一次往返，
        // 结果直接交给 createGoogleIonTileset，不再依赖 HTTP 缓存。
        cache: 'no-store',
        priority: 'high',
      })
        .then((res) => {
          if (!res.ok) throw new Error(`ion endpoint ${res.status}`);
          return res.json();
        })
        .then((json) => {
          stats.ok = true;
          stats.ms = +(now() - started).toFixed(1);
          timeline.mark('warm:endpoint:end', { ms: stats.ms });
          /* 端点一回来就开始取瓦片树（不等 viewer / 不等定位）——但 Phase7A：
             底图已经 base-first，3D Tiles 只是后台升级，**遮罩期不该跟底图抢
             带宽/连接**（实测遮罩期 65 个 google 瓦片请求与底图金字塔同时跑）。
             改为「交互后」再开始预取；就绪门缺失时 3s 兜底。 */
          try {
            const rootUrl = json && json.options && json.options.url;
            if (rootUrl && /3dtiles/.test(rootUrl)) {
              startPrefetchAfterInteractive(rootUrl);
            }
          } catch (_) {}
          return json;
        })
        .catch((error) => {
          stats.ms = +(now() - started).toFixed(1);
          stats.error = String((error && error.message) || error);
          return null;
        })
    : Promise.resolve(null);
  timeline.mark('warm:endpoint:begin');
  ionWarm = { promise, stats, assetId };
  return ionWarm;
}

/** 给 createGoogleIonTileset 用：拿到提前取好的端点 JSON（可能还没回来）。 */
export function takeWarmIonEndpoint() {
  return ionWarm ? ionWarm.promise : Promise.resolve(null);
}

/* ── 目标中心广播 ─────────────────────────────────────────────────────────── */
let bootCenter = null;
const centerWaiters = [];

/** gev-autolocate 拿到快速定位后立刻调用（可多次；只有第一次生效给预取）。 */
export function announceBootCenter(center) {
  if (bootCenter) return;
  if (!center || !Number.isFinite(center.lon) || !Number.isFinite(center.lat))
    return;
  bootCenter = {
    lon: +center.lon,
    lat: +center.lat,
    source: center.source || null,
  };
  timeline.mark('warm:center', {
    lon: +bootCenter.lon.toFixed(3),
    lat: +bootCenter.lat.toFixed(3),
  });
  while (centerWaiters.length) {
    try {
      centerWaiters.shift()(bootCenter);
    } catch (_) {}
  }
}

function readCachedCenter() {
  try {
    const raw = globalThis.localStorage?.getItem('gev.lastLocation');
    const loc = raw ? JSON.parse(raw) : null;
    if (
      loc &&
      Number.isFinite(loc.lon) &&
      Number.isFinite(loc.lat) &&
      !(loc.lat === 0 && loc.lon === 0)
    )
      return { lon: loc.lon, lat: loc.lat, source: 'cache' };
  } catch (_) {}
  return null;
}

function waitCenter(maxMs) {
  if (bootCenter) return Promise.resolve(bootCenter);
  const cached = readCachedCenter();
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    centerWaiters.push(done);
    setTimeout(() => done(null), maxMs);
  });
}

/* ── 瓦片树预取 ───────────────────────────────────────────────────────────── */
let prefetch = null;

/**
 * 预取 Google 3D Tiles 首批瓦片。
 * @param {{rootUrl: string, options?: object}} params
 */
export function startTilePrefetch({ rootUrl, options = {} } = {}) {
  if (prefetch) return prefetch;
  const cfg = { ...DEFAULTS, ...options };
  const url = String(rootUrl || '');
  if (!/3dtiles/i.test(url)) return (prefetch = emptyPrefetcher('no-root-url'));

  const started = now();
  const origin = new URL(url).origin;
  const key = new URL(url).searchParams.get('key');
  const stats = {
    beginAt: started,
    rootMs: null,
    tiles: 0,
    bytes: 0,
    hits: 0,
    errors: 0,
    skipped: 0,
    center: null,
    chain: [],
    phases: [],
    doneAt: null,
    reason: null,
  };

  const seen = new Set();
  const queue = [];
  let totalBytes = 0;
  let stopped = false;
  let inFlight = 0;

  const contentUrl = (uri, baseUrl) => {
    if (!uri) return null;
    try {
      const u = new URL(uri, origin + '/');
      // Cesium 的 getDerivedResource：内容 URL 自带的 query（如 `?session=`）在前，
      // 父级资源的 query（`session` + `key`）追加在后。深层的 `.json` 内容 uri
      // 完全不带 query，session 是从父级继承的 —— 漏掉就会 400。
      let base = null;
      try {
        base = new URL(baseUrl || url);
      } catch (_) {
        base = null;
      }
      if (base) {
        for (const [k, v] of base.searchParams) {
          if (!u.searchParams.has(k)) u.searchParams.append(k, v);
        }
      }
      if (key && !u.searchParams.has('key')) u.searchParams.append('key', key);
      return u.toString();
    } catch (_) {
      return null;
    }
  };

  const getJson = (absUrl, label) => {
    const t0 = now();
    return fetch(absUrl, { cache: 'default', priority: 'low' })
      .then((res) => {
        if (!res.ok) throw new Error(`${label} ${res.status}`);
        return res.json();
      })
      .then((json) => {
        const ms = +(now() - t0).toFixed(1);
        stats.chain.push({ label, ms });
        return json;
      })
      .catch((error) => {
        stats.errors += 1;
        stats.chain.push({
          label,
          ms: +(now() - t0).toFixed(1),
          error: String((error && error.message) || error),
        });
        return null;
      });
  };

  const enqueue = (absUrl) => {
    if (!absUrl || stopped) return;
    if (seen.has(absUrl)) return;
    if (stats.tiles >= cfg.maxTiles) return;
    seen.add(absUrl);
    stats.tiles += 1;
    queue.push(absUrl);
  };

  const pump = () => {
    while (!stopped && inFlight < cfg.concurrency && queue.length) {
      if (totalBytes >= cfg.maxBytes) {
        stopped = true;
        stats.reason = 'byte-budget';
        break;
      }
      const next = queue.shift();
      inFlight += 1;
      fetch(next, { cache: 'default', priority: 'low' })
        .then(async (res) => {
          if (!res.ok) {
            stats.errors += 1;
            return;
          }
          const buf = await res.arrayBuffer();
          totalBytes += buf.byteLength;
          stats.bytes = totalBytes;
        })
        .catch(() => {
          stats.errors += 1;
        })
        .finally(() => {
          inFlight -= 1;
          pump();
        });
    }
  };

  let finished = false;
  const drain = () =>
    new Promise((resolve) => {
      const tick = () => {
        if ((inFlight === 0 && queue.length === 0) || stopped) resolve();
        else setTimeout(tick, 50);
      };
      tick();
    });

  const finish = () => {
    if (finished) return;
    finished = true;
    stats.doneAt = +(now() - started).toFixed(1);
    timeline.mark('warm:tiles:end', {
      tiles: stats.tiles,
      kb: +(stats.bytes / 1024).toFixed(0),
      errors: stats.errors,
      ms: stats.doneAt,
    });
  };

  const collectContents = (node, depth, maxDepth, baseUrl) => {
    if (!node || stopped) return;
    if (node.content && node.content.uri && depth >= 2)
      enqueue(contentUrl(node.content.uri, baseUrl));
    if (depth >= maxDepth) return;
    for (const child of node.children || [])
      collectContents(child, depth + 1, maxDepth, baseUrl);
  };

  const isJson = (uri) => /\.json(\?|$)/i.test(String(uri));

  /** 沿「包含目标点」的孩子链下钻；近视野层额外带上视口半径内的兄弟瓦片。 */
  const walkChain = async (center) => {
    const p = ecefFromDegrees(center.lon, center.lat, 0);
    let node = rootJson.root;
    let baseUrl = url;
    for (let guard = 0; guard < 60 && node && !stopped; guard++) {
      const kids = node.children;
      if (!kids || !kids.length) break;
      let next = null;
      let nextRel = null;
      for (const kid of kids) {
        const rel = boxRelation(
          kid.boundingVolume && kid.boundingVolume.box,
          p,
          0,
        );
        if (rel.inside) {
          next = kid;
          nextRel = rel;
          break;
        }
        if (!nextRel || rel.dist < nextRel.dist) {
          nextRel = rel;
          next = kid;
        }
      }
      if (!next) break;
      const content = next.content && next.content.uri;
      if (content) {
        if (isJson(content)) {
          const abs = contentUrl(content, baseUrl);
          enqueue(abs);
          const sub = await getJson(
            abs,
            'json@' + Math.round(next.geometricError),
          );
          if (!sub || !sub.root) break;
          baseUrl = abs;
          /* 外部 tileset 的根节点直接作为下一轮的下钻起点 */
          const subRoot = sub.root;
          const subContent = subRoot.content && subRoot.content.uri;
          if (subContent && !isJson(subContent))
            enqueue(contentUrl(subContent, baseUrl));
          node = subRoot;
          if (subRoot.geometricError <= cfg.minGeometricError) break;
          continue;
        }
        enqueue(contentUrl(content, baseUrl));
        if (next.geometricError <= cfg.wideGeometricError) {
          for (const sib of kids) {
            if (sib === next) continue;
            const rel = boxRelation(
              sib.boundingVolume && sib.boundingVolume.box,
              p,
              cfg.viewRadiusM,
            );
            if (
              rel.dist <= cfg.viewRadiusM &&
              sib.content &&
              sib.content.uri &&
              !isJson(sib.content.uri)
            )
              enqueue(contentUrl(sib.content.uri, baseUrl));
          }
        }
      }
      if (next.geometricError <= cfg.minGeometricError) break;
      node = next;
    }
    stats.center = {
      lon: center.lon,
      lat: center.lat,
      source: center.source || null,
    };
  };

  let rootJson = null;
  const run = async () => {
    timeline.mark('warm:root:begin');
    const t0 = now();
    rootJson = await getJson(url, 'root.json');
    stats.rootMs = +(now() - t0).toFixed(1);
    if (!rootJson || !rootJson.root) {
      stats.reason = 'no-root-json';
      finish();
      return;
    }
    timeline.mark('warm:root:end', { ms: stats.rootMs });
    /* ① 与目标无关的顶层：root.json 深度 2/3 的全部瓦片（8+24 个，约 0.4 MB） */
    collectContents(rootJson.root, 0, 3, url);
    pump();
    stats.phases.push({ phase: 'base', tiles: stats.tiles });
    /* ② 目标中心链路 */
    const center = await waitCenter(cfg.centerWaitMs);
    if (!center) {
      stats.reason = 'no-center';
      await drain();
      finish();
      return;
    }
    await walkChain(center);
    stats.phases.push({ phase: 'chain', tiles: stats.tiles });
    pump();
    await drain();
    finish();
  };

  const api = {
    get stats() {
      return { ...stats };
    },
    whenDone: () =>
      new Promise((resolve) => {
        const tick = () =>
          finished ? resolve(api.stats) : setTimeout(tick, 100);
        tick();
      }),
  };
  prefetch = api;
  run().catch((error) => {
    stats.errors += 1;
    stats.reason = String((error && error.message) || error);
    finish();
  });
  return api;
}

function emptyPrefetcher(reason) {
  return {
    stats: { reason, tiles: 0, bytes: 0 },
    whenDone: () => Promise.resolve(null),
  };
}

/** 诊断入口（gate / harness 读） */
if (typeof window !== 'undefined') {
  window.__gevTileWarm = {
    stats: () => ({
      endpoint: ionWarm ? ionWarm.stats : null,
      prefetch: prefetch && prefetch.stats ? prefetch.stats : null,
      center: bootCenter,
    }),
  };
}
