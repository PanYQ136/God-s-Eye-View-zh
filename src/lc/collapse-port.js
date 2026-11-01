/* ============================================================================
   src/lc/collapse-port.js —— L1 CollapsePort（唯一 `.collapsed` 写入者）
   ----------------------------------------------------------------------------
   架构 §3.2 L1 / §7.1：
     write(id,{collapsed,reason}) → App `panelChrome.setPanelCollapsed(...)`
        · 一律 {explicit:false, persist:false, syncShare:false} —— App 继续拥有
          披露/持久化/share 的实现，Hermes 只拥有几何。
     read/subscribe：App 侧任何写入（披露按钮 / 悬停 / 轨道自适应 / 启动恢复 /
       业务模块开面板）都回流成 controller 的一次 reconcile。
   本模块**不允许**自己 classList.add('collapsed')（只走 App API）。
   ========================================================================== */

/** 语音卡（#gev-voice-control）不进披露体系：它的 mini 形态就是 dock 行里的那张卡。 */
const DEFAULT_PORT_IDS = [
  'data-panel',
  'scene-panel',
  'pp-toggles',
  'cctv-panel',
  'global-context-panel',
  'location-bar',
  'control-panel',
];

export function createCollapsePort({
  adapter,
  ids = DEFAULT_PORT_IDS,
  onExternalChange = () => {},
  clock = () => performance.now(),
} = {}) {
  const desired = new Map();
  const suppress = new Map();
  let observers = [];
  const stats = {
    writes: 0,
    appWrites: 0,
    suppressed: 0,
    direct: 0,
    preboot: 0,
    reconciled: 0,
    failures: 0,
  };

  function current(id) {
    return adapter.isCollapsed(id);
  }

  /* Phase7A3：App API 是否在位。测试注入的假 adapter 没有该方法 → 视为在位
     （等价旧行为：一律走 App 路径、options 原样透传）。 */
  const appApiReady = () =>
    typeof adapter.hasPanelApi === 'function' ? adapter.hasPanelApi() : true;

  /**
   * 唯一写入口。
   * @returns {{ok:boolean, changed:boolean, path:'noop'|'app'|'direct', value:boolean}}
   */
  function write(id, collapsed, reason = '') {
    const want = !!collapsed;
    const cur = current(id);
    if (cur === want) {
      desired.set(id, want);
      return { ok: true, changed: false, path: 'noop', value: want };
    }
    /* 自己写入的 200ms 内不把它当「外部写入」回流（App 的写入可能异步到下一帧） */
    suppress.set(id, clock() + 200);
    /* Phase7A3：App 还没起来（LC 先于 Cesium mount）→ 走 preboot 记账，不算 direct。
       App API 在位时必须**原样**传三个 options（TC-M9 断言 exact options），
       所以 preboot 只在真的需要时附加。 */
    const preboot = !appApiReady();
    const writeOpts = { explicit: false, persist: false, syncShare: false };
    if (preboot) writeOpts.preboot = true;
    const path = adapter.setPanelCollapsed(id, want, writeOpts);
    desired.set(id, want);
    stats.writes += 1;
    if (path === 'preboot') stats.preboot += 1;
    else if (path === 'direct') stats.direct += 1;
    const ok = current(id) === want;
    if (!ok) stats.failures += 1;
    return { ok, changed: true, path, value: want, reason };
  }

  /** App 起来（`window.__lcPanelApi` 就位）后的状态回灌：
      把 DOM 现状按 desired 一次性写回 App，之后所有写入都走 App API。
      preboot 期由本 port 直写的 class 不再算「第二写入者」（App 从这一刻接管）。 */
  function reconcile() {
    if (!appApiReady()) return false;
    let n = 0;
    for (const id of ids) {
      const cur = current(id);
      const want = desired.has(id) ? desired.get(id) : cur;
      suppress.set(id, clock() + 200);
      adapter.setPanelCollapsed(id, want, {
        explicit: false,
        persist: false,
        syncShare: false,
      });
      n += 1;
    }
    stats.reconciled = n;
    return true;
  }

  /** 把 7 张卡强制成同一个相位（boot：全 mini；D1）。 */
  function forceAll(collapsed = true) {
    const out = {};
    for (const id of ids) out[id] = write(id, collapsed, 'force-all');
    return out;
  }

  /** 订阅 App 侧写入（class 变化）→ 只回流「不是我们写的」那部分。 */
  function start() {
    stop();
    for (const id of ids) {
      const el = adapter.el(id);
      if (!el) continue;
      const obs = new MutationObserver(() => {
        const now = clock();
        const guard = suppress.get(id) || 0;
        const cur = current(id);
        if (now < guard) {
          stats.suppressed += 1;
          return;
        }
        if (desired.has(id) && desired.get(id) === cur) return;
        desired.set(id, cur);
        stats.appWrites += 1;
        try {
          onExternalChange(id, cur);
        } catch (err) {
          console.error('[lc/port] onChange failed', err);
        }
      });
      obs.observe(el, { attributes: true, attributeFilter: ['class'] });
      observers.push(obs);
    }
  }

  function stop() {
    for (const o of observers) {
      try {
        o.disconnect();
      } catch (_) {}
    }
    observers = [];
  }

  return {
    write,
    forceAll,
    start,
    stop,
    reconcile,
    read: current,
    desired: (id) => desired.get(id),
    stats: () => ({ ...stats }),
    ids: () => ids.slice(),
  };
}

export { DEFAULT_PORT_IDS };
export default { createCollapsePort, DEFAULT_PORT_IDS };
