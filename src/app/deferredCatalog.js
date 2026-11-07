/**
 * Phase8E2（t_1ad4e981）：波次 2 图层工厂的首帧后水合调度。
 *
 * ⚠️ 当前状态：未接线（未完成态，仅自身单测覆盖）。本文件的消费方
 *   `catalog.hydrate()` 需要 catalog 契约支持「部分层 + 惰性 control getter」，
 *   而 `catalog.js` 现在要求 metadata 与 41 层 control 严格一一对应，UI 在构造阶段
 *   即读取波次 2 实例的行/控件，因此直接接线会让 catalog 变成不完整层集。
 *   2026-11-08 实测（dist-d2，冷启动）：波次 2 chunk 已在 load（2593 ms）之后的
 *   6768 ms 才发起，rest 仅 301 kB gzip，占首屏 wire 不足 8%——完整惰性的增量收益
 *   小于契约改造的回归风险，故本调度保持待接线，留待独立立项（D3）。
 *   接线前置：catalog.js partial 支持 + controls/panels 的缺失层兜底 + hydrate A/B。
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
