import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { celestrakTleUrl } from '../../../src/data/spaceProviderRequests.js';
import { providerCooldownMs } from './cooldown.js';
import { admitSameSiteKeyless } from '../common/same-site.js';
import { readResponseTextCapped } from '../common/http.js';

/**
 * Vite plugin: CelesTrak TLE proxy.
 *
 * CelesTrak does not send CORS headers, so this middleware fetches
 * satellite TLE data server-side and forwards it to the browser.
 * Upstream URL: https://celestrak.org/NORAD/elements/gp.php
 *
 * @returns {import('vite').Plugin}
 */
/**
 * CelesTrak GP/TLE proxy with a memory + disk cache.
 * Upstream: https://celestrak.org/NORAD/elements/gp.php?GROUP=<group>&FORMAT=tle
 * CelesTrak asks clients not to re-fetch GP data more than ~every 2 h and
 * throttles offenders; every dev reload used to refetch every group. Cache TTL
 * 6 h; on upstream failure the freshest stale copy is served (a stale TLE
 * beats an empty satellites layer). Pattern mirrors openSkyProxy's
 * cache+serve-stale. Adapted from skylight's TleStore (MIT).
 */
export function celestrakProxy() {
  const TLE_TTL_MS = 6 * 3600_000;
  const CACHE_DIR = path.join(process.cwd(), '.gev-cache');
  const groups = new Set([
    'stations',
    'visual',
    'gps-ops',
    'glo-ops',
    'galileo',
    'geo',
    'starlink',
    // Space Missions (`getActiveTle`) reads the full active catalog.
    'active',
  ]);
  let cooldownUntil = 0;
  const mem = new Map(); // group -> { at: epochMs, body: string }
  const inflight = new Map(); // group -> Promise<{at, body}|null>

  const diskPath = (group) => path.join(CACHE_DIR, `celestrak-${group}.json`);

  async function readDisk(group) {
    try {
      const parsed = JSON.parse(await fsp.readFile(diskPath(group), 'utf8'));
      if (typeof parsed?.body === 'string' && Number.isFinite(parsed?.at))
        return parsed;
    } catch {
      /* no disk cache yet */
    }
    return null;
  }

  async function writeDisk(group, entry) {
    try {
      await fsp.mkdir(CACHE_DIR, { recursive: true });
      await fsp.writeFile(diskPath(group), JSON.stringify(entry), 'utf8');
    } catch (err) {
      console.warn('[celestrak-proxy] cache write failed');
    }
  }

<<<<<<< ours
  /** The largest group (`active`) measures ~2.7 MB; this bounds a runaway body. */
  const CELESTRAK_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

  async function fetchUpstream(group) {
    const url = celestrakTleUrl(group);
    const signal = AbortSignal.timeout(20000);
    const res = await fetch(url.toString(), {
      signal,
      // CelesTrak 403s bulk groups (e.g. `active`) unless the request carries a
      // descriptive User-Agent with a contact point.
      headers: {
        'User-Agent':
          'gods-eye-view-celestrak-proxy/1.0 (+https://github.com/bilawalsidhu/gods-eye-view)',
      },
    });
    if (!res.ok) {
      // Group refreshes run in parallel: a later failure without Retry-After
      // must never shorten a longer deadline an earlier one already set.
      cooldownUntil = Math.max(
        cooldownUntil,
        Date.now() + providerCooldownMs(res),
      );
      void res.body?.cancel().catch(() => {});
      throw new Error(`HTTP ${res.status}`);
    }
    const body = await readResponseTextCapped(
      res,
      CELESTRAK_MAX_RESPONSE_BYTES,
      signal,
    );
    // An upstream error page parses to zero TLEs — treat as failure, keep cache.
    if (!/^1 /m.test(body)) throw new Error('no TLE lines in response');
    return { at: Date.now(), body };
=======
  const TLE_USER_AGENT =
    'gods-eye-view-celestrak-proxy/1.0 (+https://github.com/bilawalsidhu/gods-eye-view)';

  /**
   * Ordered TLE upstreams for a group. CelesTrak is primary; the two keyless
   * mirrors below serve the SAME CelesTrak groups in 3LE and cover every group
   * this app loads (including `starlink`). Tried in turn so one host being
   * down or rate-limited (e.g. CelesTrak's ~2 h per-IP 403 window, which 502s
   * `active`/`starlink`) never empties the satellites layer.
   *  - retlector.eu            — community CelesTrak GP proxy, /[group]/tle
   *  - satvisor-data (GitHub)  — GH-Actions mirror refreshed ~2 hourly
   */
  function tleUpstreamUrls(group) {
    const slug = encodeURIComponent(group);
    // 顺序按「中国大陆实测可达性」排：celestrak.org 在大陆经常整段超时，
    // GitHub raw 镜像与 retlector 反而 0.5~2.2s 就能拿到同样分组，
    // 所以镜像优先、官方垫底，避免每次都白等 20s 超时再回退。
    return [
      `https://raw.githubusercontent.com/satvisorcom/satvisor-data/master/celestrak/tle/${slug}.tle`,
      `https://retlector.eu/${slug}/tle`,
      celestrakTleUrl(group).toString(),
    ];
  }

  async function fetchUpstream(group) {
    let lastError = null;
    for (const url of tleUpstreamUrls(group)) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(20000),
          // CelesTrak 403s bulk groups (e.g. `active`) unless the request
          // carries a descriptive User-Agent with a contact point.
          headers: { 'User-Agent': TLE_USER_AGENT },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.text();
        // An upstream error page parses to zero TLEs — treat as failure, keep cache.
        if (!/^1 /m.test(body)) throw new Error('no TLE lines in response');
        return { at: Date.now(), body };
      } catch (err) {
        lastError = err;
        // SECURITY: never echo upstream detail (response bodies, URLs, tokens)
        // into the log — a failing upstream can return an HTML page or a
        // credential-bearing URL, and this line is user-visible. Only the host
        // plus a coarse reason class leaves this proxy.
        const raw = String(err?.message ?? '');
        const reason = /^HTTP \d{3}$/.test(raw) ? raw : 'request failed';
        console.warn(
          `[celestrak-proxy] upstream failed (${url.split('/')[2]}): ${reason}`,
        );
      }
    }
    throw lastError || new Error('all TLE upstreams failed');
>>>>>>> theirs
  }

  const installMiddleware = (server) => {
    server.middlewares.use('/api/celestrak', async (req, res) => {
      const group = String(req.url || '')
        .replace(/^\//, '')
        .split('?')[0];
      // Keyless and needed to render the satellites layer: refuse cross-site
      // browsers but keep the documented reverse-proxy deployment working.
      if (admitSameSiteKeyless(req, res)) return;
      if (req.method !== 'GET') {
        res.writeHead(405);
        res.end();
        return;
      }
      if (!groups.has(group)) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('invalid group');
        return;
      }
      const send = (status, body, cacheStatus, entry) => {
        // Guard against a double-send (e.g. a throw AFTER a response already
        // went out routing into the catch's send): writeHead after headersSent
        // throws "Cannot set headers after they are sent".
        if (res.headersSent) return;
        res.writeHead(status, {
          'Content-Type': 'text/plain',
          'x-tle-cache': cacheStatus,
          'Cache-Control': 'no-store',
          ...(entry
            ? { 'X-TLE-Cached-At': new Date(entry.at).toISOString() }
            : {}),
          ...(cooldownUntil > 0 && Date.now() < cooldownUntil
            ? {
                'Retry-After': String(
                  Math.ceil((cooldownUntil - Date.now()) / 1000),
                ),
              }
            : {}),
        });
        res.end(body);
      };
      try {
        const now = Date.now();
        let entry = mem.get(group);
        if (!entry) {
          entry = await readDisk(group);
          if (entry) mem.set(group, entry);
        }
        if (entry && now - entry.at < TLE_TTL_MS) {
          send(200, entry.body, 'HIT', entry);
          return;
        }
        if (Date.now() < cooldownUntil) {
          send(
            entry ? 200 : 502,
            entry?.body || 'celestrak upstream cooling down',
            entry ? 'STALE-ERROR' : 'NONE',
            entry,
          );
          return;
        }
        // Stale or missing → refresh, single-flight per group.
        if (!inflight.has(group)) {
          inflight.set(
            group,
            fetchUpstream(group)
              .then(async (fresh) => {
                mem.set(group, fresh);
                await writeDisk(group, fresh);
                return fresh;
              })
              .catch((err) => {
                if (Date.now() >= cooldownUntil)
                  cooldownUntil = Date.now() + 60000;
                console.warn(
                  '[celestrak-proxy] refresh failed — serving cache if any',
                );
                return null;
              })
              .finally(() => inflight.delete(group)),
          );
        }
        const fresh = await inflight.get(group);
        if (fresh) {
          send(200, fresh.body, 'MISS', fresh);
        } else if (entry) {
          send(200, entry.body, 'STALE-ERROR', entry); // upstream down — stale beats empty
        } else {
          send(502, 'celestrak fetch failed and no cache available', 'NONE');
        }
      } catch (err) {
        console.error('[celestrak-proxy] request failed');
        send(500, 'celestrak proxy error', 'ERROR');
      }
    });
  };
  return {
    name: 'celestrak-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}
