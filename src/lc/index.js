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
import * as bridge from '../bridge.js';

const BOOT_MAX_FRAMES = 900; // ≈15s（rAF 计帧，不用 setTimeout）
const SETTLE_FRAMES = 90; // ≈1.5s：App 启动期会搬容器/恢复状态，沉降后强制全 mini（D1）
/* Phase7A3：语音卡（#gev-voice-control）不是静态卡壳 —— 它由 App 在命令坞里注入，
   排在 Cesium 之后。卡壳/LC 现在先于 Cesium mount，**不能**为它把整层挂载推到
   App 就绪（实测那样 cardsClickable 又回到 7–9.5s）。改为：必需卡 = 7 张静态卡壳，
   语音卡等它出现时由 MutationObserver 补皮（skinCard）。 */
const DEFERRED_IDS = Object.freeze(['gev-voice-control']);
const REQUIRED_IDS = Object.freeze(
  CARD_IDS.filter((id) => !DEFERRED_IDS.includes(id)),
);

const TARGETS = (() => {
  const t = {};
  for (const id of CARD_IDS)
    t[id] = {
      expW: CARDS[id].expW,
      expH: CARDS[id].expH,
      rail: CARDS[id].rail,
    };
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
      if (o && (Math.abs(o.x) > 0.5 || Math.abs(o.y) > 0.5))
        out[id] = { x: Math.round(o.x), y: Math.round(o.y) };
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(out));
  } catch (_) {}
}

