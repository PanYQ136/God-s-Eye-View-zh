import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { filterTrailing24h, parseFirmsCsv } from '../../src/data/firmsCsv.js';

/**
 * NASA FIRMS live active-fire proxy with a memory + disk cache.
 * Upstream: https://firms.modaps.eosdis.nasa.gov/api/area/csv/{KEY}/{SOURCE}/world/2
 *
 * Merges three VIIRS NRT sources (NOAA-20, NOAA-21, Suomi-NPP — independent
 * satellites, no cross-source dedup) plus MODIS_NRT (combined Terra+Aqua,
 * ~1 km, numeric 0-100 confidence), fetched sequentially (quota courtesy)
 * with `days=2` (`days=1` means "current UTC day", nearly empty just after
 * 00:00Z) and clamps to the trailing 24 h via src/data/firmsCsv.js. FIRMS
 * quota is 5,000 transactions / 10 min per MAP_KEY, so the cache is the point:
 * TTL 30 min, single-flight refresh, serve-stale-on-failure, and a
 * fresh-enough disk cache (.gev-cache/firms.json) prevents ANY upstream
 * fetch across dev-server restarts. Pattern mirrors celestrakProxy.
 *
 * Routes:
 *   GET /api/firms        → {fetchedAt, stale, ttlMs, sources, count, fires}
 *   GET /api/firms/status → {hasKey, lastFetch, count, stale, ttlMs, transactions}
 *
 * Keyless (no FIRMS_MAP_KEY): /api/firms → 503 {error:'no_key'}; status →
 * {hasKey:false}. Upstream is never touched without a key.
 *
 * @returns {import('vite').Plugin}
 */
