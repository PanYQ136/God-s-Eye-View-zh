/* ============================================================================
   src/lc/controller.js —— L4 CardController（唯一状态 owner）
   ----------------------------------------------------------------------------
   架构 §4：每卡独立 state[id]，相位 mini → opening → open → closing → mini；
   世代号 gen 让任何动画回调整体失效；互斥组事务在**同一 tick** 内退旧开新；
   持久化只存几何（offset），不存形态。

   纯函数内核：`reduce(state, action, ctx) → {state, effects}`，零 DOM、零 timer、
   零 performance.now（now 由 ctx 注入）→ 可在 node --test 里把每条转移跑到。
   effects 是给宿主的**命令**：COLLAPSE_WRITE / FRAME / FOCUS / PERSIST。
   ========================================================================== */
import { CARDS, CARD_IDS, GROUPS, groupOf } from './cards.js';

export const PHASE = Object.freeze({
  MINI: 'mini',
  OPENING: 'opening',
  OPEN: 'open',
  CLOSING: 'closing',
});

export const ACT = Object.freeze({
  ACTIVATE: 'ACTIVATE', // 真实点击/键盘激活（唯一用户意图入口）
  ANIM_END: 'ANIM_END', // Morph 落定（带 gen）
  ESC: 'ESC',
  CLICK_OUTSIDE: 'CLICK_OUTSIDE',
  RESIZE: 'RESIZE',
  APP_COLLAPSED: 'APP_COLLAPSED', // App 侧写入回流（§7.1 A1–A6）
  DRAG: 'DRAG', // 展开卡 header 拖动（offset 只进 controller）
  DRAG_END: 'DRAG_END',
  HYDRATE: 'HYDRATE', // 读取持久化几何（不改相位）
});

export const EFF = Object.freeze({
  COLLAPSE_WRITE: 'COLLAPSE_WRITE', // → CollapsePort.write(id, collapsed, reason)
  FRAME: 'FRAME', // → 宿主安排一帧 layout+render
  FOCUS: 'FOCUS', // → 焦点回 header
  PERSIST: 'PERSIST', // → 宿主写 localStorage
});

const isLive = (p) => p === PHASE.OPENING || p === PHASE.OPEN;
const isAnimating = (p) => p === PHASE.OPENING || p === PHASE.CLOSING;

/** G04：App 侧回流去重窗口。class 观察 + API 回调是两条通道，同一值会连发。 */
export const EXT_DEDUPE_MS = 120;

function blankState(ids) {
  const cards = {};
  for (const id of ids) {
    cards[id] = {
      phase: PHASE.MINI,
      gen: 0,
      closeStart: 0,
      openStart: 0,
      lastExt: null,
      offset: { x: 0, y: 0 },
      dragging: false,
    };
  }
  return {
    cards,
    openOrder: [],
    layoutDirty: true,
    seq: 0,
    echoDropped: 0,
  };
}

/** 深拷贝（状态很小，测试要能对比前后）。 */
export function cloneState(s) {
  const cards = {};
  for (const id in s.cards)
    cards[id] = { ...s.cards[id], offset: { ...s.cards[id].offset } };
  return {
    cards,
    openOrder: s.openOrder.slice(),
    layoutDirty: s.layoutDirty,
    seq: s.seq,
    echoDropped: s.echoDropped || 0,
  };
}

/**
 * 纯 reducer。
 * @param {object} state 当前状态（不会被修改）
 * @param {object} action {type, id?, gen?, dx?, dy?, collapsed?, offsets?}
 * @param {object} ctx    {now:number}
 * @returns {{state:object, effects:object[]}}
 */