export function boot() {
  /* Phase8D #15：启动幂等标记与对外 API 都走 bridge 槽位（window.__lcBooted / __lc 只是兼容面） */
  if (typeof window === 'undefined' || bridge.get('lc.booted'))
    return bridge.get('lc.api');
  bridge.register('lc.booted', true, {
    global: '__lcBooted',
    owner: 'src/lc/index.js',
  });

  const adapter = createAdapter();
  let lastSnapshot = null;
  let frames = 0;
  let settleLeft = SETTLE_FRAMES;
  let queued = false;

  const api = { version: '2.0.0' };
  const LC = bridge.ensure('lc', { global: '__lc', owner: 'src/lc/index.js' });
  LC.api = api;
  bridge.register('lc.api', api, { owner: 'src/lc/index.js' });

  const controller = createController({ onEffect: handleEffects });
  const renderer = createRenderer({
    adapter,
    onAnimEnd: (id, gen) =>
      controller.dispatch({ type: ACT.ANIM_END, id, gen }),
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
      (id) =>
        CARDS[id].rail === 'dock' &&
        (phases[id] === PHASE.OPENING || phases[id] === PHASE.OPEN),
    );
    const snapshot = adapter.measure({
      pushes: renderer.pushesOf(),
      phases,
      dockId,
    });
    const offsets = {};
    for (const id of CARD_IDS)
      offsets[id] = (st.cards[id] && st.cards[id].offset) || { x: 0, y: 0 };
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

    LC.result = result;
    LC.violations = result.violations;
    LC.snapshot = {
      viewport: snapshot.viewport,
      dock: snapshot.dock,
      protected: snapshot.protected,
      minis: Object.fromEntries(
        Object.entries(snapshot.cards).map(([k, v]) => [k, v.mini]),
      ),
    };
    LC.lastFrameAt = performance.now();
  }

  function handleEffects(state, effects) {
    for (const e of effects) {
      if (e.type === EFF.COLLAPSE_WRITE) {
        if (!e.collapsed) {
          /* 先脱层再让 App 展开：否则 App 的 `:has(#x:not(.collapsed))` 会闪一帧 */
          const cached =
            lastSnapshot && lastSnapshot.cards && lastSnapshot.cards[e.id];
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
            if (
              !h.hasAttribute('tabindex') &&
              !/^(BUTTON|INPUT|A|SELECT|TEXTAREA)$/.test(h.tagName)
            )
              h.setAttribute('tabindex', '-1');
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
    const ready = REQUIRED_IDS.every((id) => document.getElementById(id));
    if (!ready && ++bootFrames < BOOT_MAX_FRAMES) {
      requestAnimationFrame(waitReady);
      return;
    }
    start();
  };

  /* 材质皮（幂等）：8 张卡统一加 .gev-lc + 初始相位。后到的卡（语音卡）也走这里。 */
  function skinCard(id) {
    const el = document.getElementById(id);
    if (!el) return false;
    const first = !el.classList.contains('gev-lc');
    el.classList.add('gev-lc');
    if (!el.dataset.lcPhase) el.dataset.lcPhase = PHASE.MINI;
    el.dataset.lcRail = (CARDS[id] && CARDS[id].rail) || 'chrome';
    return first;
  }

  function start() {
    /* 1) 材质皮：8 张卡统一加 .gev-lc + 初始相位 */
    for (const id of CARD_IDS.concat(['gev-gfx-fab'])) skinCard(id);
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
      /* Phase7A3：语音卡/玻璃 FAB 可能在 LC 挂载之后才注入 → 补皮并排一帧布局 */
      let skinned = false;
      for (const id of DEFERRED_IDS.concat(['gev-gfx-fab'])) {
        if (skinCard(id)) skinned = true;
      }
      if (skinned) scheduleFrame();
      const { phases } = phaseMap();
      for (const id of CARD_IDS) {
        if (isLive(phases[id]) && !adapter.isStaged(id)) {
          api.diagnostics = api.diagnostics || {};
          api.diagnostics.reparentFixes =
            (api.diagnostics.reparentFixes || 0) + 1;
          scheduleFrame();
          break;
        }
      }
    });
    try {
      parentWatch.observe(document.body, { childList: true, subtree: true });
    } catch (_) {}

    /* Phase7A3：LC 现在先于 App 起来，App 在启动中段（Cesium 之后）会自己摆轨道/
       外壳几何（natural top≈190、body.cockpit-mode 等），此时 LC 的槽位已过期 →
       监听两条轨与 body 的 style/class 变化，重新对齐一次 + 一次布局帧。
       liftRails 只写 translate（不参与布局、无过渡），且幂等，不会自激。 */
    let appGeomQueued = false;
    const onAppGeom = () => {
      if (appGeomQueued) return;
      appGeomQueued = true;
      requestAnimationFrame(() => {
        appGeomQueued = false;
        adapter.liftRails(94);
        controller.dispatch({ type: ACT.RESIZE });
      });
    };
    const geomWatch = new MutationObserver(onAppGeom);
    for (const sel of [
      '#left-panel-stack',
      '#right-context-rail',
      '#command-dock',
    ]) {
      const node = document.querySelector(sel);
      if (!node) continue;
      try {
        geomWatch.observe(node, {
          attributes: true,
          attributeFilter: ['style', 'class'],
        });
      } catch (_) {}
    }
    try {
      geomWatch.observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
      });
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

    /* Phase6C3-B：api.ready 的口径改为「遮罩已收起、可交互」——gate 用它当冷启动
       终点，遮罩期的长帧（Cesium ShaderProgram link / 瓦片 JSON 解析）不计入可见
       帧。没有就绪门（删掉 index.html 那行）时立即置位，等价旧行为。 */
    api.mounted = true;
    /* Phase7A2：卡片层挂载时刻（= D+ 输入放行的判据）。记进冷启动时间线，
       否则「卡片何时真的能点」只能靠外部轮询猜（实测轮询本身会拖慢冷启动）。 */
    api.mountedAt = +performance.now().toFixed(1);
    try {
      if (
        globalThis.__bootTimeline &&
        typeof globalThis.__bootTimeline.mark === 'function'
      )
        globalThis.__bootTimeline.mark('lc:mounted');
    } catch (_) {}
    /* Phase7A3：卡片层现在先于 Cesium 求值起来 → mount 的一刻**同步**放行输入
       （遮罩退化成顶部胶囊 + 只盖 canvas 的暗纱；卡片 rail 不再被挡）。
       不等 rAF 轮询：Cesium 求值一开始就占住主线程 3s，rAF 唤醒会被推迟。 */
    try {
      const gate = bridge.get('boot');
      if (gate && typeof gate.releaseInputEarly === 'function')
        api.inputReleasedAt = gate.releaseInputEarly('lc-mounted-sync');
    } catch (_) {}
    /* Phase7A3：App（Cesium 之后）起来时把 collapsed 状态回灌给 App API，
       并把轨道/卡片几何重新对齐一次（App 启动中段会自己摆轨道位置）。 */
    let appWatchFrames = 0;
    const appWatch = () => {
      appWatchFrames += 1;
      let adopted = false;
      try {
        adopted = port.reconcile();
      } catch (_) {}
      if (adopted) {
        api.appApiAt = +performance.now().toFixed(1);
        try {
          if (
            globalThis.__bootTimeline &&
            typeof globalThis.__bootTimeline.mark === 'function'
          )
            globalThis.__bootTimeline.mark('lc:app-api');
        } catch (_) {}
        adapter.liftRails(94);
        controller.dispatch({ type: ACT.RESIZE });
        return;
      }
      if (appWatchFrames < 3600) requestAnimationFrame(appWatch);
    };
    requestAnimationFrame(appWatch);
    const markReady = () => {
      if (api.ready) return;
      api.readyAt = +performance.now().toFixed(1);
      api.ready = true;
    };
    const bootGate = bridge.get('boot');
    if (bootGate && typeof bootGate.whenInteractive === 'function') {
      bootGate.whenInteractive(30000).then(markReady, markReady);
    } else {
      markReady();
    }
    /* Phase7A-D：卡片可点的时刻与「遮罩视觉收起」解耦。
       api.ready 保留旧语义（= 遮罩完全消失，C3 起的验收口径，现已 deprecated）；
       api.interactiveAt = 遮罩放行输入（gate inputRelease）且本层已 mounted/bind。
       此时卡片 DOM 已就绪、pointer 事件已绑定，真实点击会进 opening。 */
    api.interactiveAt = null;
    const markInteractive = () => {
      if (api.interactiveAt != null) return;
      api.interactiveAt = +performance.now().toFixed(1);
    };
    if (bootGate && typeof bootGate.whenInputRelease === 'function') {
      bootGate.whenInputRelease(15000).then(markInteractive, markInteractive);
    } else {
      markInteractive();
    }
  }

  /* ── 只读钩子（§3.1 原则 5：可断言优先）────────────────────────────────── */
  Object.assign(api, {
    state: () => {
      const s = controller.state();
      const o = {};
      for (const id of CARD_IDS)
        o[id] = { ...s.cards[id], offset: { ...s.cards[id].offset } };
      return { cards: o, openOrder: s.openOrder.slice() };
    },
    phases: () => phaseMap().phases,
    assert: () => ({
      violations: ((bridge.get('lc') || {}).violations || []).slice(0, 8),
      groups: controller.assert(),
      port: port.stats(),
      renderer: renderer.stats(),
    }),
    gpu: () => {
      const g = bridge.get('gpu');
      return g && typeof g.probe === 'function' ? g.probe() : null;
    },
    morph: () =>
      ((bridge.get('lc') || {}).morph && bridge.get('lc').morph.last) || null,
    port: () => port.stats(),
    dispatch: (a) => controller.dispatch(a),
  });

  waitReady();
  return api;
}

/* 自动启动（删除 index.html 的 <script> 即回滚） */
try {
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
} catch (err) {
  console.error('[lc] boot failed', err);
}

export default { boot };
