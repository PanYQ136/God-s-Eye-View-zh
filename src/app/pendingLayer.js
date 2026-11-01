/**
 * Stable handle for a layer whose factory chunk has not been requested yet.
 *
 * Phase8E2（t_1ad4e981）：波次 2 的图层实例在首帧之后才构造，但控制面板
 * （StyleManager 及其子控制器）在启动期就会捕获这些实例的引用。为了让
 * 「捕获引用」与「实例后置注册」共存，这里给出一个身份稳定的句柄：
 *
 *   · 实例未就绪时：只回答 `id` / `__pendingLayer`，`subscribe(cb)` 入队等待，
 *     其余属性一律返回 `undefined`（调用方必须能容忍「空图层」——启动期唯一
 *     实际会读的是订阅与 detectable 查询，两者在空图层下都是合法的空集）。
 *   · 实例就绪后（`materialize(layer)`）：全部属性转发到真实图层，
 *     已入队的订阅者在 next microtask 里按顺序补齐订阅。
 *
 * 代价与边界：句柄不会伪造方法，所以「就绪前调用方法」会立刻抛错而不是
 * 静默返回假值——这是刻意的：宁可启动期炸掉并暴露，也不要让 UI 端着一份
 * 看起来正常但实际空的图层活到收尾。所有就绪前的属性访问都会记进
 * `globalThis.__gevPendingLayerAccesses`，验收脚本据此断言启动期访问面。
 */

const MAX_RECORDED_ACCESSES = 200;
const warnOnce = new Set();

function recordAccess(id, prop) {
  try {
    const log =
      globalThis.__gevPendingLayerAccesses ||
      (globalThis.__gevPendingLayerAccesses = []);
    if (log.length >= MAX_RECORDED_ACCESSES) return;
    log.push({ id, prop, t: Math.round(performance.now()) });
  } catch {
    /* observation only */
  }
  try {
    if (import.meta.env?.DEV && !warnOnce.has(`${id}:${prop}`)) {
      warnOnce.add(`${id}:${prop}`);
      console.warn(
        `[catalog] ${id}.${prop} read before the layer was registered (pending handle)`,
      );
    }
  } catch {
    /* import.meta.env is absent in node */
  }
}

/**
 * @param {string} id Layer id this handle stands for.
 * @param {() => object|undefined} read Reads the materialized layer, if any.
 */
export function createPendingLayerHandle(id, read) {
  const queuedSubscribers = [];
  let materialized = null;

  const current = () => materialized || read();

  const forwarded = (prop) => {
    const target = current();
    if (!target) return { ready: false };
    const value = target[prop];
    // Layer APIs are closure-built plain methods; binding to the real instance
    // keeps `this` semantics identical to a direct call.
    return {
      ready: true,
      value: typeof value === 'function' ? value.bind(target) : value,
    };
  };

  const handle = {
    /** True until the real layer instance exists. */
    get pending() {
      return !current();
    },
    id,
    materialize(layer) {
      if (materialized) return false;
      materialized = layer;
      const backlog = queuedSubscribers.splice(0);
      // Deliver the backlog on a microtask: the registration path is still
      // inside `dataManager.registerDeferred()` when the layer arrives, and
      // subscribers must never observe a half-registered manager.
      queueMicrotask(() => {
        for (const entry of backlog) {
          if (entry.unsubscribed) continue;
          try {
            const unsubscribe = layer.subscribe?.(entry.callback);
            entry.release =
              typeof unsubscribe === 'function' ? unsubscribe : null;
          } catch (error) {
            console.warn(`[catalog] ${id} deferred subscribe failed:`, error);
          }
        }
      });
      return true;
    },
  };

  const proxy = new Proxy(handle, {
    get(target, prop) {
      if (prop === 'then') return undefined; // never look like a promise
      if (prop === 'pending' || prop === 'materialize' || prop === 'id')
        return Reflect.get(target, prop);
      if (typeof prop === 'symbol') return undefined;
      const hit = forwarded(prop);
      if (hit.ready) return hit.value;
      if (prop === 'subscribe') {
        return (callback) => {
          if (typeof callback !== 'function') return () => {};
          const entry = { callback, release: null, unsubscribed: false };
          queuedSubscribers.push(entry);
          return () => {
            entry.unsubscribed = true;
            entry.release?.();
            entry.release = null;
            const index = queuedSubscribers.indexOf(entry);
            if (index >= 0) queuedSubscribers.splice(index, 1);
          };
        };
      }
      recordAccess(id, String(prop));
      return undefined;
    },
    has(target, prop) {
      const hit = forwarded(prop);
      return hit.ready ? prop in (current() ?? {}) : false;
    },
    set(target, prop, value) {
      const layer = current();
      if (!layer) {
        recordAccess(id, `${String(prop)}=`);
        return false;
      }
      layer[prop] = value;
      return true;
    },
  });

  return proxy;
}
