import { normalizeCnTyphoonSnapshot } from './records.js';

const API_PATH = '/api/cn/typhoon';

/**
 * 中央气象台台风源：`/api/cn/typhoon`（nmc.cn 实况路径 + BABJ 官方预报点）。
 * 注入式 fetch —— portable 层。`storms:[]` 是正常态（当前无活动台风），返回 []。
 * 502 upstream 也按「无数据」处理。
 */
export function createCnTyphoonSource({
  fetchImpl = (...args) =>
    (globalThis.__gevResilientFetch || globalThis.fetch)(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      const response = await fetchImpl(API_PATH, { signal });
      if (response.status === 502 || response.status === 503) return [];
      if (!response.ok) throw new Error(`cnTyphoon HTTP ${response.status}`);
      const payload = await response.json();
      signal?.throwIfAborted();
      const storms = normalizeCnTyphoonSnapshot(payload);
      if (!storms) throw new Error('Malformed cnTyphoon response');
      return storms;
    },
  };
}
