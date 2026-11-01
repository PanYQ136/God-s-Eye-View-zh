/**
 * TomTom 实时路况（服务端 MVT 解码）— `GET /api/traffic-flow?bbox=w,s,e,n&zoom=12&limit=600`
 *
 * 为什么要有它：小程序端解析不了 PBF 矢量瓦片，网页版是浏览器里解 MVT。
 * 这里把解码搬到服务端，直接吐归一化的折线 + 拥堵等级，小程序只需画线。
 *
 * 上游：https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.pbf
 *   图层名固定 "Traffic flow"，extent 4096，要素属性（实测）：
 *     traffic_level: 0..1 浮点（0=畅通，1=拥堵/停滞）
 *     road_type / traffic_road_coverage / road_closure / left_hand_traffic
 *   中国大陆（北京/上海实测）没有该图层 → 返回 available:false，由客户端决定回退模拟车流。
 *
 * 预算：TomTom 按请求计费，每次查询最多 9 块瓦片（3×3），120 秒内存缓存。
 */
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

const UPSTREAM = 'https://api.tomtom.com/traffic/map/4/tile/flow/relative';
const LAYER_NAME = 'Traffic flow';
const TILE_CAP = 9;
const MAX_SPAN_DEG = 2;
const FETCH_TIMEOUT_MS = 9000;
const CACHE_TTL_MS = 120_000;
const CACHE_MAX = 40;

const cache = new Map(); // key -> { at, payload }

function tileXY(lat, lon, z) {
  const n = 2 ** z;
  return [
    Math.floor(((lon + 180) / 360) * n),
    Math.floor(
      ((1 -
        Math.log(
          Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180),
        ) /
          Math.PI) /
        2) *
        n,
    ),
  ];
}

/** 瓦片内像素坐标 → WGS84 */
function tilePointToLngLat(px, py, extent, z, x, y) {
  const n = 2 ** z;
  const lon = ((x + px / extent) / n) * 360 - 180;
  const t = Math.PI * (1 - (2 * (y + py / extent)) / n);
  const lat = (Math.atan(Math.sinh(t)) * 180) / Math.PI;
  return [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5];
}

function parseQuery(url) {
  const q = new URL(url, 'http://local').searchParams;
  const bboxRaw = String(q.get('bbox') || '')
    .split(',')
    .map(Number);
  if (bboxRaw.length !== 4 || !bboxRaw.every(Number.isFinite))
    return { error: 'invalid_bbox' };
  const [w, s, e, n] = bboxRaw;
  if (!(w < e) || !(s < n)) return { error: 'invalid_bbox' };
  if (e - w > MAX_SPAN_DEG || n - s > MAX_SPAN_DEG)
    return { error: 'bbox_too_large', maxSpanDeg: MAX_SPAN_DEG };
  const zoom = Math.min(14, Math.max(10, Number(q.get('zoom')) || 12));
  const limit = Math.min(1200, Math.max(1, Number(q.get('limit')) || 600));
  return { bbox: [w, s, e, n], zoom, limit };
}

/** 取覆盖该 bbox 的瓦片（最多 TILE_CAP 块，优先覆盖中心） */
function tilesFor(bbox, zoom) {
  const [w, s, e, n] = bbox;
  const [x0, y0] = tileXY(n, w, zoom); // 西北角
  const [x1, y1] = tileXY(s, e, zoom); // 东南角
  const out = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) out.push([x, y]);
  }
  if (out.length <= TILE_CAP) return out;
  // 超限：按到 bbox 中心的距离取最近的 TILE_CAP 块
  const [cx, cy] = tileXY((s + n) / 2, (w + e) / 2, zoom);
  return out
    .sort(
      (a, b) =>
        (a[0] - cx) ** 2 +
        (a[1] - cy) ** 2 -
        ((b[0] - cx) ** 2 + (b[1] - cy) ** 2),
    )
    .slice(0, TILE_CAP);
}

async function fetchTile(z, x, y, signal) {
  const key = process.env.TOMTOM_API_KEY;
  const url = `${UPSTREAM}/${z}/${x}/${y}.pbf?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
  });
  if (res.status === 404) return null; // 该块无数据（常见于无覆盖区）
  if (!res.ok) throw new Error(`upstream_http_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length ? buf : null;
}

function decodeTile(buf, z, x, y, sink) {
  const tile = new VectorTile(new PbfReader(buf));
  const layer = tile.layers[LAYER_NAME];
  if (!layer) return 0;
  const extent = layer.extent || 4096;
  let used = 0;
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    if (f.type !== 2) continue; // 只要线
    const props = f.properties || {};
    const raw = Number(props.traffic_level);
    const level = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : null;
    const geom = f.loadGeometry();
    for (const ring of geom) {
      if (!ring || ring.length < 2) continue;
      const pts = [];
      for (const p of ring)
        pts.push(tilePointToLngLat(p.x, p.y, extent, z, x, y));
      sink.push({
        lv: level,
        cls: String(props.road_type || ''),
        closed: props.road_closure === true,
        cov: String(props.traffic_road_coverage || ''),
        pts,
      });
      used++;
    }
  }
  return used;
}

export function trafficFlowProxy() {
  const handler = async (req, res) => {
    const send = (status, obj) => {
      if (res.headersSent) return;
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(obj));
    };
    if (req.method !== 'GET') return send(405, { error: 'method_not_allowed' });
    if (!process.env.TOMTOM_API_KEY)
      return send(503, { error: 'no_key', available: false });

    const parsed = parseQuery(req.url);
    if (parsed.error)
      return send(400, {
        error: parsed.error,
        ...(parsed.maxSpanDeg ? { maxSpanDeg: parsed.maxSpanDeg } : {}),
      });

    const { bbox, zoom, limit } = parsed;
    const cacheKey = `${bbox.join(',')}|${zoom}|${limit}`;
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'max-age=60',
        'x-traffic-flow-cache': 'hit',
      });
      return res.end(JSON.stringify(hit.payload));
    }

    const tiles = tilesFor(bbox, zoom);
    const lines = [];
    const controller = new AbortController();
    let failed = 0;
    try {
      // 并发 3，避免把上游打爆
      for (let i = 0; i < tiles.length; i += 3) {
        const batch = tiles.slice(i, i + 3);
        await Promise.all(
          batch.map(async ([x, y]) => {
            try {
              const buf = await fetchTile(zoom, x, y, controller.signal);
              if (buf) decodeTile(buf, zoom, x, y, lines);
            } catch {
              failed++;
            }
          }),
        );
      }
    } finally {
      controller.abort();
    }

    const [w, s, e, n] = bbox;
    const kept = lines
      .filter((l) => l.pts.length >= 2)
      .slice(0, limit)
      .map((l) => ({ lv: l.lv, cls: l.cls, closed: l.closed, pts: l.pts }));

    const payload = {
      ok: true,
      available: kept.length > 0,
      zoom,
      tiles: tiles.length,
      tilesFailed: failed,
      count: kept.length,
      truncated: lines.length > limit,
      bbox: [w, s, e, n],
      coverage:
        'TomTom Traffic Flow（relative）· 大陆中国无覆盖，可用区为美/欧/日等',
      lines: kept,
    };
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { at: Date.now(), payload });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'max-age=60',
      'x-traffic-flow-cache': 'miss',
    });
    res.end(JSON.stringify(payload));
  };

  return {
    name: 'traffic-flow',
    configureServer({ middlewares }) {
      middlewares.use('/api/traffic-flow', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/traffic-flow', handler);
    },
  };
}
