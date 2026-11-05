/**
 * 国内地名主通道（A6）：`GET /api/mini/geocode`。
 *
 * 只处理中文查询 —— 纯 ASCII / 英文查询直接 decline（`{place:null, answered:true}`），
 * 让 Google / Photon / Nominatim 走原链，避免把国内源当通用 geocoder 用。
 *
 * 契约（见 docs/小程序能力反向移植清单.md §1.1）：
 *   { query, source, crs, results[], channels[] }
 *   results[i] = { name, lat, lon, kind, addr?, source, crs }
 * 坐标系按能力清单 §4-2：仅当 `crs === 'gcj02'`（高德/腾讯）做 GCJ-02 → WGS-84；
 * Nominatim / Photon / 天地图本来即 WGS-84，原样透传。
 *
 * 本文件属于 portable 模块（src/search/** 被门禁按 portable 扫描）：
 * 不得 import `../layers/cnAdmin/model.js`（它顶部 import Cesium），
 * 也不得碰 window/document/localStorage —— 故这里内联纯数学转换。
 */

const GCJ02_A = 6378245.0;
const GCJ02_EE = 0.00669342162296594323;

function outOfChina(lng, lat) {
  return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55);
}

function transformLat(x, y) {
  let ret =
    -100.0 +
    2.0 * x +
    3.0 * y +
    0.2 * y * y +
    0.1 * x * y +
    0.2 * Math.sqrt(Math.abs(x));
  ret +=
    ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((160.0 * Math.sin((y / 12.0) * Math.PI) +
      320 * Math.sin((y * Math.PI) / 30.0)) *
      2.0) /
    3.0;
  return ret;
}

function transformLng(x, y) {
  let ret =
    300.0 +
    x +
    2.0 * y +
    0.1 * x * x +
    0.1 * x * y +
    0.1 * Math.sqrt(Math.abs(x));
  ret +=
    ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((150.0 * Math.sin((x / 12.0) * Math.PI) +
      300.0 * Math.sin((x / 30.0) * Math.PI)) *
      2.0) /
    3.0;
  return ret;
}

/** 单点 GCJ-02 → WGS-84；境外直接原值（与 layers/cnAdmin/model.js 同一组数）。 */
export function gcj02ToWgs84(lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [lng, lat];
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - GCJ02_EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat =
    (dLat * 180.0) /
    (((GCJ02_A * (1 - GCJ02_EE)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((GCJ02_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lng - dLng, lat - dLat];
}

const CJK_RE = /[\u4e00-\u9fa5]/;

/**
 * @param {{ fetchImpl?: Function, endpoint?: string }} [options]
 * @returns {{ geocode(query: string, opts?: { signal?: AbortSignal }): Promise<{ place: object|null, answered: boolean }> }}
 */
export function createCnGeocoder({
  fetchImpl = (...args) =>
    (globalThis.__gevResilientFetch || globalThis.fetch)(...args),
  endpoint = '/api/mini/geocode',
} = {}) {
  return {
    async geocode(query, { signal } = {}) {
      signal?.throwIfAborted();
      const text = String(query ?? '').trim();
      if (!text) return { place: null, answered: true };
      // 非中文查询不发请求：让既有 Google / Photon / Nominatim 处理。
      if (!CJK_RE.test(text)) return { place: null, answered: true };

      let response;
      try {
        const url =
          String(endpoint) +
          '?q=' +
          encodeURIComponent(text.slice(0, 120)) +
          '&limit=3';
        response = await fetchImpl(url, {
          signal,
          headers: { Accept: 'application/json' },
        });
      } catch {
        // 网络失败 / 超时 / 中止才是「没答上来」；中止照旧抛出。
        signal?.throwIfAborted();
        return { place: null, answered: false };
      }
      signal?.throwIfAborted();

      // 502 no_result 与 200 {results:[]} 都按「无结果」处理，不当作故障。
      if (!response || response.ok === false)
        return { place: null, answered: true };

      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      signal?.throwIfAborted();
      if (!body || typeof body !== 'object')
        return { place: null, answered: true };

      const rows = Array.isArray(body.results) ? body.results : [];
      const first = rows[0];
      if (!first || typeof first !== 'object')
        return { place: null, answered: true };

      const lat = Number(first.lat);
      let lng = Number(first.lon);
      if (!Number.isFinite(lng)) lng = Number(first.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng))
        return { place: null, answered: true };

      const crs = String(body.crs || first.crs || '').toLowerCase();
      let outLat = lat;
      let outLng = lng;
      if (crs === 'gcj02') {
        [outLng, outLat] = gcj02ToWgs84(lng, lat);
      }
      if (!Number.isFinite(outLat) || !Number.isFinite(outLng))
        return { place: null, answered: true };

      const name = String(first.name || '').trim();
      const label = String(first.addr || '').trim() || name;
      if (!name && !label) return { place: null, answered: true };
      const kind = String(first.kind || '').trim();

      return {
        place: {
          lat: outLat,
          lng: outLng,
          name: name || label,
          label: label || name,
          types: kind ? [kind] : [],
          viewport: null,
        },
        answered: true,
      };
    },
  };
}
