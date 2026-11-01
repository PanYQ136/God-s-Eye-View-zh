/**
 * 小程序航班代理（多通道自动切换）
 *
 *   GET /api/flights?bbox=w,s,e,n&limit=300
 *
 * 通道优先级：
 *   1) pocketworld.org（聚合源，字段最全：机型/航司/航线）
 *   2) OpenSky 官方 /api/states/all（按 bbox 直连，匿名限流）
 *   3) adsb.lol /v2/point（社区源，军机覆盖好）
 *
 * 任一通道成功即返回，响应里带 `channel` 字段，客户端和设置页都能看到这次走的哪条。
 * 失败的通道 90 秒内不再重试（避免每次刷新都撞墙）。
 */

import { sendJson } from './send-json.js';

const CHANNEL_COOLDOWN = 30 * 1000; // 90s 太长：上游抖一下就整整一分半没有数据
const CACHE_TTL_MS = 20 * 1000;
const STALE_MAX_MS = 5 * 60 * 1000; // 过期后仍可用于 SWR 的最大年龄
const refreshing = new Set(); // 正在后台刷新的 key，避免并发打上游
const CACHE_MAX = 24;
const cache = new Map();
const cool = new Map(); // channel → 冷却截止时间

function parseBbox(raw) {
  if (!raw) return null;
  const parts = String(raw)
    .split(',')
    .map((x) => Number(x));
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

async function getJson(url, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'gods-eye-mini/1.0 (+local proxy)',
      },
    });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, data: await r.json() };
  } catch (err) {
    return { ok: false, status: 0, error: String((err && err.message) || err) };
  } finally {
    clearTimeout(timer);
  }
}

function fromPocketworld(d, limit) {
  const arr = Array.isArray(d && d.flights) ? d.flights : [];
  return arr.slice(0, limit).map((f) => ({
    icao24: f.icao24,
    callsign: f.callsign,
    lat: f.lat,
    lng: f.lng,
    alt: f.alt,
    velocity: f.velocity,
    heading: f.display_heading !== undefined ? f.display_heading : f.heading,
    vertical_rate: f.vertical_rate,
    on_ground: f.on_ground,
    typecode: f.typecode,
    model: f.model,
    registration: f.registration,
    country: f.country,
    operator: f.operator,
    origin: f.origin,
    destination: f.destination,
    last_contact: f.last_contact,
  }));
}

function fromOpenSky(d, limit) {
  const states = Array.isArray(d && d.states) ? d.states : [];
  const out = [];
  for (let i = 0; i < states.length && out.length < limit; i++) {
    const s = states[i] || [];
    const lat = Number(s[6]);
    const lng = Number(s[5]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      icao24: s[0],
      callsign: (s[1] || '').trim(),
      lat,
      lng,
      alt: Number.isFinite(Number(s[7])) ? Number(s[7]) : null,
      velocity: Number.isFinite(Number(s[9])) ? Number(s[9]) : null,
      heading: Number.isFinite(Number(s[10])) ? Number(s[10]) : null,
      vertical_rate: Number.isFinite(Number(s[11])) ? Number(s[11]) : null,
      on_ground: s[8] === true,
      country: s[2] || null,
      last_contact: s[4] || null,
    });
  }
  return out;
}

function fromAdsbLol(d, limit) {
  const arr = Array.isArray(d && d.ac) ? d.ac : [];
  return arr.slice(0, limit).map((a) => ({
    icao24: a.hex,
    callsign: (a.flight || '').trim(),
    lat: a.lat,
    lng: a.lon,
    alt: a.alt_baro === 'ground' ? 0 : a.alt_baro,
    velocity: a.gs ? a.gs * 0.514444 : null,
    heading: a.track,
    vertical_rate: a.bar_rate,
    on_ground: a.alt_baro === 'ground',
    typecode: a.t,
    registration: a.r,
    country: null,
    last_contact: a.seen_pos
      ? Math.floor(Date.now() / 1000) - a.seen_pos
      : null,
  }));
}

