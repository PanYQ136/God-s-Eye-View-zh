/**
 * 小程序地名 / POI 检索代理 —— `GET /api/mini/geocode?q=上海&limit=6`
 *
 * 通道链（自动降级，主通道空/失败立刻走备用）：
 *   1) 高德 Web 服务（place/text + geocode/geo）—— 国内 0.4s，中文 POI 最全，返回 **GCJ-02**
 *   2) Nominatim（OSM）—— 国外源，大陆常超时
 *   3) Photon（komoot）—— 同上
 *
 * 坐标注意：高德返回 GCJ-02，Nominatim/Photon 返回 WGS-84。
 * 每条结果带 `crs`，客户端按它决定是否还要做 WGS84→GCJ02 转换，
 * 否则高德结果再转一次会偏 500 米左右。
 *
 * 缓存：进程内 10 分钟；空结果负缓存 60s，避免反复打挂掉的源。
 */

const CACHE_TTL_MS = 10 * 60 * 1000;
const NEG_TTL_MS = 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map();

const UA = 'gods-eye-view/0.1 (+https://github.com/bilawalsidhu/gods-eye-view)';
const AMAP_BASE = 'https://restapi.amap.com';

/**
 * 高德配额冷却：个人 key 每日有额度，打满后每个请求都要等一次失败。
 * 命中 10003（日额度用尽）/10044（当日调用超限）/10004（过于频繁）就冷却，
 * 冷却期内直接跳过高德，由腾讯 → 天地图顶上（保底）。
 */
const AMAP_DAILY_COOLDOWN_MS = 10 * 60 * 1000; // 日额度：10 分钟内不再试
const AMAP_RATE_COOLDOWN_MS = 60 * 1000; // 限流：1 分钟
let amapCooldownUntil = 0;
let amapCooldownReason = '';

function amapCooling() {
  return Date.now() < amapCooldownUntil;
}

function noteAmapFailure(info, infocode) {
  const code = String(infocode || '');
  const txt = String(info || '');
  if (
    code === '10003' ||
    code === '10044' ||
    /DAILY_QUERY_OVER_LIMIT|CUQPS_HAS_EXCEEDED/.test(txt)
  ) {
    amapCooldownUntil = Date.now() + AMAP_DAILY_COOLDOWN_MS;
    amapCooldownReason = 'quota';
    return true;
  }
  if (code === '10004' || /ACCESS_TOO_FREQUENT/.test(txt)) {
    amapCooldownUntil = Date.now() + AMAP_RATE_COOLDOWN_MS;
    amapCooldownReason = 'rate';
    return true;
  }
  return false;
}

function amapKey() {
  return String(process.env.AMAP_KEY || process.env.VITE_AMAP_KEY || '').trim();
}

function normNominatim(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((h) => ({
      name: h.display_name || h.name || '',
      lat: Number(h.lat),
      lon: Number(h.lon),
      kind: h.type || h.category || 'place',
      source: 'nominatim',
      crs: 'wgs84',
    }))
    .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon) && x.name);
}

function normPhoton(d) {
  const feats = d && Array.isArray(d.features) ? d.features : [];
  return feats
    .map((f) => {
      const c = (f.geometry && f.geometry.coordinates) || [];
      const p = f.properties || {};
      const name = [p.name, p.city, p.state, p.country]
        .filter(Boolean)
        .join(', ');
      return {
        name: name || p.osm_value || '',
        lat: Number(c[1]),
        lon: Number(c[0]),
        kind: p.osm_value || p.type || 'place',
        source: 'photon',
        crs: 'wgs84',
      };
    })
    .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon) && x.name);
}