export function firmsProxy() {
  const TTL_MS = 30 * 60_000;
  const STATUS_TTL_MS = 5 * 60_000;
  // 云托管出口带宽有限：world/2 × 4 源（约 100MB+）在容器里必然超时，
  // 默认改成「两个主源 + world/1」，可用 FIRMS_SOURCES / FIRMS_DAYS 覆盖。
  const SOURCES = String(
    process.env.FIRMS_SOURCES || 'VIIRS_SNPP_NRT,MODIS_NRT',
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const FIRMS_DAYS = Math.max(
    1,
    Math.min(5, Number(process.env.FIRMS_DAYS) || 1),
  );
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache');
  const CACHE_PATH = path.join(CACHE_DIR, 'firms.json');

  /** @type {?{at: number, sources: Array<object>, fires: Array<object>}} */
  let mem = null;
  let diskChecked = false;
  /** @type {?Promise<?{at: number, sources: Array<object>, fires: Array<object>}>} single-flight refresh */
  let lastError = null;
  let inflight = null;
  /** @type {?{at: number, transactions: ?{used: number, limit: number}}} mapkey_status cache */
  let statusCache = null;
  /** @type {?Promise<?{used: number, limit: number}>} */
  let statusInflight = null;

  const mapKey = () => String(process.env.FIRMS_MAP_KEY || '').trim();

  async function readDiskOnce() {
    if (diskChecked) return;
    diskChecked = true;
    try {
      const parsed = JSON.parse(await fsp.readFile(CACHE_PATH, 'utf8'));
      if (
        Number.isFinite(parsed?.at) &&
        Array.isArray(parsed?.sources) &&
        Array.isArray(parsed?.fires)
      ) {
        mem = parsed;
      }
    } catch {
      /* no disk cache yet */
    }
  }

  async function writeDisk(entry) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(CACHE_PATH, JSON.stringify(entry), 'utf8');
    } catch (err) {
      console.warn('[firms-proxy] cache write failed:', err?.message || err);
    }
  }

  /**
   * Fetch + parse one FIRMS source. Throws on HTTP error or a non-CSV body
   * (FIRMS reports errors as HTML/plain text, never CSV). Never log the URL —
   * it embeds the MAP_KEY.
   */
  async function fetchSource(key, source) {
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${source}/world/${FIRMS_DAYS}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const records = parseFirmsCsv(await res.text());
    if (records === null) throw new Error('non-CSV upstream response');
    return records;
  }

  /**
   * EONET (NASA) wildfire fallback — 用事件级火点，仅在 FIRMS 返回 0/全失败时补位。
   * EONET 直连可达（已列 NO_PROXY，不走代理）。字段对齐 parseFirmsCsv 契约，
   * 时间戳用「当前 UTC」以保证通过 filterTrailing24h。
   */
  async function fetchEonetFires() {
    const url =
      'https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open&days=2&limit=500';
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`EONET HTTP ${res.status}`);
    const data = await res.json();
    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const acqDate = `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}`;
    const acqTime = `${p(now.getUTCHours())}${p(now.getUTCMinutes())}`;
    const out = [];
    for (const ev of data?.events || []) {
      const geoms = ev?.geometry || [];
      const g = geoms[geoms.length - 1];
      const c = g?.coordinates;
      if (!Array.isArray(c) || c.length < 2) continue;
      const [lon, lat] = c;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      out.push({
        lat,
        lon,
        frp: 0,
        confidence: 'n',
        brightness: 0,
        brightnessTi5: 0,
        daynight: 'D',
        acqDate,
        acqTime,
        satellite: 'EONET',
        instrument: 'EONET',
        _src: 'EONET',
      });
    }
    return out;
  }

  /**
   * Refresh all sources sequentially (quota courtesy — never in parallel).
   * Partial success (≥1 source ok) still produces a cacheable entry with the
   * failed sources marked ok:false; total failure throws so the caller can
   * serve stale.
   */
  async function refreshUpstream(key) {
    const now = Date.now();
    const sources = [];
    const fires = [];
    // 并行拉四个源：world/2 每次都是几十 MB，串行会在冷启动时拖到 3-4 分钟
    const settled = [];
    for (const source of SOURCES) {
      try {
        const t0 = Date.now();
        const records = filterTrailing24h(await fetchSource(key, source), now);
        console.log(
          `[firms-proxy] ${source} ${records.length} 条 ${Date.now() - t0}ms`,
        );
        settled.push({ source, records });
      } catch (err) {
        lastError = `${source}: ${String((err && err.message) || err)}`.slice(
          0,
          300,
        );
        console.warn(
          `[firms-proxy] ${source} fetch failed:`,
          err?.message || err,
        );
        settled.push({ source, records: null });
      }
    }
    for (const { source, records } of settled) {
      try {
        if (!records) throw new Error('source failed');
        // NOT fires.push(...records): spread passes each record as an argument,
        // and a world/2 VIIRS pull exceeds V8's argument limit (~125k) at
        // ~131k records — RangeError, and the whole source is silently dropped.
        for (const record of records) {
          if (record) record._src = source; // 私有标记：仅用于下面的跨刷新补齐，出网前会剥掉
          fires.push(record);
        }
        sources.push({ source, count: records.length, ok: true });
      } catch (err) {
        console.warn(
          `[firms-proxy] ${source} fetch failed:`,
          err?.message || err,
        );
        sources.push({ source, count: 0, ok: false });
      }
    }
    if (fires.length === 0) {
      try {
        const eonet = await fetchEonetFires();
        if (eonet.length) {
          for (const r of eonet) fires.push(r);
          sources.push({ source: 'EONET', count: eonet.length, ok: true });
          console.log(`[firms-proxy] EONET fallback ${eonet.length} 事件点`);
        }
      } catch (err) {
        console.warn(
          '[firms-proxy] EONET fallback failed:',
          err?.message || err,
        );
      }
    }
    if (!sources.some((s) => s.ok)) throw new Error('all FIRMS sources failed');
    // 部分源失败是上游常态（实测 VIIRS NOAA20/NOAA21/SNPP 会同时 5xx，只剩 MODIS），
    // 全量替换会让全球条数一次掉一个数量级。这里用上一份缓存里「同源」记录补齐，
    // buildPayload 仍会按近 24h 再过滤一遍，所以不会把过期数据带出来。
    const failed = sources.filter((s) => !s.ok).map((s) => s.source);
    let carried = 0;
    if (failed.length && mem && Array.isArray(mem.fires)) {
      for (const rec of mem.fires) {
        if (rec && rec._src && failed.indexOf(rec._src) >= 0) {
          fires.push(rec);
          carried += 1;
        }
      }
    }
    return {
      at: now,
      sources,
      fires,
      carried,
      failedSources: failed.length ? failed : null,
    };
  }

  /**
   * 解析 `?bbox=w,s,e,n` 与 `?limit=N`（小程序/窄客户端用）。
   * 两个参数都不给 → 行为与原来完全一致（网页版就是这样调的）。
   */
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
      Number.isFinite(lim) && lim > 0 ? Math.min(50000, Math.floor(lim)) : 0;
    return { box, limit };
  }

  /**
   * Cache entry → response payload. Fires are RE-filtered to the trailing
   * 24 h at serve time so a stale cache never serves >24h-old detections.
   *
   * `win.box` / `win.limit` 可选：给了就服务端裁剪（全球全量约 21 MB，
   * 小程序一次拉不动），并把 totalCount / inBox / truncated 一并回传，
   * 客户端能如实说明"这是裁剪后的数量"。
   */
  function buildPayload(entry, stale, win) {
    const all = filterTrailing24h(entry.fires, Date.now());
    let fires = all;
    let inBox = all.length;
    if (win && win.box) {
      const b = win.box;
      fires = fires.filter((f) => {
        const lat = Number(f.lat);
        const lon = Number(f.lon);
        return (
          Number.isFinite(lat) &&
          Number.isFinite(lon) &&
          lat >= b.s &&
          lat <= b.n &&
          lon >= b.w &&
          lon <= b.e
        );
      });
      inBox = fires.length;
    }
    let truncated = false;
    if (win && win.limit && fires.length > win.limit) {
      fires = fires.slice(0, win.limit);
      truncated = true;
    }
    const out = {
      fetchedAt: entry.at,
      stale,
      ttlMs: TTL_MS,
      sources: entry.sources,
      count: fires.length,
      fires,
    };
    if (win && (win.box || win.limit)) {
      out.totalCount = all.length;
      out.inBox = inBox;
      out.truncated = truncated;
      out.window = win.box || null;
      out.limit = win.limit || null;
    }
    // 上游有源失败时如实回传（客户端可据此说明"这份数据里有 N 条来自上一轮缓存"）
    if (entry.failedSources) {
      out.sourceIssues = {
        failed: entry.failedSources,
        carried: entry.carried || 0,
      };
    }
    return out;
  }

  /** mapkey_status transactions, cached 5 min, best-effort (null on failure). */
  function getTransactions(key) {
    const now = Date.now();
    if (statusCache && now - statusCache.at < STATUS_TTL_MS) {
      return Promise.resolve(statusCache.transactions);
    }
    if (!statusInflight) {
      statusInflight = (async () => {
        try {
          const url = `https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY=${encodeURIComponent(key)}`;
          const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = await res.json();
          const used = Number(body?.current_transactions);
          const limit = Number(body?.transaction_limit);
          return Number.isFinite(used) && Number.isFinite(limit)
            ? { used, limit }
            : null;
        } catch (err) {
          console.warn(
            '[firms-proxy] mapkey status failed:',
            err?.message || err,
          );
          return null;
        }
      })()
        .then((transactions) => {
          statusCache = { at: Date.now(), transactions };
          return transactions;
        })
        .finally(() => {
          statusInflight = null;
        });
    }
    return statusInflight;
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/firms', async (req, res) => {
      const sendJson = (status, obj) => {
        if (res.headersSent) return;
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        // 顺手剥掉私有字段 `_src`（跨刷新补齐用），省一次全量拷贝
        res.end(JSON.stringify(obj, (k, v) => (k === '_src' ? undefined : v)));
      };
      try {
        const subPath = String(req.url || '').split('?')[0];
        const win = parseWindow(req.url);
        const key = mapKey();
        await readDiskOnce();

        if (subPath === '/status') {
          if (!key) {
            sendJson(200, {
              hasKey: false,
              lastFetch: null,
              count: null,
              stale: false,
              ttlMs: TTL_MS,
              transactions: null,
            });
            return;
          }
          const transactions = await getTransactions(key);
          sendJson(200, {
            hasKey: true,
            lastFetch: mem ? mem.at : null,
            count: mem ? mem.fires.length : null,
            stale: mem ? Date.now() - mem.at >= TTL_MS : false,
            ttlMs: TTL_MS,
            transactions,
          });
          return;
        }

        if (!key) {
          sendJson(503, { error: 'no_key' });
          return;
        }

        const entry = mem;
        if (entry && Date.now() - entry.at < TTL_MS) {
          sendJson(200, buildPayload(entry, false, win));
          return;
        }

        // 有旧缓存：立刻回旧的（stale:true），刷新丢到后台跑。
        // 上游 VIIRS 三源同时挂时，同步刷新实测要 188 s（3×60 s 超时），
        // 绝不能把客户端挂在这上面。
        if (entry) {
          if (!inflight) {
            inflight = refreshUpstream(key)
              .then(async (fresh) => {
                mem = fresh;
                await writeDisk(fresh);
                return fresh;
              })
              .catch((err) => {
                console.warn(
                  `[firms-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
                );
                return null;
              })
              .finally(() => {
                inflight = null;
              });
          }
          sendJson(200, buildPayload(entry, true, win));
          return;
        }

        // 冷启动（任何缓存都没有）才同步等一次
        // Stale or missing → refresh, single-flight (concurrent requests
        // share one upstream pass). Capture the promise locally BEFORE
        // awaiting: the .finally() nulls `inflight` the moment it settles.
        if (!inflight) {
          inflight = refreshUpstream(key)
            .then(async (fresh) => {
              mem = fresh;
              await writeDisk(fresh);
              return fresh;
            })
            .catch((err) => {
              lastError = String((err && err.message) || err).slice(0, 300);
              console.warn(
                `[firms-proxy] refresh failed (${err?.message || err}) — serving cache if any`,
              );
              return null;
            })
            .finally(() => {
              inflight = null;
            });
        }
        if (!entry) {
          // 冷启动且一个缓存都没有：立即 200 warming，后台继续拉。
          // 境内云 → NASA 的 world/2 四源合计常超过网关 60s 上限，同步等必然 502。
          sendJson(200, {
            fetchedAt: null,
            stale: true,
            warming: true,
            ttlMs: TTL_MS,
            sources: [],
            count: 0,
            fires: [],
            reason: 'warming',
            lastError: lastError || null,
          });
          return;
        }
        const pending = inflight;
        const fresh = await pending;
        if (fresh) {
          sendJson(200, buildPayload(fresh, false, win));
        } else if (entry) {
          sendJson(200, buildPayload(entry, true, win)); // upstream down — stale beats empty
        } else {
          sendJson(502, {
            error: 'firms fetch failed and no cache available',
          });
        }
      } catch (err) {
        console.warn('[firms-proxy] error:', err?.message || err);
        sendJson(500, { error: 'firms proxy error' });
      }
    });
  };
  return {
    name: 'firms-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
