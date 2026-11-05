import { normalizeCnQuakesSnapshot } from './records.js';

const API_PATH = '/api/cn/quakes';

/**
 * 中国地震台网源：`/api/cn/quakes`（CENC，经 wolfx.jp 镜像）。
 * 注入式 fetch —— portable 层。空/失败按「无数据」处理：502 upstream 返回 []。
 */
export function createCnQuakesSource({
  fetchImpl = (...args) =>
    (globalThis.__gevResilientFetch || globalThis.fetch)(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(API_PATH, { signal });
      if (response.status === 502 || response.status === 503) return [];
      if (!response.ok) throw new Error(`cnQuakes HTTP ${response.status}`);
      const payload = await response.json();
      signal?.throwIfAborted();
      const rows = normalizeCnQuakesSnapshot(payload);
      if (!rows) throw new Error('Malformed cnQuakes response');
      return rows;
    },
  };
}
