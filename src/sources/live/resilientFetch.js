/**
 * 通用弹性取数：超时 + 重试 + 退避。
 *
 * 目标（用户要求）：主源超时/失败/异常时自动重试恢复，无感知、不阻塞渲染。
 * 设计要点：
 * - 每次尝试独立 AbortController 超时，避免请求悬挂拖住轮询。
 * - 外部 signal 透传：外部取消则立即停止（不吞掉取消）。
 * - 429 / 5xx / 网络错误 → 指数退避重试；仍失败则把最后一次响应/错误抛给调用方
 *   （调用方原有 ok 判定/降级逻辑不变，行为可预期）。
 * - 纯 fetch 兼容签名（input, init）→ Response，可无缝作为 fetchImpl 注入。
 */
export function makeResilientFetch({
  attempts = 2,
  timeoutMs = 15000,
  retryDelayMs = 700,
} = {}) {
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  return async function resilientFetch(input, init = {}) {
    const external = init.signal;
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      if (external && external.aborted)
        throw new DOMException('Aborted', 'AbortError');
      const ctrl = new AbortController();
      const onAbort = () => {
        try {
          ctrl.abort();
        } catch {
          /* ignore */
        }
      };
      if (external)
        external.addEventListener?.('abort', onAbort, { once: true });
      const timer = setTimeout(() => {
        try {
          ctrl.abort();
        } catch {
          /* ignore */
        }
      }, timeoutMs);
      try {
        const res = await fetch(input, { ...init, signal: ctrl.signal });
        clearTimeout(timer);
        external?.removeEventListener?.('abort', onAbort);
        // 可重试的服务端错误：429 / 5xx
        if ((res.status === 429 || res.status >= 500) && i < attempts - 1) {
          await delay(retryDelayMs * (i + 1));
          continue;
        }
        return res;
      } catch (err) {
        clearTimeout(timer);
        external?.removeEventListener?.('abort', onAbort);
        lastErr = err;
        if (external && external.aborted) throw err; // 外部取消，不重试
        if (i < attempts - 1) {
          await delay(retryDelayMs * (i + 1));
          continue;
        }
        throw err;
      }
    }
    throw lastErr || new Error('resilientFetch exhausted');
  };
}

// 全局注册一次：各图层 source 的默认 fetchImpl 用
// `(globalThis.__gevResilientFetch || globalThis.fetch)` 即可自动获得超时+重试，
// 无需逐文件改 import（未加载到本模块时优雅回退原生 fetch）。
if (typeof globalThis !== 'undefined' && !globalThis.__gevResilientFetch) {
  globalThis.__gevResilientFetch = makeResilientFetch();
}
