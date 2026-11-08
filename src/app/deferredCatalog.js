/**
 * Phase8E2（t_1ad4e981）：波次 2 图层工厂的首帧后水合调度。
 *
 * ⚠️ 当前状态：**D3 已测量否决接线（won't-do，非未完成态）**，代码与单测保留
 *   作为契约演进后的可用件，不进入启动序列。
 *
 *   否决依据（2026-11-08 核实，可复现）：
 *   1. `catalogControlServices()` 逐条 `catalog.get(id)` 绑定 14 个 control 角色，
 *      缺任一即抛错；其中 12 个（traffic / satellites / cctv / street-level /
 *      radio / bikeshare / transit / ais-live-vessels / military-awareness /
 *      military-installations / rocket-launches / alpr）的工厂全部由
 *      `catalogFactoriesRest.js` 导出——也就是「波次 2」。惰性集因此只剩
 *      air-quality / osm-places / gnss / ghost-maps / drone-airspace / osm-overlays
 *      等轻量层，可延后的 gzip 远小于 rest 波的 301 kB。
 *   2. `createApplicationData()` 在构造期即遍历 `catalog.layers` 全量 `register()`
 *      并 `finalizeRegistrations(catalog.metadata)`；41 条 metadata 与实例一一对应
 *      是 catalog.js 的硬校验，部分层集会直接改坏图层注册/序列化的既有语义。
 *   3. 波次 2 的 chunk 已在 `preloadCatalogFactories()`（D2）中提前到 load 前后
 *      并行下载，剩余可优化项仅是「模块求值」的 CPU，量级为毫秒。
 *   → 结论：收益上限（≤301 kB gzip 的部分）远低于「catalog 契约 + 图层注册 +
 *     controls/panels 缺失层兜底」的回归风险。真正该做的是 D2 已完成的**提前
 *     预取**，而非首帧后再拉。
 *
 *   若将来 control 契约改为「惰性 provider」或 control 角色集缩减，可重启本文件：
 *   前置条件为 catalog partial 支持 + data.js 增量注册 + 缺失层 UI 兜底 + hydrate A/B。
 *
 * 默认口径（可观测、可回滚）：
 *   1. 调用方在 `application.start()` 兑现之后调用本函数（此时应用已就绪、
 *      首帧早已绘制：FCP ≈ 1.7 s，ready ≈ 5 s）；
 *   2. 等到下一次 `requestAnimationFrame`（保证首帧之后），
 *      再等 `requestIdleCallback`（空闲才开始拉 chunk，避免抢关键路径带宽）；
 *   3. `catalog.hydrate()` 拉波次 2 chunk → 构造 → 逐个后置注册。
 *
 * 为什么不是「首帧一到就拉」：`app:ready` 之前的空闲窗口属于 Viewer 构造与
 * 瓦片阶梯，779 kB 的 chunk 会与首屏关键资源抢带宽；ready 之后到遮罩收起之间
 * 的等待期（瓦片 settle）才是真正可以牺牲的窗口——此时水合既不推迟首帧，也不
 * 推迟交互，还能在遮罩收起前把图层全部补齐（视觉/行为与一次性构造一致）。
 *
 * 逃生口：`?layerdefer=0` 关闭后置注册（走 Phase8E 的一次性构造），用于 A/B。
 * 观测：`window.__gevCatalogHydration` 暴露各阶段时间戳，`__bootTimeline` 打点
 *       `catalog:hydrate:*`。
 */
import * as timeline from '../boot-timeline.js';

const IDLE_TIMEOUT_MS = 2000;

const defaultFrame = (fn) =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(fn)
    : setTimeout(fn, 0);

const defaultIdle = (fn) =>
  typeof requestIdleCallback === 'function'
    ? requestIdleCallback(fn, { timeout: IDLE_TIMEOUT_MS })
    : setTimeout(fn, 0);

/**
 * @param {{hydrate?:Function, pendingLayerIds?:string[]}} catalog Catalog built by
 *   `createApplicationCatalog({ deferRest: true })`.
 * @param {object} [options]
 * @param {boolean} [options.disabled] Skip hydration entirely (A/B + rollback).
 * @param {Function} [options.requestFrame] Injectable frame scheduler.
 * @param {Function} [options.requestIdle] Injectable idle scheduler.
 * @returns {Promise<object>} Resolves with the observable state record.
 */
export function scheduleCatalogHydration(
  catalog,
  {
    disabled = false,
    requestFrame = defaultFrame,
    requestIdle = defaultIdle,
  } = {},
) {
  const state = {
    supported: typeof catalog?.hydrate === 'function',
    scheduled: false,
    reason: '',
    pendingBefore: Array.isArray(catalog?.pendingLayerIds)
      ? catalog.pendingLayerIds.length
      : 0,
    pendingAfter: null,
    frameAt: null,
    idleAt: null,
    startAt: null,
    doneAt: null,
    ok: null,
    error: null,
  };
  try {
    globalThis.__gevCatalogHydration = state;
  } catch {
    /* observation only */
  }
  if (!state.supported) {
    state.reason = 'eager-catalog';
    return Promise.resolve(state);
  }
  if (disabled) {
    state.reason = 'disabled';
    return Promise.resolve(state);
  }
  if (state.pendingBefore === 0) {
    state.reason = 'nothing-pending';
    return Promise.resolve(state);
  }
  state.scheduled = true;
  state.reason = 'scheduled';
  timeline.mark('catalog:hydrate:scheduled', { pending: state.pendingBefore });
  return new Promise((resolve) => {
    requestFrame(() => {
      state.frameAt = Math.round(performance.now());
      timeline.mark('catalog:hydrate:frame');
      requestIdle(() => {
        state.idleAt = Math.round(performance.now());
        timeline.mark('catalog:hydrate:idle');
        state.startAt = state.idleAt;
        catalog
          .hydrate()
          .then((result) => {
            state.ok = true;
            state.doneAt = Math.round(performance.now());
            state.pendingAfter = Array.isArray(result?.pendingLayerIds)
              ? result.pendingLayerIds.length
              : 0;
            timeline.mark('catalog:hydrate:done', {
              pending: state.pendingAfter,
            });
            resolve(state);
          })
          .catch((error) => {
            state.ok = false;
            state.doneAt = Math.round(performance.now());
            state.error = String(error?.message || error);
            timeline.mark('catalog:hydrate:failed', { error: state.error });
            // Deferred layers are an optimisation: a failed chunk must not take
            // the already-interactive application down with it.
            console.error('[catalog] deferred layer hydration failed:', error);
            resolve(state);
          });
      });
    });
  });
}
