/* ════════════════════════════════════════════════════════════════════════════
   baseTilePrefetch.js —— 冷启动「底图瓦片」提前取进 HTTP 缓存（base-first）
   ----------------------------------------------------------------------------
   Phase7A 实测（.gev-logs/lc/phase7a/img1-imagery.json，prod 4174）：
     相机落位后底图要「逐级」走金字塔才到清晰层 —— z1@5141 → z2@5791 →
     z3/4@5949 → z11@6941 → **z13@7113** → view:content 7566（navStart ms）。
     每一级都要等上一级的网络往返回来，13 级串成 2.2s，是遮罩期最大单项。
     而真正决定「中心清晰」的只有 z13 的 16 块（450ms 内并行到齐）。

   本模块做两件事（只搬运网络，不改渲染/判定/画质）：
     A. `primeBaseTiles()` —— `main:entry` 就按「上次位置/家」算 WebMercator
        z1..z14 的中心链（两级候选：AMap 与 Esri，各 14 个，几十 KB），
        让金字塔每一级在相机落位前就躺在 HTTP 缓存里；
     B. `setBaseProvider(id)` —— 底图栈确定后（`scene.js` setStack 前）补该 provider
        的 z12 3×3 / z13 5×5 / z14 3×3（≈ 43 块），覆盖 640×420 探针区；
     C. `announceBaseCenter(center)` —— 快速定位回来且与预取中心相距 >2km 时重算。

   失败/超时一律静默降级（就是没预取，行为回落到优化前）。
   诊断：`window.__gevBaseTiles.stats()` → { center, provider, req, cacheHit, ms }
   ════════════════════════════════════════════════════════════════════════════ */

const HOME = { lon: 119.349185, lat: 26.067452 };

