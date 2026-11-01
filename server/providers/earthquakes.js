/**
 * Earthquakes proxy — `GET /api/earthquakes`
 *
 * Why this exists: USGS is the only public quake feed we use, and it is not
 * reachable from mainland-China networks with the browser/app TLS stack
 * (schannel: `SSL/TLS connection failed`, mini-program: `status 0`). Node's
 * fetch DOES reach it (through the optional local proxy — see
 * server/standalone/local-proxy.mjs), so we proxy it here and let every client
 * talk to one host that already works.
 *
 * Query (all optional — no params behaves like the raw USGS feed):
 *   ?bbox=west,south,east,north   服务端裁剪（小程序一次只画视口内的）
 *   ?limit=N                      返回条数上限（默认不限）
 *   ?minMagnitude=2.5             映射到 USGS 预置 feed（>=2.5 用 2.5_day，其余 all_day）
 *   ?period=day|week|month         预置 feed 周期（默认 day）
 *
 * Response:
 *   {fetchedAt, stale, ttlMs, source, period, minMagnitude,
 *    count, totalCount, inBox, truncated, window, limit,
 *    quakes: [{id, lat, lon, depthKm, mag, place, time, url, magType, felt, alert}]}
 *
 * Cache: memory 120 s + disk (`.gev-cache/earthquakes.json`, 30 min tolerated)
 * so a USGS hiccup never empties the layer.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';

const TTL_MS = 120_000;
const DISK_TOLERANCE_MS = 30 * 60_000;
const FEED_HOST = 'https://earthquake.usgs.gov';
const UPSTREAM_TIMEOUT_MS = 20_000;

/** 预置 feed：magnitude 阈值 + 周期 → USGS summary 文件名 */
function feedName(minMagnitude, period) {
  const per = ['day', 'week', 'month'].includes(period) ? period : 'day';
  const mag = Number(minMagnitude);
  const prefix =
    Number.isFinite(mag) && mag > 0 && mag < 10
      ? String(mag).replace(/\.0$/, '') // 2.5 → "2.5", 4 → "4"
      : 'all';
  return `${prefix}_${per}.geojson`;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** USGS GeoJSON feature → 紧凑记录（字段名对齐网页版/小程序已有的用法） */
function normalize(feature) {
  const p = (feature && feature.properties) || {};
  const c = (feature && feature.geometry && feature.geometry.coordinates) || [];
  const lon = num(c[0]);
  const lat = num(c[1]);
  const depthKm = num(c[2]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return {
    id: feature.id || p.code || null,
    lat,
    lon,
    depthKm,
    mag: num(p.mag),
    place: p.place || null,
    time: num(p.time),
    updated: num(p.updated),
    url: p.url || null,
    magType: p.magType || null,
    felt: num(p.felt),
    alert: p.alert || null,
  };
}

export function earthquakesProxy() {
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache');
  const CACHE_PATH = path.join(CACHE_DIR, 'earthquakes.json');

  /** @type {?{at: number, feed: string, quakes: Array<object>}} */
  let mem = null;
  let diskRead = false;
  /** @type {?Promise<?object>} */
  let inflight = null;

  async function readDiskOnce() {
    if (diskRead) return;
    diskRead = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      if (parsed && Array.isArray(parsed.quakes) && parsed.quakes.length) {
        mem = mem || {
          at: parsed.at || 0,
          feed: parsed.feed || 'all_day.geojson',
          quakes: parsed.quakes,
        };
      }
    } catch {
      /* no cache yet */
    }
  }

  async function writeDisk(entry) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(CACHE_PATH, JSON.stringify(entry), 'utf8');
    } catch {
      /* best-effort */
    }
  }

  async function fetchFeed(feed) {
    const res = await fetch(
      `${FEED_HOST}/earthquakes/feed/v1.0/summary/${feed}`,
      {
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        headers: { Accept: 'application/geo+json, application/json' },
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    const features = Array.isArray(body && body.features) ? body.features : [];
    const quakes = [];
    for (const f of features) {
      const q = normalize(f);
      if (q) quakes.push(q);
    }
    return { at: Date.now(), feed, quakes };
  }

  function parseWindow(url) {
    const q =
      String(url || '').indexOf('?') >= 0 ? String(url).split('?')[1] : '';
    const params = new URLSearchParams(q || '');
    let box = null;
    const raw = params.get('bbox');
    if (raw) {
      const v = String(raw).split(',').map(Number);
      if (v.length >= 4 && v.slice(0, 4).every(Number.isFinite)) {
        box = { w: v[0], s: v[1], e: v[2], n: v[3] };
      }
    }
    const lim = Number(params.get('limit'));
    const limit =
      Number.isFinite(lim) && lim > 0 ? Math.min(20000, Math.floor(lim)) : 0;
    const magRaw = Number(params.get('minMagnitude'));
    const minMagnitude = Number.isFinite(magRaw) && magRaw > 0 ? magRaw : null;
    const period = ['day', 'week', 'month'].includes(
      String(params.get('period')),
    )
      ? String(params.get('period'))
      : 'day';
    return {
      box,
      limit,
      minMagnitude,
      period,
      feed: feedName(minMagnitude, period),
    };
  }

  function buildPayload(entry, stale, win) {
    let quakes = entry.quakes;
    const total = quakes.length;
    if (win.box) {
      const b = win.box;
      quakes = quakes.filter(
        (q) => q.lat >= b.s && q.lat <= b.n && q.lon >= b.w && q.lon <= b.e,
      );
    }
    const inBox = quakes.length;
    let truncated = false;
    if (win.limit && quakes.length > win.limit) {
      quakes = quakes.slice(0, win.limit);
      truncated = true;
    }
    return {
      fetchedAt: entry.at,
      stale,
      ttlMs: TTL_MS,
      source: 'USGS earthquake feed',
      period: win.period,
      minMagnitude: win.minMagnitude,
      feed: entry.feed || win.feed,
      count: quakes.length,
      totalCount: total,
      inBox,
      truncated,
      window: win.box || null,
      limit: win.limit || null,
      quakes,
    };
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/earthquakes', async (req, res) => {
      const sendJson = (status, obj) => {
        if (res.headersSent) return;
        res.writeHead(status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(JSON.stringify(obj));
      };
      try {
        const win = parseWindow(req.url);
        await readDiskOnce();

        const usable =
          mem &&
          mem.feed === win.feed &&
          Date.now() - mem.at < DISK_TOLERANCE_MS;

        if (usable && Date.now() - mem.at < TTL_MS) {
          sendJson(200, buildPayload(mem, false, win));
          return;
        }
        if (!inflight) {
          inflight = fetchFeed(win.feed)
            .then(async (fresh) => {
              mem = fresh;
              await writeDisk(fresh);
              return fresh;
            })
            .catch((err) => {
              console.warn(
                `[earthquakes-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
              );
              return null;
            })
            .finally(() => {
              inflight = null;
            });
        }
        const pending = inflight;
        const fresh = await pending;
        if (fresh) {
          sendJson(200, buildPayload(fresh, false, win));
        } else if (usable) {
          sendJson(200, buildPayload(mem, true, win)); // upstream down — stale beats empty
        } else {
          sendJson(502, {
            error: 'earthquakes upstream unreachable and no cache available',
          });
        }
      } catch (err) {
        console.warn('[earthquakes-proxy] error:', err?.message || err);
        sendJson(500, { error: 'earthquakes proxy error' });
      }
    });
  };

  return {
    name: 'earthquakes-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
