/* ============================================================================
   src/lc/index.js —— 组装：subscribe → controller → layout → render
   ----------------------------------------------------------------------------
   架构 §3.3：本文件是唯一把模块接起来的地方；不含业务规则。
   一次点击的时序（§3.4）：
     pointerup → controller.dispatch(ACTIVATE) → 一次 rAF: measure → layout → render
     → WAAPI 从 presentation 值起 → onfinish 校验 gen → phase='open'
   ========================================================================== */
import { CARDS, CARD_IDS, GROUPS, STORE_KEY } from './cards.js';
import { ACT, EFF, PHASE, createController, isLive } from './controller.js';
import { createAdapter } from './app-adapter.js';
import { createCollapsePort } from './collapse-port.js';
import { createRenderer } from './render.js';
import { createInteraction } from './interaction.js';
import { layout } from './layout.js';

const BOOT_MAX_FRAMES = 900; // ≈15s（rAF 计帧，不用 setTimeout）
const SETTLE_FRAMES = 90; // ≈1.5s：App 启动期会搬容器/恢复状态，沉降后强制全 mini（D1）

const TARGETS = (() => {
  const t = {};
  for (const id of CARD_IDS) t[id] = { expW: CARDS[id].expW, expH: CARDS[id].expH, rail: CARDS[id].rail };
  return t;
})();

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : {};
  } catch (_) {
    return {};
  }
}

function writeStore(offsets) {
  try {
    const out = {};
    for (const id in offsets) {
      const o = offsets[id];
      if (o && (Math.abs(o.x) > 0.5 || Math.abs(o.y) > 0.5)) out[id] = { x: Math.round(o.x), y: Math.round(o.y) };
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(out));
  } catch (_) {}
}

