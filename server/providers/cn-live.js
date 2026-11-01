/**
 * 国内数据源（中国大陆可直连、免 key 或复用已有高德 key）
 *
 *   GET /api/cn/traffic?bbox=minLng,minLat,maxLng,maxLat&grid=3
 *       高德「交通态势」circle 采样：把视口切成 grid×grid 网格，逐格问一次拥堵状况，
 *       返回可直接画成 circles 的单元。中国大陆才有真实路况（TomTom 无覆盖）。
 *
 *   GET /api/cn/typhoon
 *       中央气象台台风网：活动台风的实况路径 + 官方预报路径（西北太平洋，NHC 不覆盖）。
 *
 * 两者都做进程内缓存；高德 key 只留在服务端。
 */

const AMAP = 'https://restapi.amap.com';
const HOUR = 3600_000;

const trafficCache = new Map(); // key -> { at, body }
const TRAFFIC_TTL = 3 * 60_000;
const TYPHOON_TTL = 30 * 60_000;
let typhoonCache = null; // { at, body }
const QUAKE_TTL = 5 * 60_000;
let quakeCache = null; // { at, body }

function amapKey() {
  return String(process.env.VITE_AMAP_KEY || process.env.AMAP_KEY || '').trim();
}

async function fetchText(url, timeoutMs, headers) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      signal: ac.signal,
      // 中央气象台的接口对非常规 UA 会直接断连，统一用浏览器 UA
      headers: headers || {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        Accept: '*/*',
      },
    });
    if (!r.ok) return { ok: false, status: r.status, ms: Date.now() - t0 };
    return { ok: true, body: await r.text(), ms: Date.now() - t0 };
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

/** 高德交通态势：单格 */
async function trafficCell(lat, lng, radius) {
  const key = amapKey();
  if (!key) return null;
  const url =
    AMAP +
    '/v3/traffic/status/circle?key=' +
    encodeURIComponent(key) +
    '&location=' +
    lng.toFixed(5) +
    ',' +
    lat.toFixed(5) +
    '&radius=' +
    Math.round(radius) +
    '&level=6&extensions=base';
  const r = await fetchText(url, 6000, { Accept: 'application/json' });
  if (!r.ok) return null;
  let d = null;
  try {
    d = JSON.parse(r.body);
  } catch {
    return null;
  }
  if (!d || String(d.status) !== '1' || !d.trafficinfo) return null;
  const ev = d.trafficinfo.evaluation || {};
  const level = Math.max(0, Math.min(4, Number(ev.status) || 0));
  if (!level) return null;
  return {
    lat: Number(lat.toFixed(5)),
    lng: Number(lng.toFixed(5)),
    radius: Math.round(radius),
    level,
    label: String(ev.description || ''),
    expedite: String(ev.expedite || ''),
    congested: String(ev.congested || ''),
    blocked: String(ev.blocked || ''),
    sample: String(d.trafficinfo.description || ''),
  };
}

/** 视口网格采样：grid×grid，串行分组避免打爆配额 */
async function trafficGrid(bbox, grid) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const n = Math.max(1, Math.min(5, grid || 3));
  const cellW = (maxLng - minLng) / n;
  const cellH = (maxLat - minLat) / n;
  // 半径取格子外接圆的一半，太小时按 400m 兜底
  const toM = (deg, lat) => deg * 111320 * Math.cos((lat * Math.PI) / 180);
  // 半径取格子短边的 30%（上限 1.5km）：够看清等级，又不会大到整个视口只剩一段弧
  const cellMin = Math.min(
    toM(cellW, (minLat + maxLat) / 2),
    toM(cellH, (minLat + maxLat) / 2),
  );
  const radius = Math.max(300, Math.min(1500, cellMin * 0.3));

  const tasks = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      tasks.push({
        lat: minLat + cellH * (i + 0.5),
        lng: minLng + cellW * (j + 0.5),
      });
    }
  }
  const cells = [];
  const BATCH = 4;
  for (let i = 0; i < tasks.length; i += BATCH) {
    const part = await Promise.all(
      tasks.slice(i, i + BATCH).map((t) => trafficCell(t.lat, t.lng, radius)),
    );
    for (const c of part) if (c) cells.push(c);
  }
  return { cells, radius, grid: n };
}