/** "119.29,26.07" → {lat, lon} */
function amapLoc(loc) {
  const parts = String(loc || '').split(',');
  if (parts.length !== 2) return null;
  const lon = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function normAmapPois(pois) {
  const out = [];
  for (const p of Array.isArray(pois) ? pois : []) {
    const pos = amapLoc(p && p.location);
    if (!pos) continue; // 高德常返回空 location 的行政区占位
    const area = [p.cityname, p.adname].filter(Boolean).join(' · ');
    out.push({
      name: String(p.name || '').trim(),
      lat: pos.lat,
      lon: pos.lon,
      kind: String(p.type || 'place')
        .split(';')
        .pop(),
      addr: [area, p.address].filter(Boolean).join(' ').trim(),
      source: 'amap',
      crs: 'gcj02',
    });
  }
  return out.filter((x) => x.name);
}

function normAmapGeos(geos) {
  const out = [];
  for (const g of Array.isArray(geos) ? geos : []) {
    const pos = amapLoc(g && g.location);
    if (!pos) continue;
    out.push({
      name: String(g.formatted_address || '').trim(),
      lat: pos.lat,
      lon: pos.lon,
      kind: String(g.level || 'address'),
      addr: String(g.formatted_address || '').trim(),
      source: 'amap',
      crs: 'gcj02',
    });
  }
  return out.filter((x) => x.name);
}

async function fetchJson(url, headers, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { signal: ac.signal, headers });
    if (!r.ok) return { ok: false, status: r.status, ms: Date.now() - t0 };
    return { ok: true, data: await r.json(), ms: Date.now() - t0 };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: String((err && err.message) || err),
      ms: Date.now() - t0,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 主通道：高德。POI + 地址并行，POI 在前。 */
async function tryAmap(q, limit, near) {
  const key = amapKey();
  if (!key)
    return { rows: [], channel: { name: 'amap', ok: false, reason: 'no_key' } };

  const common = 'key=' + encodeURIComponent(key) + '&extensions=base';
  const [poi, geo] = await Promise.all([
    fetchJson(
      AMAP_BASE +
        '/v3/place/text?keywords=' +
        encodeURIComponent(q) +
        '&offset=' +
        Math.min(25, limit) +
        '&page=1&citylimit=false' +
        (near ? '&location=' + near + '&sortrule=distance' : '') + // 有当前视口就按距离排，避免"东景家园"跳到别的城市
        '&' +
        common,
      { Accept: 'application/json' },
      6000,
    ),
    fetchJson(
      AMAP_BASE +
        '/v3/geocode/geo?address=' +
        encodeURIComponent(q) +
        '&' +
        common,
      { Accept: 'application/json' },
      6000,
    ),
  ]);

  const poiOk = !!(poi.ok && poi.data && String(poi.data.status) === '1');
  const geoOk = !!(geo.ok && geo.data && String(geo.data.status) === '1');
  if (!poiOk && poi.data && poi.data.info)
    noteAmapFailure(poi.data.info, poi.data.infocode);
  if (!geoOk && geo.data && geo.data.info)
    noteAmapFailure(geo.data.info, geo.data.infocode);
  const rows = [
    ...(poiOk ? normAmapPois(poi.data.pois) : []),
    ...(geoOk ? normAmapGeos(geo.data.geocodes) : []),
  ];

  return {
    rows,
    channel: {
      name: 'amap',
      ok: rows.length > 0,
      ms: Math.max(poi.ms || 0, geo.ms || 0),
      reason:
        poiOk || geoOk
          ? undefined
          : (poi.data && poi.data.info) ||
            (geo.data && geo.data.info) ||
            poi.error ||
            geo.error ||
            'no_data',
    },
  };
}

/** 腾讯位置服务（与小程序底图同源，GCJ-02）：POI 搜索 + 地址解析 */
async function tryTencent(q, limit, near) {
  const key = String(process.env.TENCENT_MAP_KEY || '').trim();
  if (!key)
    return {
      rows: [],
      channel: { name: 'tencent', ok: false, reason: 'no_key' },
    };

  const [poi, geo] = await Promise.all([
    fetchJson(
      'https://apis.map.qq.com/ws/place/v1/search?keyword=' +
        encodeURIComponent(q) +
        '&boundary=' +
        (near
          ? 'nearby(' +
            near.split(',')[1] +
            ',' +
            near.split(',')[0] +
            ',50000,0)'
          : 'region(' + encodeURIComponent('全国') + ',0)') +
        '&page_size=' +
        Math.min(20, limit) +
        '&key=' +
        encodeURIComponent(key),
      { Accept: 'application/json' },
      6000,
    ),
    fetchJson(
      'https://apis.map.qq.com/ws/geocoder/v1/?address=' +
        encodeURIComponent(q) +
        '&key=' +
        encodeURIComponent(key),
      { Accept: 'application/json' },
      6000,
    ),
  ]);

  const out = [];
  const pois =
    poi.ok && poi.data && Array.isArray(poi.data.data) ? poi.data.data : [];
  for (const p of pois) {
    const loc = p && p.location;
    if (!loc) continue;
    out.push({
      name: String(p.title || '').trim(),
      lat: Number(loc.lat),
      lon: Number(loc.lng),
      kind: String(p.category || 'place')
        .split(':')
        .pop(),
      addr: String(p.address || '').trim(),
      source: 'tencent',
      crs: 'gcj02',
    });
  }
  const gr = geo.ok && geo.data && geo.data.result ? geo.data.result : null;
  if (gr && gr.location) {
    out.push({
      name: String(gr.title || gr.address || '').trim() || q,
      lat: Number(gr.location.lat),
      lon: Number(gr.location.lng),
      kind: String(gr.level || 'address'),
      addr: String(gr.address || '').trim(),
      source: 'tencent',
      crs: 'gcj02',
    });
  }
  return {
    rows: out.filter(
      (x) => x.name && Number.isFinite(x.lat) && Number.isFinite(x.lon),
    ),
    channel: {
      name: 'tencent',
      ok: out.length > 0,
      ms: Math.max(poi.ms || 0, geo.ms || 0),
    },
  };
}

async function tryNominatim(q, limit, timeoutMs) {
  const r = await fetchJson(
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=' +
      limit +
      '&accept-language=zh,en&q=' +
      encodeURIComponent(q),
    {
      'User-Agent': UA,
      Referer: 'https://github.com/bilawalsidhu/gods-eye-view',
      Accept: 'application/json',
    },
    timeoutMs || 8000,
  );
  return {
    rows: r.ok ? normNominatim(r.data) : [],
    channel: { name: 'nominatim', ok: r.ok, ms: r.ms, status: r.status },
  };
}

async function tryPhoton(q, limit) {
  const r = await fetchJson(
    'https://photon.komoot.io/api/?limit=' +
      limit +
      '&q=' +
      encodeURIComponent(q),
    { 'User-Agent': UA, Accept: 'application/json' },
    4000, // 大陆基本连不上，只留 4s 兜底
  );
  return {
    rows: r.ok ? normPhoton(r.data) : [],
    channel: { name: 'photon', ok: r.ok, ms: r.ms, status: r.status },
  };
}

/** 同一点去重（POI 与地址常撞）并截断 */
function dedupe(rows, limit) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const k = r.lat.toFixed(4) + ',' + r.lon.toFixed(4);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/** 天地图 POI 搜索（v2/search）—— 第三条通道，有中文分类，坐标 WGS-84 */
async function tryTiandituPoi(q, limit, near) {
  const key = String(process.env.TIANDITU_SERVER_KEY || '').trim();
  if (!key)
    return {
      rows: [],
      channel: { name: 'tianditu-poi', ok: false, reason: 'no_key' },
    };
  const c = String(near || '').split(',');
  const lng = Number(c[0]) || 116.4;
  const lat = Number(c[1]) || 39.9;
  const d = 0.25;
  const post = {
    keyWord: q,
    level: 12,
    mapBound: [lng - d, lat - d, lng + d, lat + d]
      .map((x) => x.toFixed(4))
      .join(','),
    queryType: 1,
    start: 0,
    count: Math.min(20, limit * 3),
    show: 1,
  };
  const r = await fetchJson(
    'https://api.tianditu.gov.cn/v2/search?postStr=' +
      encodeURIComponent(JSON.stringify(post)) +
      '&type=query&tk=' +
      encodeURIComponent(key),
    { Accept: 'application/json' },
    7000,
  );
  const pois = r.ok && r.data && Array.isArray(r.data.pois) ? r.data.pois : [];
  const rows = [];
  for (const p of pois) {
    const ll = String(p.lonlat || '').split(',');
    if (ll.length !== 2) continue;
    const plng = Number(ll[0]);
    const plat = Number(ll[1]);
    if (!Number.isFinite(plat) || !Number.isFinite(plng)) continue;
    rows.push({
      name: String(p.name || '').trim(),
      lat: plat,
      lon: plng,
      kind: String(p.poiType || 'place'),
      addr: String(p.address || '').trim(),
      source: 'tianditu',
      crs: 'wgs84',
    });
  }
  return {
    rows: rows.filter((x) => x.name),
    channel: { name: 'tianditu-poi', ok: rows.length > 0, ms: r.ms },
  };
}

/** 腾讯逆地理：GCJ-02 坐标 → 人类可读地址（起终点/长按点位显示用） */
async function tencentReverse(lat, lng) {
  const key = String(process.env.TENCENT_MAP_KEY || '').trim();
  if (!key) return null;
  const r = await fetchJson(
    'https://apis.map.qq.com/ws/geocoder/v1/?location=' +
      lat +
      ',' +
      lng +
      '&get_poi=0&key=' +
      encodeURIComponent(key),
    { Accept: 'application/json' },
    5000,
  );
  if (!r.ok || !r.data || Number(r.data.status) !== 0) return null;
  const res = r.data.result || {};
  const comp = res.address_component || {};
  const rec =
    (res.formatted_addresses && res.formatted_addresses.recommend) || '';
  const addr = String(res.address || '').trim();
  const name = rec || addr;
  return {
    name,
    addr,
    province: comp.province || '',
    city: comp.city || '',
    district: comp.district || '',
    source: 'tencent',
  };
}

/** 天地图地理编码（备用通道，WGS-84 返回） */
async function tryTianditu(q, limit) {
  const key = String(
    process.env.TIANDITU_SERVER_KEY || process.env.TIANDITU_KEY || '',
  ).trim();
  if (!key)
    return {
      rows: [],
      channel: { name: 'tianditu', ok: false, reason: 'no_key' },
    };
  const r = await fetchJson(
    'https://api.tianditu.gov.cn/geocoder?ds=' +
      encodeURIComponent(JSON.stringify({ keyWord: q })) +
      '&tk=' +
      encodeURIComponent(key),
    { Accept: 'application/json' },
    6000,
  );
  const loc = r.ok && r.data && r.data.location ? r.data.location : null;
  const lon = loc ? Number(loc.lon) : NaN;
  const lat = loc ? Number(loc.lat) : NaN;
  const rows =
    Number.isFinite(lat) && Number.isFinite(lon)
      ? [
          {
            name: q,
            lat,
            lon,
            kind: String(loc.level || 'place'),
            addr: q,
            source: 'tianditu',
            crs: 'wgs84',
          },
        ]
      : [];
  return {
    rows,
    channel: {
      name: 'tianditu',
      ok: rows.length > 0,
      ms: r.ms,
      status: r.status,
    },
  };
}

/** 天地图逆地理（备用通道，服务端 key） */
async function tiandituReverse(lat, lng) {
  const key = String(
    process.env.TIANDITU_SERVER_KEY || process.env.TIANDITU_KEY || '',
  ).trim();
  if (!key) return null;
  const post = JSON.stringify({ lon: lng, lat, ver: 1 });
  const r = await fetchJson(
    'https://api.tianditu.gov.cn/geocoder?postStr=' +
      encodeURIComponent(post) +
      '&type=geocode&tk=' +
      encodeURIComponent(key),
    { Accept: 'application/json' },
    6000,
  );
  if (!r.ok || !r.data || !r.data.result) return null;
  const res = r.data.result;
  const c = res.addressComponent || {};
  return {
    name: res.formatted_address || '',
    addr: res.formatted_address || '',
    province: c.province || '',
    city: c.city || '',
    district: c.county || c.district || '',
    source: 'tianditu',
  };
}

export function miniGeocodeProxy() {
  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const q = String(url.searchParams.get('q') || '')
      .trim()
      .slice(0, 120);
    const limit = Math.max(
      1,
      Math.min(10, Number(url.searchParams.get('limit')) || 6),
    );
    const nearRaw = String(url.searchParams.get('near') || '');
    const near = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(nearRaw) ? nearRaw : '';
    if (!q) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'missing_q' }));
      return;
    }

    const key = q.toLowerCase() + '|' + limit + '|' + near;
    const hit = cache.get(key);
    if (
      hit &&
      Date.now() - hit.at < (hit.rows.length ? CACHE_TTL_MS : NEG_TTL_MS)
    ) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'max-age=600',
        'X-Gev-Channel': hit.source || 'cache',
      });
      res.end(
        JSON.stringify({
          query: q,
          source: hit.source,
          crs: hit.crs,
          results: hit.rows,
          cached: true,
        }),
      );
      return;
    }

    // 主通道空/失败 → 自动走备用
    const channels = [];
    let rows = [];
    let source = '';
    let crs = 'wgs84';

    // 英文/拼音查询（"Fuzhou"）：高德会拐到抚州，先并行问一次 Nominatim，
    // 3.5s 内有结果就用它，没有就落到高德，不额外增加等待。
    if (/^[\x20-\x7e]+$/.test(q)) {
      const [nom, amap] = await Promise.all([
        tryNominatim(q, limit, 3500),
        tryAmap(q, limit, near),
      ]);
      channels.push(nom.channel);
      if (nom.rows.length) {
        rows = nom.rows;
        source = 'nominatim';
        crs = 'wgs84';
      } else {
        channels.push(amap.channel);
        if (amap.rows.length) {
          rows = amap.rows;
          source = 'amap';
          crs = 'gcj02';
        } else {
          const tx = await tryTencent(q, limit, near);
          channels.push(tx.channel);
          if (tx.rows.length) {
            rows = tx.rows;
            source = 'tencent';
            crs = 'gcj02';
          }
        }
      }
    }

    const chain = rows.length
      ? []
      : [
          tryAmap,
          tryTencent,
          tryTiandituPoi,
          tryNominatim,
          tryPhoton,
          tryTianditu,
        ];
    if (amapCooling()) {
      channels.push({
        name: 'amap',
        ok: false,
        reason: 'cooldown:' + amapCooldownReason,
      });
    }
    for (const attempt of chain) {
      if (attempt === tryAmap && amapCooling()) continue;
      const r = await attempt(q, limit, near);
      channels.push(r.channel);
      if (r.rows.length) {
        rows = r.rows;
        source = r.channel.name;
        crs = r.rows[0].crs || 'wgs84';
        break;
      }
    }

    rows = dedupe(rows, limit);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);

    if (!rows.length) {
      cache.set(key, { at: Date.now(), rows: [], source: '', crs: 'wgs84' });
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'no_result', query: q, channels }));
      return;
    }

    cache.set(key, { at: Date.now(), rows, source, crs });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'max-age=600',
      'X-Gev-Channel': source,
    });
    res.end(JSON.stringify({ query: q, source, crs, results: rows, channels }));
  };

  const rgeoCache = new Map();
  const rgeoHandler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'bad_latlng' }));
      return;
    }
    const key = lat.toFixed(4) + ',' + lng.toFixed(4);
    const hit = rgeoCache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60_000) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(hit.body);
      return;
    }
    const out =
      (await tencentReverse(lat, lng)) || (await tiandituReverse(lat, lng));
    const body = JSON.stringify(out ? { ok: true, ...out } : { ok: false });
    if (out) {
      if (rgeoCache.size > 300) rgeoCache.delete(rgeoCache.keys().next().value);
      rgeoCache.set(key, { at: Date.now(), body });
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'max-age=600',
    });
    res.end(body);
  };

  return {
    name: 'mini-geocode',
    configureServer({ middlewares }) {
      middlewares.use('/api/mini/geocode', handler);
      middlewares.use('/api/mini/rgeocode', rgeoHandler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/mini/geocode', handler);
      middlewares.use('/api/mini/rgeocode', rgeoHandler);
    },
  };
}
