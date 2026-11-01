/**
 * src/bridge.js —— 显式模块总线（Phase8D · 问题清单 #15）
 *
 * 背景
 * ----
 * 卡壳层（`src/lc/*`，ESM）与边缘折射环（`public/gev-edge-lens.js`，classic script）之间
 * 原本靠 `window.__gevEdge` / `window.__gevEdgeLens` / `window.__lc*` 这些字符串全局通信：
 * 谁先加载、谁后加载、谁覆盖谁，就是一份**没有类型的隐式契约**。morph 在变形期关闭 lens
 * 就是这条契约的受害者（#3 的根因）。
 *
 * 现在
 * ----
 * 所有跨模块引用都走这里：显式 `register` / `get`，带 JSDoc 类型，可 `dispose`。
 * 唯一还写 `window.*` 的地方就是本文件里的 `EXPOSED` 白名单 —— 那是给**测试仪器**
 * （`scripts/lc/*.mjs`、`scripts/*.mjs`，共 5000+ 处 `window.__*` 断言）用的对外兼容面，
 * 不是应用内部通信通道。应用代码不许再直接读写 `window.__*`。
 *
 * classic script 怎么用（lens 是 classic，不能 import）
 * ------------------------------------------------
 * lens 在文档解析期就会执行，那时本模块（defer）还没求值。所以：
 *   1) 本模块求值时把总线挂到 `globalThis.__gevBridge`，并派发 `gev:bridge-ready`；
 *   2) classic script 若发现 `__gevBridge` 还不存在，就监听该事件，到时再 `register`。
 * 这样加载顺序不再是契约：谁先到谁先等。
 *
 * 约定
 * ----
 * - 名字用 `域.对象` 形式：`edge.lens` / `lc.api` / `app.panelApi`。
 * - `register` 同名重复注册会抛错（除了 `{ replace: true }`），避免静默覆盖。
 * - `dispose` 幂等；`disposeAll(owner)` 用于整块卸载（例如 lens 关闭时）。
 *
 * @typedef {Object} RegisterOptions
 * @property {string} [owner]      所有者标识（文件路径），便于 disposeAll 与排障
 * @property {string} [global]     对外兼容的 window 属性名（**只能出现在 EXPOSED 白名单里**）
 * @property {boolean} [replace]   允许覆盖已有注册
 */

/** @type {Map<string, {value: any, owner: string, global?: string}>} */
const SLOTS = new Map();
/** window 兼容面白名单：唯一允许被测试仪器直接读到的全局名。 */
const EXPOSED = new Set([
  '__lc', // 卡壳层诊断（scripts/lc/*.mjs 大量断言）
  '__lcBooted', // 启动幂等标记
  '__lcPanelApi', // App 侧折叠 API（src/ui/panelChrome.js 生产，src/lc/app-adapter.js 消费）
  '__lcExternalDisclosure', // index.html 注入的「披露归 src/lc 管」清单
  '__gevBoot', // 启动就绪门（index.html/startupChrome 读）
  '__gevGpu', // GPU 分级（public/*.js 普通脚本读）
  '__gevEdge', // lens 主 API（stats/cfg/eff/a11y/look 被多个 gate 读）
  '__gevEdgeLens', // lens 启动态（mode/loading）
  '__gevEdgeGrab', // 验收取样请求（gate → lens）
  '__gevEdgeGrabOut', // 验收取样结果（lens → gate）
]);
const READY_EVENT = 'gev:bridge-ready';
const VERSION = '8d.1';

/** @param {string} name */
function assertName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z][\w.]*$/.test(name)) {
    throw new TypeError(
      `bridge: 非法名字 ${String(name)}（要求 域.对象，如 edge.lens）`,
    );
  }
}

/**
 * 注册一个模块引用。
 * @template T
 * @param {string} name
 * @param {T} value
 * @param {RegisterOptions} [options]
 * @returns {T}
 */
export function register(name, value, options = {}) {
  assertName(name);
  if (value === undefined)
    throw new TypeError(`bridge: ${name} 不能注册 undefined`);
  const existing = SLOTS.get(name);
  if (existing && !options.replace) {
    throw new Error(
      `bridge: ${name} 已被 ${existing.owner || '未知'} 注册（如需覆盖请 replace:true）`,
    );
  }
  if (options.global && !EXPOSED.has(options.global)) {
    throw new Error(
      `bridge: ${options.global} 不在 window 兼容面白名单里（见 EXPOSED）`,
    );
  }
  SLOTS.set(name, {
    value,
    owner: options.owner || '',
    global: options.global,
  });
  if (options.global) expose(options.global, name);
  return value;
}

