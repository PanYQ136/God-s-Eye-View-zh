import { normalizeCnAdminSnapshot } from './records.js';

const API_PATH = '/api/cn/admin';

/**
 * 行政区边界源：`/api/cn/admin?lat=&lng=` 返回高德 GCJ-02 边界，由 layer 做坐标转换。
 * 注入式 fetch —— portable 层。
 *
 * 空/失败按「无数据」处理：境外 200 但空 polyline；高德+天地图兜底失败 → 502 no_district。
 */
export function createCnAdminSource({
  fetchImpl = (...args) =>
    (globalThis.__gevResilientFetch || globalThis.fetch)(...args),
} = {}) {
  return {
    async getSnapshot({ signal, lat, lng } = {}) {
      signal?.throwIfAborted();
      if (
        !Number.isFinite(Number(lat)) ||
        !Number.isFinite(Number(lng))
      ) {
        throw new TypeError('cnAdmin requires finite lat/lng');
      }
      const params = new URLSearchParams({
        lat: String(lat),
        lng: String(lng),
      });
      const response = await fetchImpl(`${API_PATH}?${params.toString()}`, {
        signal,
      });
      if (!response.ok) {
        if (response.status === 502) return null; // 兜底失败：无数据
        throw new Error(`cnAdmin HTTP ${response.status}`);
      }
      const payload = await response.json();
      signal?.throwIfAborted();
      const normalized = normalizeCnAdminSnapshot(payload);
      if (!normalized) throw new Error('Malformed cnAdmin response');
      // 境外 / 无边界：返回空结构，按「无数据」渲染。
      if (!normalized.cityBoundary && normalized.districts.length === 0)
        return null;
      return normalized;
    },
  };
}