export function miniFlightsProxy() {
  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const bbox = parseBbox(url.searchParams.get('bbox'));
    const limit = clampLimit(url.searchParams.get('limit'));
    const key = `${bbox ? bbox.join(',') : 'global'}|${limit}`;

    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      sendJson(
        req,
        res,
        200,
        { ...hit.payload, cached: true },
        { 'Cache-Control': 'max-age=20', 'x-mini-flights-cache': 'hit' },
      );
      return;
    }
    // 过期但不算太旧（5 分钟内）：先把旧数据给出去，后台立刻刷新。
    // 上游一次 2.6s，SWR 之后小程序这边的等待从 2.6s 变成 ~2ms。
    if (hit && Date.now() - hit.at < STALE_MAX_MS) {
      sendJson(
        req,
        res,
        200,
        { ...hit.payload, cached: true, stale: true },
        { 'Cache-Control': 'max-age=10', 'x-mini-flights-cache': 'stale' },
      );
      if (!refreshing.has(key)) {
        refreshing.add(key);
        buildPayload(key, bbox, limit)
          .then((payload) => {
            if (!payload) return;
            cache.set(key, { at: Date.now(), payload });
            if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
          })
          .catch(() => {})
          .finally(() => refreshing.delete(key));
      }
      return;
    }

    const payload = await buildPayload(key, bbox, limit);
    if (!payload) {
      sendJson(req, res, 502, { error: 'all_channels_failed' });
      return;
    }
    cache.set(key, { at: Date.now(), payload });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    sendJson(req, res, 200, payload, {
      'Cache-Control': 'max-age=20',
      'x-mini-flights-cache': 'miss',
    });
  };

  /** 拉一次上游（多通道），返回 payload 或 null。handler 与后台刷新共用。 */
  async function buildPayload(key, bbox, limit) {
    const attempts = [];
    let flights = [];
    let channel = '';
    let sawOkEmpty = null; // 某个通道 200 但该 bbox 内没有航班（合法空结果）

    // 1) pocketworld
    if ((cool.get('pocketworld') || 0) < Date.now()) {
      const qs = new URLSearchParams({ limit: String(limit) });
      if (bbox) qs.set('bbox', bbox.join(','));
      const r = await getJson(
        `https://pocketworld.org/api/flights?${qs}`,
        20000,
      );
      if (r.ok) {
        flights = fromPocketworld(r.data, limit);
        channel = 'pocketworld';
        if (!flights.length) sawOkEmpty = channel; // 巴西内陆这种区域本来就没航班
      } else {
        cool.set('pocketworld', Date.now() + CHANNEL_COOLDOWN);
        attempts.push({ channel: 'pocketworld', status: r.status });
      }
    }

    // 2) OpenSky
    if (!flights.length && (cool.get('opensky') || 0) < Date.now()) {
      const b = bbox || [-180, -85, 180, 85];
      const u = `https://opensky-network.org/api/states/all?lamin=${b[1]}&lomin=${b[0]}&lamax=${b[3]}&lomax=${b[2]}`;
      const r = await getJson(u, 22000);
      if (r.ok) {
        flights = fromOpenSky(r.data, limit);
        channel = 'opensky';
        if (!flights.length) sawOkEmpty = channel;
      } else {
        cool.set('opensky', Date.now() + CHANNEL_COOLDOWN);
        attempts.push({ channel: 'opensky', status: r.status });
      }
    }

    // 3) adsb.lol
    if (!flights.length && (cool.get('adsblol') || 0) < Date.now()) {
      const b = bbox || [-180, -85, 180, 85];
      const cLat = (b[1] + b[3]) / 2;
      const cLon = (b[0] + b[2]) / 2;
      const spanLat = Math.abs(b[3] - b[1]);
      const radius = Math.max(10, Math.min(250, Math.round(spanLat * 60)));
      const r = await getJson(
        `https://api.adsb.lol/v2/point/${cLat}/${cLon}/${radius}`,
        18000,
      );
      if (r.ok) {
        flights = fromAdsbLol(r.data, limit);
        channel = 'adsb.lol';
        if (!flights.length) sawOkEmpty = channel;
      } else {
        cool.set('adsblol', Date.now() + CHANNEL_COOLDOWN);
        attempts.push({ channel: 'adsblol', status: r.status });
      }
    }

    // 全都没数据，但至少有一个通道是正常 200：这是"该区域确实没有航班"，不是故障
    if (!flights.length && !sawOkEmpty) return null;
    if (!flights.length) channel = sawOkEmpty;
    return {
      time: new Date().toISOString(),
      source: channel,
      channel,
      attempts,
      bbox: bbox || null,
      count: flights.length,
      empty: flights.length === 0,
      limit,
      flights,
    };
  }

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
