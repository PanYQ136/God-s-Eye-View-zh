import { Cesium } from '../../cesium.js';
import { normalizeCnAdminSnapshot } from './records.js';

/**
 * GCJ-02 → WGS-84 逆向偏移（高德/腾讯坐标系转 WGS-84）。
 * 仅对确认是 GCJ-02 的坐标调用；WGS-84 与境外坐标直接透传（见 §4-2）。
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
    ((20.0 * Math.sin(6.0 * x * Math.PI) +
      20.0 * Math.sin(2.0 * x * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(y * Math.PI) +
      40.0 * Math.sin((y / 3.0) * Math.PI)) *
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
    ((20.0 * Math.sin(6.0 * x * Math.PI) +
      20.0 * Math.sin(2.0 * x * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((20.0 * Math.sin(x * Math.PI) +
      40.0 * Math.sin((x / 3.0) * Math.PI)) *
      2.0) /
    3.0;
  ret +=
    ((150.0 * Math.sin((x / 12.0) * Math.PI) +
      300.0 * Math.sin((x / 30.0) * Math.PI)) *
      2.0) /
    3.0;
  return ret;
}

/** 单点 GCJ-02 → WGS-84；境外直接返回原值。 */
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
  dLng =
    (dLng * 180.0) /
    ((GCJ02_A / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lng - dLng, lat - dLat];
}

/**
 * 解析高德 polyline：`lng,lat;lng,lat|...`（竖线分段、分号分点、逗号分经纬）。
 * 逐点 GCJ02→WGS84；不足 3 点的段丢弃。
 * @returns {Array<Array<[number,number]>>} 环数组（WGS-84）。
 */
export function parseAmapPolyline(str) {
  if (typeof str !== 'string' || !str) return [];
  return str
    .split('|')
    .map((seg) =>
      seg
        .split(';')
        .map((pt) => {
          const [lng, lat] = pt.split(',').map(Number);
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
          return gcj02ToWgs84(lng, lat);
        })
        .filter((p) => p !== null),
    )
    .filter((ring) => ring.length >= 3);
}

export { normalizeCnAdminSnapshot };
