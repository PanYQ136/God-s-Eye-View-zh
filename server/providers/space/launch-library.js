import path from 'node:path';
import { providerCooldownMs } from './cooldown.js';
import { promises as fsp } from 'node:fs';
import {
  readResponseTextCapped,
  coalesceProxyRequest,
} from '../common/http.js';
import { launchLibraryRecentUrl } from '../../../src/data/spaceProviderRequests.js';

// 发射计划几小时才变一次；LL2 在大陆常连不上，缓存拉长到 3h，
// 上游失败时 continue 用 disk 里的旧数据（serve-stale 已有）。
export const LL2_CACHE_TTL_MS = 3 * 60 * 60_000;

/** Build LL2 request headers without exposing its optional token client-side. */
export function launchLibraryRequestHeaders(token = process.env.LL2_API_TOKEN) {
  const normalized = String(token || '').trim();
  return {
    Accept: 'application/json',
    'User-Agent':
      'gods-eye-view-launch-library-proxy/1.0 (+https://github.com/bilawalsidhu/gods-eye-view)',
    ...(normalized ? { Authorization: `Token ${normalized}` } : {}),
  };
}

/** Proxy the public Launch Library 2 recent-launch feed server-side. */
export function rocketLaunchesProxy() {
  const ttlMs = LL2_CACHE_TTL_MS;
  const maxResponseBytes = 12 * 1024 * 1024;
  const maxDiskCacheBytes = 24 * 1024 * 1024;
  const cachePath = path.join(
    process.cwd(),
    '.gev-cache',
    'launch-library-2-v2.3.json',
  );
  let cache = null;
  let cooldownUntil = 0;
  let cooldownStatus = 502;
  let diskLoaded = false;
  const inFlight = new Map();

  async function loadDiskCache() {
    if (diskLoaded) return;
    diskLoaded = true;
    try {
      const stat = await fsp.stat(cachePath);
      if (stat.size > maxDiskCacheBytes)
        throw new Error('cache file too large');
      const parsed = JSON.parse(await fsp.readFile(cachePath, 'utf8'));
      if (Number.isFinite(parsed?.at) && typeof parsed?.body === 'string') {
        const body = JSON.parse(parsed.body);
        if (Array.isArray(body?.results)) cache = parsed;
      }
    } catch {
      /* first run or invalid cache */
    }
  }

  async function saveDiskCache(entry) {
    try {
      await fsp.mkdir(path.dirname(cachePath), { recursive: true });
      await fsp.writeFile(cachePath, JSON.stringify(entry), 'utf8');
    } catch (error) {
      console.warn('[launch-library-proxy] cache write failed');
    }
  }

  function send(res, status, body, cacheState) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control':
        status === 200 && cacheState !== 'STALE-ERROR'
          ? 'public, max-age=900'
          : 'no-store',
      ...(cache ? { 'X-GEV-Cached-At': new Date(cache.at).toISOString() } : {}),
      ...(Date.now() < cooldownUntil
        ? {
            'Retry-After': String(
              Math.ceil((cooldownUntil - Date.now()) / 1000),
            ),
          }
        : {}),
      'X-GEV-Cache': cacheState,
    });
    res.end(body);
  }

  async function refreshUpstream() {
    const end = new Date();
    const url = launchLibraryRecentUrl(end);
    const upstream = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: launchLibraryRequestHeaders(),
    });
    if (!upstream.ok) {
      const deadline = Date.now() + providerCooldownMs(upstream);
      // Never shorten a longer cooldown that is already in force.
      if (deadline >= cooldownUntil) {
        cooldownUntil = deadline;
        cooldownStatus = upstream.status;
      }
      void upstream.body?.cancel().catch(() => {});
      const error = new Error(`upstream HTTP ${upstream.status}`);
      error.upstreamStatus = upstream.status;
      throw error;
    }
    const body = await readResponseTextCapped(upstream, maxResponseBytes);
    const parsed = JSON.parse(body);
    if (!Array.isArray(parsed?.results))
      throw new Error('malformed upstream response');
    const fresh = { at: Date.now(), body };
    cache = fresh;
    cooldownUntil = 0;
    void saveDiskCache(fresh);
    return fresh;
  }

  /** 只保留小程序真正用到的字段（LL2 原始对象 700KB+，其中 95% 是描述/机构/图库） */
  function slimLaunch(l) {
    if (!l || typeof l !== 'object') return null;
    const out = {};
    ['id', 'slug', 'name', 'net', 'window_start', 'window_end'].forEach((k) => {
      if (l[k] !== undefined && l[k] !== null) out[k] = l[k];
    });
    if (l.pad && typeof l.pad === 'object') {
      out.pad = {
        name: l.pad.name,
        latitude: l.pad.latitude,
        longitude: l.pad.longitude,
      };
      if (l.pad.location && l.pad.location.name)
        out.pad.location = { name: l.pad.location.name };
    }
    if (l.mission && typeof l.mission === 'object') {
      out.mission = { name: l.mission.name };
      const o = l.mission.orbit || l.orbit;
      if (o) out.mission.orbit = { name: o.name, abbrev: o.abbrev };
    }
    if (l.status && typeof l.status === 'object') {
      out.status = { name: l.status.name, abbrev: l.status.abbrev };
    }
    if (l.launch_service_provider && l.launch_service_provider.name) {
      out.launch_service_provider = { name: l.launch_service_provider.name };
    }
    if (l.rocket && typeof l.rocket === 'object') {
      out.rocket = {};
      if (l.rocket.configuration && l.rocket.configuration.name) {
        out.rocket.configuration = { name: l.rocket.configuration.name };
      }
      const payloads = Array.isArray(l.rocket.payloads)
        ? l.rocket.payloads
        : Array.isArray(l.payloads)
          ? l.payloads
          : [];
      if (payloads.length) {
        out.rocket.payloads = payloads
          .slice(0, 8)
          .map((entry) => {
            const pl = (entry && entry.payload) || entry || {};
            return { name: pl.name || (entry && entry.name) || '' };
          })
          .filter((x) => x.name);
      }
    }
    if (l.image && typeof l.image === 'object') {
      out.image = {
        image_url: l.image.image_url,
        thumbnail_url: l.image.thumbnail_url,
        name: l.image.name,
      };
    }
    return out;
  }

  /** ?slim=1 的响应体；同一份上游 body 只转换一次 */
  function slimBody(text) {
    if (slimMemo.src === text) return slimMemo.body;
    let body = text;
    try {
      const parsed = JSON.parse(text);
      const results = Array.isArray(parsed && parsed.results)
        ? parsed.results
        : [];
      body = JSON.stringify({
        count: results.length,
        next: null,
        previous: null,
        results: results.map(slimLaunch).filter(Boolean),
      });
    } catch (e) {
      /* 解析失败就原样返回 */
    }
    slimMemo = { src: text, body: body };
    return body;
  }
  let slimMemo = { src: '', body: '' };

  function install(middlewares) {
    middlewares.use('/api/launches', async (req, res) => {
      const slimWanted = /[?&]slim=1/.test(String(req.url || ''));
      const outBody = (body) => (slimWanted ? slimBody(body) : body);
      if (req.method !== 'GET') {
        send(res, 405, JSON.stringify({ error: 'Method Not Allowed' }), 'NONE');
        return;
      }
      await loadDiskCache();
      const now = Date.now();
      if (cache && now - cache.at < ttlMs) {
        send(res, 200, outBody(cache.body), 'HIT');
        return;
      }
      const stale = cache;
      if (now < cooldownUntil) {
        send(
          res,
          stale ? 200 : cooldownStatus,
          stale?.body ||
            JSON.stringify({ error: 'Launch Library 2 unavailable' }),
          stale ? 'STALE-ERROR' : 'NONE',
        );
        return;
      }
      const request = coalesceProxyRequest(
        inFlight,
        'recent-launches',
        refreshUpstream,
      );
      try {
        const fresh = await request.promise;
        send(
          res,
          200,
          outBody(fresh.body),
          request.shared ? 'INFLIGHT' : 'MISS',
        );
      } catch (error) {
        if (Date.now() >= cooldownUntil) {
          cooldownUntil = Date.now() + 60000;
          cooldownStatus = 502;
        }
        // Log only a bounded status, never upstream bodies, URLs, or credentials.
        const status = Number.isInteger(error?.upstreamStatus)
          ? error.upstreamStatus
          : 502;
        if (!request.shared)
          console.warn(
            `[launch-library-proxy] refresh failed (HTTP ${status})${stale ? ' — serving stale cache' : ''}`,
          );
        if (stale) {
          send(res, 200, stale.body, 'STALE-ERROR');
          return;
        }
        send(
          res,
          status,
          JSON.stringify({ error: 'Launch Library 2 unavailable' }),
          'NONE',
        );
      }
    });
  }

  return {
    name: 'rocket-launches-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}