/** 解析 JSONP：xxx(({...})); */
function jsonp(body) {
  const s = String(body || '');
  const i = s.indexOf('(');
  const j = s.lastIndexOf(')');
  if (i < 0 || j <= i) return null;
  // 台风网有两层括号：name(({...}))，两层都要剥掉
  let inner = s.slice(i + 1, j).trim();
  while (inner.startsWith('(')) inner = inner.slice(1).trim();
  while (inner.endsWith(')')) inner = inner.slice(0, -1).trim();
  try {
    return JSON.parse(inner);
  } catch {
    return null;
  }
}

function tvTime(str) {
  // "202610150600" → ISO（按 UTC+8 解析，台风网给的是北京时）
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(str || ''));
  if (!m) return '';
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5]);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function normPoint(a) {
  if (!Array.isArray(a) || a.length < 8) return null;
  const lng = Number(a[4]);
  const lat = Number(a[5]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    at: tvTime(a[1]),
    ms: Number(a[2]) || Date.parse(tvTime(a[1])) || 0,
    grade: String(a[3] || ''),
    lng,
    lat,
    pressure: Number(a[6]) || null,
    wind: Number(a[7]) || null,
    moveDir: String(a[8] || ''),
    moveSpeed: Number(a[9]) || null,
  };
}

