import { normalizeCnTrafficSnapshot } from './records.js';

const API_PATH = '/api/cn/traffic';

/**
 * 国内实时路况源：按当前视口 bbox 网格采样（grid 固定 2，避免 N² 次高德请求打爆配额）。
 * 注入式 fetch —— 不碰浏览器全局、不 import Cesium / renderer（portable 层）。
 *
 * 空/失败一律按「无数据」处理：503 no_key（无高德 key）返回 []；其余非 2xx 抛错由层吞掉。
 */
export function createCnTrafficSource({
  fetchImpl = (...args) =>
    (globalThis.__gevResilientFetch || globalThis.fetch)(...args),
} = {}) {
  return {
    async getSnapshot({ signal, bbox, grid = 2 } = {}) {
      signal?.throwIfAborted();
      if (
        !Array.isArray(bbox) ||
        bbox.length !== 4 ||
        bbox.some((n) => !Number.isFinite(n))
      ) {
        throw new TypeError(
          'cnTraffic requires a finite [minLng,minLat,maxLng,maxLat] bbox',
        );
      }
      const params = new URLSearchParams({
        bbox: bbox.join(','),
        grid: String(grid),
      });
      const response = await fetchImpl(`${API_PATH}?${params.toString()}`, {
        signal,
      });
      // 无高德 key：服务可用但无数据，按「无数据」处理，不进 error 日志。
      if (response.status === 503) return [];
      if (!response.ok) throw new Error(`cnTraffic HTTP ${response.status}`);
      const payload = await response.json();
      signal?.throwIfAborted();
      const rows = normalizeCnTrafficSnapshot(payload);
      if (!rows) throw new Error('Malformed cnTraffic response');
      return rows;
    },
  };
}