export function boot() {
  if (typeof window === 'undefined' || window.__lcBooted) return window.__lc && window.__lc.api;
  window.__lcBooted = true;

  const adapter = createAdapter();
  let lastSnapshot = null;
  let frames = 0;
  let settleLeft = SETTLE_FRAMES;
  let queued = false;

  const api = { version: '2.0.0' };
  window.__lc = window.__lc || {};
  window.__lc.api = api;

  const controller = createController({ onEffect: handleEffects });
  const renderer = createRenderer({
    adapter,
    onAnimEnd: (id, gen) => controller.dispatch({ type: ACT.ANIM_END, id, gen }),
  });
  const port = createCollapsePort({
    adapter,
    onExternalChange: (id, collapsed) => {
      const st = controller.state();
      const phase = st.cards[id] && st.cards[id].phase;
      if (!collapsed && phase === PHASE.MINI) {
        /* App 侧展开（点图层/CCTV/电台/首次引导）→ 反向驱动 opening */
        controller.dispatch({ type: ACT.APP_COLLAPSED, id, collapsed: false });
      } else if (collapsed && isLive(phase)) {
        controller.dispatch({ type: ACT.APP_COLLAPSED, id, collapsed: true });
      }
    },
  });
  const interaction = createInteraction({
    dispatch: (a) => controller.dispatch(a),
    phaseOf: (id) => (controller.state().cards[id] || {}).phase || PHASE.MINI,
    onDrag: (id, on) => renderer.setDragging(id, on),
  });

  function phaseMap() {
    const st = controller.state();
    const phases = {};
    const gens = {};
    for (const id of CARD_IDS) {
      const c = st.cards[id];
      phases[id] = c ? c.phase : PHASE.MINI;
      gens[id] = c ? c.gen : 0;
    }
    return { st, phases, gens };
  }

  function scheduleFrame() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(runFrame);
  }

  function runFrame() {
    queued = false;
    const { st, phases, gens } = phaseMap();
    renderer.assertStaged(phases);
    const dockId = CARD_IDS.find(
      (id) => CARDS[id].rail === 'dock' && (phases[id] === PHASE.OPENING || phases[id] === PHASE.OPEN),
    );
    const snapshot = adapter.measure({ pushes: renderer.pushesOf(), phases, dockId });
    const offsets = {};
    for (const id of CARD_IDS) offsets[id] = (st.cards[id] && st.cards[id].offset) || { x: 0, y: 0 };
    const result = layout({
      viewport: snapshot.viewport,
      safe: snapshot.safe,
      cards: snapshot.cards,
      dock: snapshot.dock,
      protected: snapshot.protected,
      phases,
      targets: TARGETS,
      offsets,
      openOrder: st.openOrder,
    });
    renderer.apply({ snapshot, result, phases, gens });
    lastSnapshot = snapshot;
    frames += 1;
    if (settleLeft > 0) settleLeft -= 1;

    window.__lc.result = result;
    window.__lc.violations = result.violations;
    window.__lc.snapshot = { viewport: snapshot.viewport, dock: snapshot.dock, protected: snapshot.protected, minis: Object.fromEntries(Object.entries(snapshot.cards).map(([k, v]) => [k, v.mini])) };
    window.__lc.lastFrameAt = performance.now();
  }

  function handleEffects(state, effects) {
    for (const e of effects) {
      if (e.type === EFF.COLLAPSE_WRITE) {
        if (!e.collapsed) {
          /* 先脱层再让 App 展开：否则 App 的 `:has(#x:not(.collapsed))` 会闪一帧 */
          const cached = lastSnapshot && lastSnapshot.cards && lastSnapshot.cards[e.id];
          const mini = (cached && cached.mini) || null;
          adapter.stageCard(e.id, mini);
        }
        port.write(e.id, e.collapsed, e.reason);
        if (e.collapsed) renderer.finishClose(e.id);
      } else if (e.type === EFF.FRAME) {
        scheduleFrame();
      } else if (e.type === EFF.FOCUS) {
        const h = adapter.headerOf(e.id) || adapter.el(e.id);
        if (h && typeof h.focus === 'function') {
          try {
            if (!h.hasAttribute('tabindex') && !/^(BUTTON|INPUT|A|SELECT|TEXTAREA)$/.test(h.tagName)) h.setAttribute('tabindex', '-1');
            h.focus({ preventScroll: true });
          } catch (_) {}
        }
      } else if (e.type === EFF.PERSIST) {
        const st = controller.state();
        const offsets = {};
        for (const id of CARD_IDS) offsets[id] = st.cards[id].offset;
        writeStore(offsets);
      }
    }
  }

  /* ── 启动 ──────────────────────────────────────────────────────────────── */
  let bootFrames = 0;
  const waitReady = () => {
    const ready = CARD_IDS.every((id) => document.getElementById(id));
    if (!ready && ++bootFrames < BOOT_MAX_FRAMES) {
      requestAnimationFrame(waitReady);
      return;
    }
    start();
  };

  function start() {
    /* 1) 材质皮：8 张卡统一加 .gev-lc + 初始相位 */
    for (const id of CARD_IDS.concat(['gev-gfx-fab'])) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.classList.add('gev-lc');
      if (!el.dataset.lcPhase) el.dataset.lcPhase = PHASE.MINI;
      el.dataset.lcRail = (CARDS[id] && CARDS[id].rail) || 'chrome';
    }
    /* 1b) 两条侧轨上移到标题栏之下（App 自然位置是垂直居中 top≈190） */
    adapter.liftRails(94);
    /* 2) 初始全 mini（D1）：先经 App API 收起 7 张披露卡 */
    port.forceAll(true);
    port.start();
    /* 3) 持久化几何（只 offset，不存形态） */
    controller.dispatch({ type: ACT.HYDRATE, offsets: readStore() });
    /* 4) 交互 */
    interaction.bind(document);
    window.addEventListener(
      'resize',
      () => {
        adapter.liftRails(94);
        controller.dispatch({ type: ACT.RESIZE });
      },
      { passive: true },
    );

    /* 5) App 把展开卡抢回轨道 → 重新脱层（展开卡必须在 stage 是 renderer 的不变量） */
    const parentWatch = new MutationObserver(() => {
      const { phases } = phaseMap();
      for (const id of CARD_IDS) {
        if (isLive(phases[id]) && !adapter.isStaged(id)) {
          api.diagnostics = api.diagnostics || {};
          api.diagnostics.reparentFixes = (api.diagnostics.reparentFixes || 0) + 1;
          scheduleFrame();
          break;
        }
      }
    });
    try {
      parentWatch.observe(document.body, { childList: true, subtree: true });
    } catch (_) {}

    /* 5b) 侧轨上移的稳定化：App 在启动后 2–8s 之间会把轨道摆到「垂直居中」，
       这里用有界的 rAF 采样（不是 timer）在它落定前持续校正，稳定 60 帧即退出。 */
    let railFrames = 0;
    let railStable = 0;
    const railTick = () => {
      railFrames += 1;
      adapter.liftRails(94);
      const L = document.getElementById('left-panel-stack');
      const R = document.getElementById('right-context-rail');
      const okTop = (e) => !e || e.getBoundingClientRect().top <= 95;
      if (okTop(L) && okTop(R)) railStable += 1;
      else railStable = 0;
      if (railStable < 60 && railFrames < 900) requestAnimationFrame(railTick);
    };
    requestAnimationFrame(railTick);

    /* 6) 首帧 + 沉降后再次强制全 mini（App 启动恢复可能把某张卡展开） */
    scheduleFrame();
    const settleTick = () => {
      if (settleLeft > 0) {
        requestAnimationFrame(settleTick);
        return;
      }
      const st = controller.state();
      for (const id of CARD_IDS) {
        if (st.cards[id].phase !== PHASE.MINI) return; // 用户已经操作过，尊重
      }
      adapter.liftRails(94);
      port.forceAll(true);
      scheduleFrame();
    };
    requestAnimationFrame(settleTick);

    api.ready = true;
  }

  /* ── 只读钩子（§3.1 原则 5：可断言优先）────────────────────────────────── */
  Object.assign(api, {
    state: () => { const s = controller.state(); const o = {}; for (const id of CARD_IDS) o[id] = { ...s.cards[id], offset: { ...s.cards[id].offset } }; return { cards: o, openOrder: s.openOrder.slice() }; },
    phases: () => phaseMap().phases,
    assert: () => ({
      violations: (window.__lc.violations || []).slice(0, 8),
      groups: controller.assert(),
      port: port.stats(),
      renderer: renderer.stats(),
    }),
    gpu: () => (window.__gevGpu && typeof window.__gevGpu.probe === 'function' ? window.__gevGpu.probe() : null),
    morph: () => (window.__lc.morph && window.__lc.morph.last) || null,
    port: () => port.stats(),
    dispatch: (a) => controller.dispatch(a),
  });

  waitReady();
  return api;
}

/* 自动启动（删除 index.html 的 <script> 即回滚） */
try {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
} catch (err) {
  console.error('[lc] boot failed', err);
}

export default { boot };
