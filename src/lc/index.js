/* ============================================================================
   src/lc/index.js —— 组装：subscribe → controller → layout → render
   ----------------------------------------------------------------------------
   架构 §3.3：本文件是唯一把模块接起来的地方；不含业务规则。
   一次点击的时序（§3.4）：
     pointerup → controller.dispatch(ACTIVATE) → 一次 rAF: measure → layout → render
     → WAAPI 从 presentation 值起 → onfinish 校验 gen → phase='open'
   ========================================================================== */
import { CARDS, CARD_IDS, STORE_KEY } from './cards.js';
import { ACT, EFF, PHASE, createController, isLive } from './controller.js';
import { createAdapter } from './app-adapter.js';
import { createCollapsePort } from './collapse-port.js';
import { createRenderer } from './render.js';
import { createInteraction } from './interaction.js';
import { layout } from './layout.js';
import * as bridge from '../bridge.js';

const BOOT_MAX_FRAMES = 900; // ≈15s（rAF 计帧，不用 setTimeout）
const SETTLE_FRAMES = 90; // ≈1.5s：App 启动期会搬容器/恢复状态，沉降后强制全 mini（D1）
/* G02：相位看门狗阈值。最长 morph 445ms（D1=A），留 2.5x 余量再判「回调丢了」。 */
const PHASE_WATCHDOG_MS = 1200;
/* 帧尾巴上限：动画未落定时续帧，最多 360 帧（≈6s）后交回看门狗处理，绝不死循环。 */
const TAIL_MAX_FRAMES = 360;
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
  let tailFrames = 0; /* 帧尾巴计数：动画未落定时续帧，见 runFrame 末尾 */

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
  /* 测试/调试钩子：同步推一帧。窗口被遮挡或后台时 rAF 会被节流到 1fps，
     探针没法「等帧」，只能主动驱动 measure→layout→render 才测得准槽位与相位。 */
  LC.requestFrame = () => {
    if (queued) return false;
    queued = true;
    runFrame();
    return true;
  };

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
      rails: snapshot.rails,
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
      rails: snapshot.rails,
      dock: snapshot.dock,
      protected: snapshot.protected,
      minis: Object.fromEntries(
        Object.entries(snapshot.cards).map(([k, v]) => [k, v.mini]),
      ),
    };
    LC.lastFrameAt = performance.now();
    /* 探针只读出口：槽位缓存 / 失效标记 / dock arm 状态（无副作用）。 */
    LC.slots = adapter.slotsSnapshot ? adapter.slotsSnapshot() : null;

    /* 帧尾巴：morph / 让位回弹还在跑就继续按需帧。
       根因（probe-v16）：宿主只在事件/相位变化时调度单帧，WAAPI 的动画时钟一旦
       没有合成帧就不再推进 —— 收起卡后兄弟卡的让位回弹停在 currentTime=0、
       transform 残留 translateY(332)，卡片永久卡在下方。这里用有界续帧
       （≤TAIL_MAX_FRAMES ≈6s）把动画推到落定，而不是靠看门狗硬切。 */
    const pending = renderer.pendingMorph();
    if (pending > 0 && tailFrames < TAIL_MAX_FRAMES) {
      tailFrames += 1;
      scheduleFrame();
    } else {
      tailFrames = 0;
    }
  }

  function handleEffects(state, effects) {
    for (const e of effects) {
      if (e.type === EFF.COLLAPSE_WRITE) {
        /* G03：只有「卡片真的回到 mini」才允许写 collapsed=true。
           队列里可能还压着一条早先排队的收起（closing 被用户点击取消 → 已回 opening），
           盲写会让 App 收起一张正在展开的卡：内容瞬空、让位被撤、morph 目标消失。 */
        const cur = state.cards[e.id];
        if (e.collapsed && (!cur || cur.phase !== PHASE.MINI)) {
          api.diagnostics = api.diagnostics || {};
          api.diagnostics.collapseWriteSkipped =
            (api.diagnostics.collapseWriteSkipped || 0) + 1;
          continue;
        }
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
        /* G05：视口变了 → 槽位必须整体重读（liftRails 内部也会失效一次，这里覆盖 rotate/DPR 变化） */
        adapter.invalidateSlots();
        adapter.liftRails(94);
        controller.dispatch({ type: ACT.RESIZE });
      },
      { passive: true },
    );

    /* G02：相位看门狗。WAAPI finish 回调在隐藏标签页、节点被 App 抢回、cancel 竞态下都可能丢；
       一旦丢，卡就永停 opening/closing —— 表现为「点不到」「内容悬空不落位」。
       超过最长动画时长仍未落定，即用当前 gen 强制落定（gen 不匹配会被 reducer 丢弃，不会误杀新动画）。 */
    const watchdogTimer = setInterval(() => {
      // 后台标签页不巡检：WAAPI finish 与 rAF 在隐藏时同样被挂起，相位本来就
      // 不会前进；此时强推 ANIM_END 反而会把「隐藏期间打开」的卡片瞬间落定。
      if (document.hidden) return;
      const { st } = phaseMap();
      const t = performance.now();
      for (const id of CARD_IDS) {
        const c = st.cards[id];
        if (!c) continue;
        if (c.phase !== PHASE.OPENING && c.phase !== PHASE.CLOSING) continue;
        const started = c.phase === PHASE.CLOSING ? c.closeStart : c.openStart;
        if (!started || t - started < PHASE_WATCHDOG_MS) continue;
        api.diagnostics = api.diagnostics || {};
        api.diagnostics.phaseWatchdog =
          (api.diagnostics.phaseWatchdog || 0) + 1;
        controller.dispatch({ type: ACT.ANIM_END, id, gen: c.gen });
      }
    }, 400);
    // 句柄留档：卸载时停表（bfcache 返回会重新 boot，否则同一个页面会有两条看门狗）。
    api.diagnostics = api.diagnostics || {};
    api.diagnostics.watchdogTimer = watchdogTimer;
    window.addEventListener(
      'pagehide',
      () => {
        clearInterval(watchdogTimer);
        api.diagnostics.watchdogTimer = null;
      },
      { once: true },
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
        /* G05：App 重排轨道（换 active / 改 safe-top / 切座舱）时视口没变，
           旧槽位却已失效 —— 必须先作废缓存再对齐，否则 live 卡按旧槽位落位。 */
        adapter.invalidateSlots();
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
    let railSince = 0;
    const RAIL_ARM_MS = 900;
    /* 三条轨道都摆好之后才允许锁 dock 槽位。
       判据用「稳定持续真实时间」而不是帧数：rAF 在窗口被遮挡/后台时会被节流到 1fps，
       纯帧计数会把 arm 无限推迟（实测 6s 只推进 6 帧），dock 卡于是永远不进 LC 布局。 */
    const armIfReady = () => {
      if (!railSince || Date.now() - railSince < RAIL_ARM_MS) return false;
      if (!adapter.armDockSlots()) return false;
      adapter.invalidateSlots();
      scheduleFrame();
      return true;
    };
    const railTick = () => {
      railFrames += 1;
      adapter.liftRails(94);
      const L = document.getElementById('left-panel-stack');
      const R = document.getElementById('right-context-rail');
      const okTop = (e) => !e || e.getBoundingClientRect().top <= 95;
      if (okTop(L) && okTop(R)) {
        railStable += 1;
        if (!railSince) railSince = Date.now();
      } else {
        railStable = 0;
        railSince = 0;
      }
      globalThis.__lcRail = { stable: railStable, frames: railFrames };
      /* 早于此刻锁会把 App 启动期的「两卡靠拢」中间态当成家（control-panel 637 vs 888）。 */
      armIfReady();
      if (!globalThis.__lcDockArmed && railFrames < 900) requestAnimationFrame(railTick);
    };
    requestAnimationFrame(railTick);
    /* rAF 兜底：即使启动期一帧都跑不动，也要在 6s 后把 dock 槽位放行，不能让卡永久缺槽位。 */
    for (const ms of [1600, 3000, 6000]) {
      setTimeout(() => {
        adapter.liftRails(94);
        if (!railSince) railSince = Date.now() - RAIL_ARM_MS;
        armIfReady();
      }, ms);
    }

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
