/**
 * 小程序专用航班代理 —— `GET /api/flights?bbox=w,s,e,n&limit=300`
 *
 * 为什么要有这一层：
 * - 小程序端不能直连 pocketworld.org（真机要求 https 且域名进白名单，IP 不行）；
 * - 由本机服务端统一代理，小程序只认一个地址（局域网 / Tailscale / 本机），
 *   也不用把第三方域名写进 request 合法域名；
 * - bbox 过滤在服务端做，回包只有 10~200KB，而不是全球 5MB 快照。
 *
 * 走 POCKETWORLD_FLIGHTS_URL（默认 https://pocketworld.org/api/flights），
 * 上游字段原样透传（flights / time / source），只做 limit 收敛与 20s 缓存。
 */

const UPSTREAM = process.env.POCKETWORLD_FLIGHTS_URL || 'https://pocketworld.org/api/flights';
const CACHE_TTL_MS = 20 * 1000;
const CACHE_MAX = 24;
const cache = new Map();

function parseBbox(raw) {
  if (!raw) return null;
  const parts = String(raw).split(',').map((x) => Number(x));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [w, s, e, n] = parts;
  if (w >= e || s >= n) return null;
  return [w, s, e, n];
}

function clampLimit(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 300;
  return Math.max(20, Math.min(1500, Math.round(n)));
}

export function miniFlightsProxy() {
  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const bbox = parseBbox(url.searchParams.get('bbox'));
    const limit = clampLimit(url.searchParams.get('limit'));

    const qs = new URLSearchParams({ limit: String(limit) });
    if (bbox) qs.set('bbox', bbox.join(','));
    const target = `${UPSTREAM}?${qs.toString()}`;
    const key = target;

    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'max-age=20',
        'x-mini-flights-cache': 'hit',
      });
      res.end(JSON.stringify({ ...hit.payload, cached: true }));
      return;
    }

    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 25000);
      const upstream = await fetch(target, {
        signal: ac.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'gods-eye-mini/1.0 (+local proxy)',
        },
      });
      clearTimeout(timer);
      if (!upstream.ok) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'upstream_status', status: upstream.status, upstream: 'pocketworld' }));
        return;
      }
      const data = await upstream.json();
      const flights = Array.isArray(data.flights) ? data.flights : [];
      const payload = {
        time: data.time || new Date().toISOString(),
        source: 'pocketworld.org（服务端代理）',
        bbox: bbox || null,
        count: flights.length,
        limit,
        flights,
      };
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(key, { at: Date.now(), payload });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'max-age=20',
        'x-mini-flights-cache': 'miss',
      });
      res.end(JSON.stringify(payload));
    } catch (err) {
      res.writeHead(504, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'upstream_timeout', message: String(err && err.message || err) }));
    }
  };

  return {
    name: 'mini-flights',
    configureServer({ middlewares }) {
      middlewares.use('/api/flights', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/flights', handler);
    },
  };
}