function normForecast(obj) {
  const out = [];
  if (!obj || typeof obj !== 'object') return out;
  Object.keys(obj).forEach((agency) => {
    const arr = obj[agency];
    if (!Array.isArray(arr)) return;
    arr.forEach((f) => {
      if (!Array.isArray(f) || f.length < 6) return;
      const lng = Number(f[2]);
      const lat = Number(f[3]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      out.push({
        tau: Number(f[0]) || 0,
        at: tvTime(f[1]),
        lng,
        lat,
        pressure: Number(f[4]) || null,
        wind: Number(f[5]) || null,
        agency: String(f[6] || agency),
        grade: String(f[7] || ''),
      });
    });
  });
  out.sort((a, b) => a.tau - b.tau);
  return out;
}

/** 中央气象台：活动台风 + 实况/预报路径 */
async function loadTyphoons() {
  const listRes = await fetchText(
    'https://typhoon.nmc.cn/weatherservice/typhoon/jsons/list_default?callback=cb',
    9000,
  );
  if (!listRes.ok) return { ok: false, reason: 'list_http_' + listRes.status };
  const list = jsonp(listRes.body);
  const rows = list && Array.isArray(list.typhoonList) ? list.typhoonList : [];
  const active = rows
    .map((a) => ({
      id: a[0],
      nameEn: String(a[1] || ''),
      nameCn: String(a[2] || '').trim(),
      year: String(a[3] || ''),
      status: String(a[7] || ''),
    }))
    .filter((s) => s.status === 'start')
    .slice(0, 6);
  const dbg = { list: rows.length, active: active.length, viewFail: 0 };

  const storms = [];
  for (const s of active) {
    const v = await fetchText(
      'https://typhoon.nmc.cn/weatherservice/typhoon/jsons/view_' +
        encodeURIComponent(s.id) +
        '?callback=cb',
      12000,
    );
    if (!v.ok) {
      dbg.viewFail++;
      continue;
    }
    const d = jsonp(v.body);
    const t = d && Array.isArray(d.typhoon) ? d.typhoon : null;
    if (!t) {
      dbg.viewFail++;
      continue;
    }
    const pts = Array.isArray(t[8]) ? t[8].map(normPoint).filter(Boolean) : [];
    if (!pts.length) continue;
    // 官方预报块藏在**最后一个实况点**的第 11 项（对象，key=机构，value=[[时效,...]]）
    let fc = [];
    const rawPts = Array.isArray(t[8]) ? t[8] : [];
    const lastRaw = rawPts.length ? rawPts[rawPts.length - 1] : null;
    if (Array.isArray(lastRaw)) {
      for (let k = 8; k < lastRaw.length; k++) {
        const cand = lastRaw[k];
        if (cand && typeof cand === 'object' && !Array.isArray(cand)) {
          const got = normForecast(cand);
          if (got.length) {
            fc = got;
            break;
          }
        }
      }
    }
    storms.push({
      id: s.id,
      nameEn: s.nameEn,
      nameCn: s.nameCn || s.nameEn,
      year: s.year,
      points: pts,
      forecast: fc,
    });
  }
  return { ok: true, storms, at: Date.now(), dbg };
}

/**
 * 中国地震台网（CENC）地震目录。
 * 官方 news.ceic.ac.cn / www.ceic.ac.cn 的 ajax 接口已失效（空响应 / 302→HTML），
 * 这里用第三方镜像 api.wolfx.jp/cenc_eqlist.json：数据就是 CENC 的 review/automatic 记录，
 * 国内直连 1.1s 可拿约 50 条最近地震（含地点、震级、深度、烈度）。
 */
async function loadQuakes() {
  const r = await fetchText('https://api.wolfx.jp/cenc_eqlist.json', 9000, {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    Accept: 'application/json',
  });
  if (!r.ok) return { ok: false, reason: 'http_' + r.status };
  let d = null;
  try {
    d = JSON.parse(r.body);
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
  const rows = [];
  Object.keys(d || {}).forEach((k) => {
    const x = d[k];
    if (!x || typeof x !== 'object') return;
    const lat = Number(x.latitude);
    const lng = Number(x.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    // 台网给的是北京时间（"2026-10-19 18:57:08"），补 +08:00 再转 ISO
    const t = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(x.time || ''))
      ? Date.parse(String(x.time).replace(' ', 'T') + '+08:00')
      : NaN;
    rows.push({
      id: String(x.EventID || k),
      at: Number.isFinite(t) ? new Date(t).toISOString() : '',
      ms: Number.isFinite(t) ? t : 0,
      place: String(x.placeName || x.location || ''),
      magnitude: Number(x.magnitude) || null,
      depth: Number(x.depth) || null,
      intensity: Number(x.intensity) || null,
      type: String(x.type || ''),
      lat,
      lng,
    });
  });
  rows.sort((a, b) => b.ms - a.ms);
  return { ok: true, rows, at: Date.now() };
}

/**
 * 和风天气（QWeather）实况 + 气象预警。
 * 免费版必须在自定义 API Host 下调用（devapi.qweather.com 会 403 Invalid Host），
 * Host 存在 .env 的 QWEATHER_HOST。
 */
const weatherCache = new Map();
async function qweather(pathAndQuery, extra) {
  // 统一中文：和风默认按坐标所在国返回本地语言（巴西坐标会回葡语），面板要中文
  if (pathAndQuery.indexOf('lang=') < 0)
    pathAndQuery += (pathAndQuery.includes('?') ? '&' : '?') + 'lang=zh';
  const host = String(process.env.QWEATHER_HOST || '').trim();
  const key = String(process.env.QWEATHER_KEY || '').trim();
  if (!host || !key) return { ok: false, reason: 'no_key' };
  const sep = pathAndQuery.includes('?') ? '&' : '?';
  const r = await fetchText(
    'https://' + host + pathAndQuery + sep + 'key=' + encodeURIComponent(key),
    8000,
    {
      'User-Agent': 'gods-eye-view/0.1',
      'Accept-Encoding': 'gzip',
    },
  );
  if (!r.ok) return { ok: false, reason: 'http_' + r.status };
  try {
    return { ok: true, data: JSON.parse(r.body) };
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
}

/**
 * 行政区边界（高德 config/district，extensions=all 返回 polyline）
 * 注意：这个 key 的 adcode 参数无效（只回全国），必须用 keywords + 比对 adcode 筛。
 * 流程：腾讯逆地理拿到 市/区名 → 高德取市界(含子区列表) → 逐个取区界。
 */
const adminCache = new Map();
const ADMIN_TTL = 24 * 3600_000;

function amapKey2() {
  return String(process.env.AMAP_KEY || process.env.VITE_AMAP_KEY || '').trim();
}

async function amapDistrict(keywords, subdistrict) {
  const key = amapKey2();
  if (!key) return null;
  // 市一级要 subdistrict=1 才能带出子区列表；区县一级必须 0，否则高德不给 polyline
  const sub = subdistrict === undefined ? 1 : subdistrict;
  const url =
    'https://restapi.amap.com/v3/config/district?keywords=' +
    encodeURIComponent(keywords) +
    '&subdistrict=' +
    sub +
    '&extensions=all&key=' +
    encodeURIComponent(key);
  const r = await fetchText(url, 20000, { Accept: 'application/json' });
  if (!r.ok) return null;
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
}

/** 逆地理（腾讯）：拿城市 + 区县名 */
async function reverseNames(lat, lng) {
  const key = String(process.env.TENCENT_MAP_KEY || '').trim();
  if (!key) return null;
  const r = await fetchText(
    'https://apis.map.qq.com/ws/geocoder/v1/?location=' +
      lat +
      ',' +
      lng +
      '&get_poi=0&key=' +
      encodeURIComponent(key),
    6000,
    { Accept: 'application/json' },
  );
  if (!r.ok) return null;
  try {
    const d = JSON.parse(r.body);
    if (!d || Number(d.status) !== 0) return null;
    const c = (d.result && d.result.address_component) || {};
    return {
      city: c.city || c.province || '',
      district: c.district || '',
      province: c.province || '',
    };
  } catch {
    return null;
  }
}

/** 天地图行政区兜底：只给名称+中心点（天地图不返回边界多边形） */
async function tiandituAdminFallback(lat, lng) {
  const key = String(
    process.env.TIANDITU_SERVER_KEY || process.env.TIANDITU_KEY_OLD || '',
  ).trim();
  if (!key) return null;
  const names = await reverseNames(lat, lng);
  const city = (names && names.city) || '';
  if (!city) return null;
  const r = await fetchText(
    'https://api.tianditu.gov.cn/v2/administrative?keyword=' +
      encodeURIComponent(city) +
      '&childLevel=1&needPolygon=true&needPre=true&tk=' +
      encodeURIComponent(key),
    12000,
    { Accept: 'application/json' },
  );
  if (!r.ok) return null;
  let d = null;
  try {
    d = JSON.parse(r.body);
  } catch {
    return null;
  }
  const node =
    d && d.data && Array.isArray(d.data.district) ? d.data.district[0] : null;
  if (!node) return null;
  const children = Array.isArray(node.children) ? node.children : [];
  return {
    source: 'tianditu-admin',
    city,
    province: (names && names.province) || '',
    cityBoundary: {
      name: node.name,
      adcode: String(node.gb || ''),
      center: node.center ? node.center.lng + ',' + node.center.lat : '',
      polyline: '',
    },
    districts: children.map((c) => ({
      name: c.name,
      adcode: String(c.gb || ''),
      center: c.center ? c.center.lng + ',' + c.center.lat : '',
      polyline: '',
    })),
    note: '天地图兜底：只有区县名称与中心点，无边界线（天地图接口不返回多边形）',
  };
}

export function cnLiveProxy() {
  const trafficHandler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const raw = String(url.searchParams.get('bbox') || '')
      .split(',')
      .map(Number);
    if (raw.length !== 4 || raw.some((x) => !Number.isFinite(x))) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'bad_bbox' }));
      return;
    }
    const grid = Math.max(
      1,
      Math.min(5, Number(url.searchParams.get('grid')) || 3),
    );
    const key = raw.map((x) => x.toFixed(3)).join(',') + '|' + grid;

    const hit = trafficCache.get(key);
    if (hit && Date.now() - hit.at < TRAFFIC_TTL) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'max-age=120',
      });
      res.end(hit.body);
      return;
    }
    if (!amapKey()) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'no_key', available: false }));
      return;
    }

    const { cells, radius, grid: n } = await trafficGrid(raw, grid);
    const body = JSON.stringify({
      source: 'amap-traffic',
      at: Date.now(),
      bbox: raw,
      grid: n,
      radius,
      cells,
    });
    if (cells.length) {
      if (trafficCache.size > 60)
        trafficCache.delete(trafficCache.keys().next().value);
      trafficCache.set(key, { at: Date.now(), body });
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'max-age=120',
    });
    res.end(body);
  };

  const adminHandler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'bad_latlng' }));
      return;
    }
    const ck = lat.toFixed(2) + ',' + lng.toFixed(2);
    const hit = adminCache.get(ck);
    if (hit && Date.now() - hit.at < ADMIN_TTL) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(hit.body);
      return;
    }

    const names = await reverseNames(lat, lng);
    const cityName = names && names.city ? names.city : '';
    if (!cityName) {
      // 境外/海上取不到城市：安静返回空结果，别把首页刷成红色报错
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          source: 'amap-district',
          at: Date.now(),
          city: '',
          province: '',
          cityBoundary: { name: '', adcode: '', center: '', polyline: '' },
          districts: [],
          note: '该位置不在中国境内（或取不到行政区），本层无数据',
        }),
      );
      return;
    }

    const cityRes = await amapDistrict(cityName);
    const cityNode =
      (cityRes && Array.isArray(cityRes.districts) && cityRes.districts[0]) ||
      null;
    if (!cityNode) {
      // 高德额度用尽/挂了 → 天地图兜底（无边界，只有名称+中心点）
      const fb = await tiandituAdminFallback(lat, lng);
      if (fb) {
        const fbBody = JSON.stringify({ ...fb, at: Date.now() });
        if (adminCache.size > 40)
          adminCache.delete(adminCache.keys().next().value);
        adminCache.set(ck, { at: Date.now(), body: fbBody });
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(fbBody);
        return;
      }
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'no_district' }));
      return;
    }

    const children = Array.isArray(cityNode.districts)
      ? cityNode.districts.slice(0, 14)
      : [];
    const districts = [];
    // 高德个人 key 的行政区查询 QPS 很低，必须串行 + 小间隔，否则一半请求静默失败
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const fetchOne = async (ch) => {
      if (!ch || !ch.name) return null;
      const d = await amapDistrict(ch.name, 0);
      const arr = d && Array.isArray(d.districts) ? d.districts : [];
      const pick =
        arr.find((x) => String(x.adcode) === String(ch.adcode)) ||
        (arr.length === 1 ? arr[0] : null);
      if (!pick || !pick.polyline) return null;
      return {
        name: pick.name,
        adcode: String(pick.adcode || ch.adcode || ''),
        center: String(pick.center || ch.center || ''),
        polyline: pick.polyline,
      };
    };
    for (const ch of children) {
      const x = await fetchOne(ch);
      if (x) districts.push(x);
      await sleep(140);
    }
    // 第二轮补漏
    const got = new Set(districts.map((x) => x.adcode));
    for (const ch of children) {
      if (!ch || !ch.adcode || got.has(String(ch.adcode))) continue;
      const x = await fetchOne(ch);
      if (x) {
        districts.push(x);
        got.add(x.adcode);
      }
      await sleep(200);
    }

    const body = JSON.stringify({
      source: 'amap-district',
      at: Date.now(),
      city: cityName,
      province: (names && names.province) || '',
      cityBoundary: {
        name: cityNode.name,
        adcode: String(cityNode.adcode || ''),
        center: String(cityNode.center || ''),
        polyline: cityNode.polyline || '',
      },
      districts,
    });
    if (adminCache.size > 40) adminCache.delete(adminCache.keys().next().value);
    adminCache.set(ck, { at: Date.now(), body });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'max-age=3600',
    });
    res.end(body);
  };

  const weatherHandler = async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'bad_latlng' }));
      return;
    }
    const ck = lat.toFixed(2) + ',' + lng.toFixed(2);
    const hit = weatherCache.get(ck);
    if (hit && Date.now() - hit.at < 10 * 60_000) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(hit.body);
      return;
    }
    const loc = lng.toFixed(2) + ',' + lat.toFixed(2);
    const [now, warn, week] = await Promise.all([
      qweather('/v7/weather/now?location=' + encodeURIComponent(loc)),
      qweather(
        '/weatheralert/v1/current/' + lat.toFixed(2) + '/' + lng.toFixed(2),
      ),
      // 7 天预报：和风 /v7/weather/7d（免费额度够用；失败不影响实况）
      qweather('/v7/weather/7d?location=' + encodeURIComponent(loc)),
    ]);
    const n = now.ok && now.data && now.data.now ? now.data.now : null;
    const alerts =
      warn.ok && warn.data && Array.isArray(warn.data.alerts)
        ? warn.data.alerts
        : [];
    const body = JSON.stringify({
      source: 'qweather',
      at: Date.now(),
      ok: !!n,
      now: n
        ? {
            temp: Number(n.temp),
            text: n.text,
            icon: n.icon,
            windDir: n.windDir,
            windScale: n.windScale,
            windSpeed: Number(n.windSpeed),
            humidity: Number(n.humidity),
            precip: Number(n.precip),
            pressure: Number(n.pressure),
            vis: Number(n.vis),
            obsTime: n.obsTime,
          }
        : null,
      alerts: alerts.slice(0, 5).map((a) => ({
        id: a.id,
        title: a.title || a.headline,
        severity: a.severity,
        type:
          (a.eventType && (a.eventType.name || a.eventType)) ||
          (a.type && a.type.name) ||
          '',
        desc: String(a.description || '').slice(0, 200),
        sender: a.senderName,
        start: a.effectiveTime,
        end: a.expireTime,
      })),
      alertsCount: alerts.length,
      // 逐日预报（面板用）：date / 白天夜间天气 / 温度区间 / 风 / 降水 / 紫外线 / 日出日落
      daily: (week.ok && week.data && Array.isArray(week.data.daily)
        ? week.data.daily
        : []
      )
        .slice(0, 7)
        .map((d) => ({
          date: d.fxDate,
          textDay: d.textDay,
          textNight: d.textNight,
          iconDay: d.iconDay,
          iconNight: d.iconNight,
          tempMax: Number(d.tempMax),
          tempMin: Number(d.tempMin),
          windDirDay: d.windDirDay,
          windScaleDay: d.windScaleDay,
          precip: Number(d.precip),
          uvIndex: Number(d.uvIndex),
          humidity: Number(d.humidity),
          sunrise: d.sunrise,
          sunset: d.sunset,
        })),
      dailySource: week.ok
        ? 'qweather-7d'
        : 'unavailable:' + (week.reason || 'unknown'),
    });
    if (n) {
      if (weatherCache.size > 200)
        weatherCache.delete(weatherCache.keys().next().value);
      weatherCache.set(ck, { at: Date.now(), body });
    }
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'max-age=600',
    });
    res.end(body);
  };

  const typhoonHandler = async (req, res) => {
    if (typhoonCache && Date.now() - typhoonCache.at < TYPHOON_TTL) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'max-age=600',
      });
      res.end(typhoonCache.body);
      return;
    }
    const r = await loadTyphoons();
    if (!r.ok) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'upstream', reason: r.reason }));
      return;
    }
    const body = JSON.stringify({
      source: 'nmc-typhoon',
      at: r.at,
      storms: r.storms,
      dbg: r.dbg,
    });
    typhoonCache = { at: Date.now(), body };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'max-age=600',
    });
    res.end(body);
  };

  const quakeHandler = async (req, res) => {
    if (quakeCache && Date.now() - quakeCache.at < QUAKE_TTL) {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'max-age=300',
      });
      res.end(quakeCache.body);
      return;
    }
    const r = await loadQuakes();
    if (!r.ok) {
      // 上游挂了就继续用旧数据（有总比空图层强）
      if (quakeCache) {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'X-Gev-Stale': '1',
        });
        res.end(quakeCache.body);
        return;
      }
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'upstream', reason: r.reason }));
      return;
    }
    const body = JSON.stringify({ source: 'cenc', at: r.at, quakes: r.rows });
    quakeCache = { at: Date.now(), body };
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'max-age=300',
    });
    res.end(body);
  };

  return {
    name: 'cn-live',
    configureServer({ middlewares }) {
      middlewares.use('/api/cn/traffic', trafficHandler);
      middlewares.use('/api/cn/typhoon', typhoonHandler);
      middlewares.use('/api/cn/quakes', quakeHandler);
      middlewares.use('/api/cn/weather', weatherHandler);
      middlewares.use('/api/cn/admin', adminHandler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/cn/traffic', trafficHandler);
      middlewares.use('/api/cn/typhoon', typhoonHandler);
      middlewares.use('/api/cn/quakes', quakeHandler);
      middlewares.use('/api/cn/weather', weatherHandler);
      middlewares.use('/api/cn/admin', adminHandler);
    },
  };
}