/**
 * 取一个模块引用（未注册返回 fallback；调用方要区分「还没到」与「不存在」时用 has）。
 * @template T
 * @param {string} name
 * @param {T} [fallback]
 * @returns {T | undefined}
 */
export function get(name, fallback) {
  const slot = SLOTS.get(name);
  return slot ? /** @type {T} */ (slot.value) : fallback;
}

/** @param {string} name */
export function has(name) {
  return SLOTS.has(name);
}

/**
 * 取一个对象型槽位，不存在就建。
 * - `adopt`（默认开）：若 `window[global]` 已被更早执行的 classic script 写成了对象，
 *   就**采用**它，而不是新建一个空对象丢掉对方的数据 —— 这是加载顺序不再成为契约的关键。
 * @param {string} name
 * @param {RegisterOptions & {initial?: any, adopt?: boolean}} [options]
 */
export function ensure(name, options = {}) {
  if (SLOTS.has(name)) return SLOTS.get(name).value;
  const adopt = options.adopt !== false;
  if (
    adopt &&
    options.global &&
    typeof window !== 'undefined' &&
    window[options.global]
  ) {
    return register(name, window[options.global], options);
  }
  return register(name, options.initial ?? {}, options);
}

/**
 * 往对象型槽位写一个属性：`set('lc.result', x)` → `get('lc').result = x`。
 * 只用于诊断/只读视图；真正的模块边界请用 register/get 传整对象。
 * @param {string} path
 * @param {any} value
 */
export function set(path, value) {
  const dot = path.lastIndexOf('.');
  if (dot < 0) throw new TypeError(`bridge.set: ${path} 需要 域.对象 形式`);
  const ns = path.slice(0, dot);
  const key = path.slice(dot + 1);
  const target = SLOTS.get(ns);
  if (!target) throw new Error(`bridge.set: 命名空间 ${ns} 未注册`);
  target.value[key] = value;
  return value;
}

/**
 * 注销一个引用（幂等）。
 * @param {string} name
 */
export function dispose(name) {
  const slot = SLOTS.get(name);
  if (!slot) return false;
  SLOTS.delete(name);
  if (slot.global) {
    /* 兼容面保留 getter，但读到 undefined —— 测试仪器能看出「已卸载」而不是拿到旧引用 */
    expose(slot.global, name, true);
  }
  return true;
}

/**
 * 按 owner 整块卸载（例如 lens 关闭时把 edge.* 全部撤掉）。
 * @param {string} owner
 */
export function disposeAll(owner) {
  let n = 0;
  for (const [name, slot] of [...SLOTS.entries()]) {
    if (slot.owner === owner) {
      dispose(name);
      n += 1;
    }
  }
  return n;
}

/** 只读清单（排障用，不返回函数引用）。 */
export function list() {
  return [...SLOTS.entries()].map(([name, s]) => ({
    name,
    owner: s.owner,
    global: s.global || null,
    type: typeof s.value,
  }));
}

/** 总线自身版本（gate 可断言「总线就位」）。 */
export function version() {
  return VERSION;
}

/**
 * 建立 window 兼容面：getter/setter 直连槽位，读到的永远是当前注册值。
 * @param {string} globalName
 * @param {string} name
 * @param {boolean} [detached] 已卸载时置 true：getter 返回 undefined，setter 重新注册
 */
function expose(globalName, name, detached = false) {
  if (typeof window === 'undefined') return;
  if (detached) {
    Object.defineProperty(window, globalName, {
      configurable: true,
      enumerable: true,
      get: () => undefined,
      set: (v) => {
        register(name, v, { replace: true, global: globalName });
      },
    });
    return;
  }
  Object.defineProperty(window, globalName, {
    configurable: true,
    enumerable: true,
    get: () => get(name),
    /* gate 脚本会直接赋值（例如 window.__gevEdgeGrab = {…}），赋值同样落到槽位 */
    set: (v) => {
      const slot = SLOTS.get(name);
      if (slot) slot.value = v;
    },
  });
}

/* classic script（public/gev-edge-lens.js）用的单例出口 + 就绪事件。
   注意：这是**唯一**一个非 `window.__` 的全局，且只出现在这里。 */
const api = {
  version,
  register,
  get,
  has,
  ensure,
  set,
  dispose,
  disposeAll,
  list,
  exposed: [...EXPOSED],
  READY_EVENT,
};
if (typeof globalThis !== 'undefined') {
  globalThis.__gevBridge = api;
  if (
    typeof window !== 'undefined' &&
    typeof window.dispatchEvent === 'function'
  ) {
    try {
      window.dispatchEvent(new Event(READY_EVENT));
    } catch (_) {
      /* 老环境忽略 */
    }
  }
}

export default api;