export function reduce(state, action, ctx = {}) {
  const now = Number(ctx.now) || 0;
  const next = cloneState(state);
  const effects = [];
  const frame = () => effects.push({ type: EFF.FRAME });
  const type = action && action.type;
  next.seq = (next.seq || 0) + 1;

  if (type === ACT.HYDRATE) {
    const offs = action.offsets || {};
    for (const id in next.cards) {
      const o = offs[id];
      if (o && Number.isFinite(o.x) && Number.isFinite(o.y))
        next.cards[id].offset = { x: o.x, y: o.y };
    }
    return { state: next, effects };
  }

  if (type === ACT.RESIZE) {
    next.layoutDirty = true;
    frame();
    return { state: next, effects };
  }

  if (type === ACT.ESC || type === ACT.CLICK_OUTSIDE) {
    const id = action.id || next.openOrder[next.openOrder.length - 1];
    if (!id || !next.cards[id]) return { state, effects };
    const c = next.cards[id];
    if (!isLive(c.phase)) return { state, effects };
    c.phase = PHASE.CLOSING;
    c.closeStart = now;
    c.gen += 1;
    c.dragging = false;
    effects.push({ type: EFF.FOCUS, id });
    frame();
    return { state: next, effects };
  }

  if (type === ACT.ANIM_END) {
    const c = next.cards[action.id];
    if (!c) return { state, effects };
    if (Number(action.gen) !== c.gen) return { state, effects }; // 世代号：过期动画整体作废
    if (c.phase === PHASE.OPENING) {
      c.phase = PHASE.OPEN;
      frame();
    } else if (c.phase === PHASE.CLOSING) {
      c.phase = PHASE.MINI;
      c.openStart = 0;
      c.offset = { x: 0, y: 0 }; // 收起归位必须逐像素回到基线
      c.dragging = false;
      next.openOrder = next.openOrder.filter((x) => x !== action.id);
      /* §4.2：先让 App 收起（内容同步隐藏），宿主在同一 tick 内卸浮层 → 不闪 */
      effects.push({
        type: EFF.COLLAPSE_WRITE,
        id: action.id,
        collapsed: true,
        reason: 'close-end',
      });
      effects.push({ type: EFF.PERSIST });
      frame();
    }
    return { state: next, effects };
  }

  if (type === ACT.DRAG) {
    const c = next.cards[action.id];
    if (!c || c.phase !== PHASE.OPEN) return { state, effects };
    c.offset = {
      x: (c.offset.x || 0) + (Number(action.dx) || 0),
      y: (c.offset.y || 0) + (Number(action.dy) || 0),
    };
    c.dragging = true;
    next.layoutDirty = true;
    frame();
    return { state: next, effects };
  }

  if (type === ACT.DRAG_END) {
    const c = next.cards[action.id];
    if (!c) return { state, effects };
    c.dragging = false;
    effects.push({ type: EFF.PERSIST });
    return { state: next, effects };
  }

  if (type === ACT.APP_COLLAPSED) {
    const c = next.cards[action.id];
    if (!c) return { state, effects };
    const collapsed = !!action.collapsed;
    /* G04：App 回流去重。App 侧「class 观察」与「API 回调」是两条独立通道，
       同一值会在同一帧里连发两次；第二次 dispatch 会再次 gen++，把正在飞的 morph
       世代作废（视觉上是卡在半路的「果冻」）。同值且在窗口内的一律丢弃。 */
    if (
      c.lastExt &&
      c.lastExt.collapsed === collapsed &&
      now - c.lastExt.at < EXT_DEDUPE_MS
    ) {
      next.echoDropped = (next.echoDropped || 0) + 1;
      return { state: next, effects };
    }
    c.lastExt = { collapsed, at: now };
    if (collapsed) {
      /* App 把「我们正开着的卡」收起了 → 翻译成 closing（不是瞬间 mini） */
      if (isLive(c.phase)) {
        c.phase = PHASE.CLOSING;
        c.closeStart = now;
        c.gen += 1;
        frame();
      }
      return { state: next, effects };
    }
    /* App 把某卡展开了（点图层/CCTV/电台/首次引导，§7.1 A6）→ 必须反向驱动 opening，
       否则用户会看到「点了图层卡没展开」。 */
    if (c.phase === PHASE.MINI) {
      const gen = activate(next, action.id, now, effects, {
        writeExpand: false,
      });
      c.gen = gen;
      frame();
    }
    return { state: next, effects };
  }

  if (type === ACT.ACTIVATE) {
    const c = next.cards[action.id];
    if (!c) return { state, effects };
    if (!CARDS[action.id] || !CARDS[action.id].expandable)
      return { state, effects };
    if (c.phase === PHASE.MINI) {
      activate(next, action.id, now, effects, { writeExpand: true });
      frame();
    } else if (c.phase === PHASE.OPENING || c.phase === PHASE.OPEN) {
      c.phase = PHASE.CLOSING;
      c.closeStart = now;
      c.gen += 1;
      c.dragging = false;
      frame();
    } else if (c.phase === PHASE.CLOSING) {
      /* §4.3：closing 期间点击 = 取消关闭，从当前屏幕值重开（禁止 return 吞点） */
      c.phase = PHASE.OPENING;
      c.closeStart = 0;
      c.openStart = now;
      c.gen += 1;
      next.openOrder = next.openOrder
        .filter((x) => x !== action.id)
        .concat([action.id]);
      frame();
    }
    return { state: next, effects };
  }

  return { state, effects };

  /* ── 内部：ACTIVATE 的互斥事务 ───────────────────────────────────────────── */
  function activate(st, id, t, eff, opts) {
    const grp = groupOf(id);
    /* §4.2 MUTEX：同 tick 内先 retire 同组旧卡（进入 closing，并行动画），再开自己 */
    for (const sid of grp) {
      if (sid === id) continue;
      const s = st.cards[sid];
      if (!s) continue;
      if (isLive(s.phase)) {
        s.phase = PHASE.CLOSING;
        s.closeStart = t;
        s.gen += 1;
        s.dragging = false;
        /* 退场卡立刻退出 openOrder（z 序/ESC 目标都只看 live 卡） */
        st.openOrder = st.openOrder.filter((x) => x !== sid);
        /* 退场卡的内容在 closing 期间必须可见（否则动画是一个空壳）；
           收起由它自己的 ANIM_END → COLLAPSE_WRITE(true) 完成。 */
      }
    }
    const c = st.cards[id];
    c.phase = PHASE.OPENING;
    c.closeStart = 0;
    /* G02：opening 也留时间戳 → 看门狗可判定「动画回调丢失」，不让卡永停 opening */
    c.openStart = t;
    c.gen += 1;
    st.openOrder = st.openOrder.filter((x) => x !== id).concat([id]);
    /* 展开时先让 App 把面板展开（内容可见，才能量内容高/渲染），收起在 closing 落定后写 */
    if (opts && opts.writeExpand)
      eff.push({
        type: EFF.COLLAPSE_WRITE,
        id,
        collapsed: false,
        reason: 'open',
      });
    return c.gen;
  }
}