const PROVIDERS = {
  'amap-satellite': (z, x, y, i) =>
    `https://webst0${1 + (i % 4)}.is.autonavi.com/appmaptile?style=6&x=${x}&y=${y}&z=${z}`,
  'amap-hybrid': (z, x, y, i) =>
    `https://webst0${1 + (i % 4)}.is.autonavi.com/appmaptile?style=8&x=${x}&y=${y}&z=${z}`,
  'esri-imagery': (z, x, y) =>
    `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
};
/* 未知 provider 时两级都预取中心链（各 14 个，成本很小） */
const PROBE_ORDER = ['amap-satellite', 'esri-imagery'];

const CHAIN_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
/* 视野环：12 km 视角 1213×696 画布在 z13 约占 5×3 块，探针区 640×420 约 3×2 */
const RINGS = [
  { z: 13, r: 2 },
  { z: 12, r: 1 },
  { z: 14, r: 1 },
];
const CONCURRENCY = 6;
const MAX_BYTES = 6 * 1024 * 1024;

const now = () =>
  typeof performance !== 'undefined' ? +performance.now().toFixed(1) : 0;

const stats = {
  beginAt: null,
  center: null,
  provider: null,
  req: 0,
  ok: 0,
  bytes: 0,
  errors: 0,
  started: 0,
  doneAt: null,
  phases: [],
};

const seen = new Set();
const queue = [];
let inFlight = 0;
let totalBytes = 0;
let center = null;
let provider = null;

/* ── WebMercator ─────────────────────────────────────────────────────────── */
const lngToX = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latToY = (lat, z) => {
  const r =
    (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  const n = Math.log(Math.tan(Math.PI / 4 + r / 2));
  return Math.floor(((1 - n / Math.PI) / 2) * 2 ** z);
};

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

function far(a, b, km = 2) {
  if (!a || !b) return false;
  const dLat = (a.lat - b.lat) * 111;
  const dLon = (a.lon - b.lon) * 111 * Math.cos((b.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon) > km;
}

/* ── 队列 ─────────────────────────────────────────────────────────────────── */
function enqueue(url) {
  if (!url || seen.has(url)) return;
  if (stats.req >= 400) return;
  seen.add(url);
  stats.req += 1;
  queue.push(url);
}

function pump() {
  while (inFlight < CONCURRENCY && queue.length) {
    if (totalBytes >= MAX_BYTES) {
      queue.length = 0;
      return;
    }
    const url = queue.shift();
    inFlight += 1;
    const t0 = now();
    fetch(url, { cache: 'default', priority: 'high', credentials: 'omit' })
      .then(async (res) => {
        if (!res.ok) {
          stats.errors += 1;
          return;
        }
        const buf = await res.arrayBuffer();
        totalBytes += buf.byteLength;
        stats.bytes = totalBytes;
        stats.ok += 1;
        if (stats.started && stats.ok === 1)
          stats.firstTileMs = +(now() - stats.started).toFixed(0);
        stats.lastTileMs = +(now() - stats.started).toFixed(0);
        stats.lastTileDur = +(now() - t0).toFixed(0);
      })
      .catch(() => {
        stats.errors += 1;
      })
      .finally(() => {
        inFlight -= 1;
        pump();
      });
  }
}

function ring(providerId, z, r) {
  const draw = PROVIDERS[providerId];
  if (!draw || !center) return;
  const cx = lngToX(center.lon, z);
  const cy = latToY(center.lat, z);
  const max = 2 ** z - 1;
  let i = 0;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x > max || y > max) continue;
      enqueue(draw(z, x, y, i++));
    }
  }
}

function chain(providerId) {
  const draw = PROVIDERS[providerId];
  if (!draw || !center) return;
  for (const z of CHAIN_LEVELS) {
    const x = lngToX(center.lon, z);
    const y = latToY(center.lat, z);
    enqueue(draw(z, x, y, 0));
  }
}

function mark(phase) {
  stats.phases.push({ phase, req: stats.req, ok: stats.ok, at: now() });
}

function mode() {
  try {
    const v = new URLSearchParams(globalThis.location?.search).get('basewarm');
    if (v === '0') return 'off';
    if (v === 'full') return 'full';
    /* 默认只跑「中心链」：实测把每块瓦片 470ms→130ms，但视野环（25 块）会
       和 Cesium 自己的请求抢同一条 host 连接池（Esri 上限 6），反而更慢。 */
    if (v === 'chain') return 'chain';
  } catch (_) {}
  return 'chain';
}

/** `main:entry` 调用：按缓存位置/家，先把 AMap + Esri 的中心链放进缓存。 */
export function primeBaseTiles() {
  if (typeof window === 'undefined' || center) return stats;
  const m = mode();
  stats.mode = m;
  if (m === 'off') return stats;
  stats.beginAt = now();
  stats.started = now();
  center = readCachedCenter() || { ...HOME, source: 'home' };
  stats.center = center;
  for (const id of PROBE_ORDER) chain(id);
  mark('prime');
  pump();
  return stats;
}

/** 底图栈确定（`scene.js` setStack 前）：只为该 provider 补视野环。 */
export function setBaseProvider(id) {
  if (typeof window === 'undefined') return;
  if (!stats.beginAt) primeBaseTiles();
  if (provider === id) return;
  provider = id;
  stats.provider = id;
  if (!PROVIDERS[id]) {
    mark('provider:' + id + ':skip');
    return;
  }
  chain(id);
  if (mode() === 'full') for (const r of RINGS) ring(id, r.z, r.r);
  mark('rings:' + id);
  pump();
}

/** 快速定位回来（gev-autolocate）：中心明显不同就按新中心重算。 */
export function announceBaseCenter(loc) {
  if (!loc || !Number.isFinite(loc.lon) || !Number.isFinite(loc.lat)) return;
  if (!stats.beginAt) primeBaseTiles();
  if (!far(center, loc)) return;
  center = { lon: +loc.lon, lat: +loc.lat, source: loc.source || null };
  stats.center = center;
  for (const id of provider ? [provider] : PROBE_ORDER) chain(id);
  if (provider) for (const r of RINGS) ring(provider, r.z, r.r);
  mark('recenter');
  pump();
}

if (typeof window !== 'undefined') {
  window.__gevBaseTiles = {
    stats: () => ({
      ...stats,
      queue: queue.length,
      inFlight,
      kb: +(stats.bytes / 1024).toFixed(0),
    }),
    prime: primeBaseTiles,
    setProvider: setBaseProvider,
    center: announceBaseCenter,
  };
}