/* ── 生命周期壳：订阅 / dispatch / 只读快照 ──────────────────────────────── */

export function createController({
  ids = CARD_IDS,
  now = () =>
    typeof performance !== 'undefined' ? performance.now() : Date.now(),
  onEffect,
} = {}) {
  let state = blankState(ids);
  const subs = new Set();

  function notify(effects) {
    for (const fn of [...subs]) {
      try {
        fn(snapshot(), effects);
      } catch (err) {
        console.error('[lc/controller] subscriber failed', err);
      }
    }
    if (typeof onEffect === 'function') {
      try {
        onEffect(snapshot(), effects);
      } catch (err) {
        console.error('[lc/controller] onEffect failed', err);
      }
    }
  }

  function dispatch(action) {
    const res = reduce(state, action, { now: now() });
    const changed = res.effects.length > 0 || res.state !== state;
    state = res.state;
    if (changed) notify(res.effects);
    return res.effects;
  }

  function snapshot() {
    return state;
  }

  return {
    dispatch,
    state: snapshot,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    /** 只读断言（测试/Ego 用）：互斥组不变量 + 相位合法性。 */
    assert() {
      const bad = [];
      for (const g of GROUPS) {
        const live = g.filter(
          (id) => state.cards[id] && isLive(state.cards[id].phase),
        );
        if (live.length > 1) bad.push({ rule: 'mutex', group: g, live });
      }
      for (const id in state.cards) {
        if (!PHASE[state.cards[id].phase.toUpperCase()])
          bad.push({ rule: 'phase', id });
        if (
          state.cards[id].phase === PHASE.MINI &&
          (state.cards[id].offset.x || state.cards[id].offset.y)
        )
          bad.push({ rule: 'mini-offset', id });
      }
      return bad;
    },
  };
}

export { isLive, isAnimating, blankState };
