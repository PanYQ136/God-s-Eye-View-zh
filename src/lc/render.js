/* ============================================================================
   src/lc/render.js —— L2 Renderer（单帧应用 Box；只写一次）
   ----------------------------------------------------------------------------
   架构 §3.2 L2：
     apply(map<id,Box>) → 相位属性 + inline 几何（一次）+ WAAPI 编排
     内容层不动（不改 App 内部 DOM 结构、不加底、不加 blur）
   本模块是卡片几何的**唯一写入者**；动画只走 morph.js（同一元素永远 ≤1 条）。
   ========================================================================== */
import * as Morph from './morph.js';
import { CARDS, CARD_IDS } from './cards.js';
import { PHASE } from './controller.js';

const px = (v) => Math.round(v) + 'px';
const same = (a, b, tol = 1) => !!a && !!b && Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.w - b.w) <= tol && Math.abs(a.h - b.h) <= tol;
/** snapshot 用 {x,y,w,h}；Morph 用 {left,top,width,height}（FLIP 起点）。 */
const toFlip = (r) => (r ? { left: r.x, top: r.y, width: r.w, height: r.h } : null);

export function createRenderer({ adapter, onAnimEnd, morph = Morph }) {
  const prev = new Map(); // id → {phase, box, push, staged}
  const anims = new Map(); // id → Animation
  const stats = { opens: 0, closes: 0, pushAnims: 0, writes: 0 };

  function rec(id) {
    if (!prev.has(id)) prev.set(id, { phase: PHASE.MINI, box: null, push: { x: 0, y: 0 }, staged: false });
    return prev.get(id);
  }

  function writeBox(el, box) {
    el.style.position = 'fixed';
    el.style.left = px(box.x);
    el.style.top = px(box.y);
    el.style.width = px(box.w);
    el.style.height = px(box.h);
    el.style.maxHeight = 'none'; // 防 App 的「可用高度」内联规则把展开卡压扁
    el.style.minHeight = '0';
    el.style.transform = 'none';
    el.style.overflowY = 'auto';
    el.style.zIndex = String(box.z || 60);
    stats.writes += 1;
  }

  function clearBox(el) {
    for (const k of ['position', 'left', 'top', 'width', 'height', 'transform', 'overflowY', 'zIndex', 'willChange']) el.style[k] = '';
    el.style.maxHeight = '';
    el.style.minHeight = '';
  }

  function stopAnim(id) {
    const a = anims.get(id);
    if (a) {
      try {
        a.cancel();
      } catch (_) {}
      anims.delete(id);
    }
    morph.cancel(adapter.el(id));
  }

  /**
   * 一帧：把 layout 结果落到 DOM。
   * @param {object} p {snapshot, result, phases, gens}
   */
  function apply({ snapshot, result, phases, gens }) {
    const cards = snapshot.cards || {};
    for (const id of CARD_IDS) {
      const el = adapter.el(id);
      if (!el) continue;
      const phase = phases[id] || PHASE.MINI;
      const r = rec(id);
      const push = (result.pushes && result.pushes[id]) || { x: 0, y: 0 };
      const box = result.boxes && result.boxes[id];

      el.classList.add('gev-lc');
      el.dataset.lcRail = (CARDS[id] && CARDS[id].rail) || '';

      if (phase === PHASE.MINI) {
        if (r.staged) {
          /* ANIM_END 之后 render.finishClose 已经卸过；这里只是兜底 */
          adapter.unstageCard(id);
          r.staged = false;
        }
        el.dataset.lcPhase = PHASE.MINI;
        stopAnim(id);
        clearBox(el);
        /* 让位：mini 卡只改 --lc-push，transform 由 material.css 组合。
           注意顺序：先把 --lc-push 写成**最终值**，再让 transform 从 (旧−新) 动画到 0 ——
           否则 CSS 变量与 WAAPI transform 会叠加成 2×delta（视觉上先弹出去再回来）。 */
        const dPush = { x: push.x - r.push.x, y: push.y - r.push.y };
        el.style.setProperty('--lc-push-x', px(push.x));
        el.style.setProperty('--lc-push-y', px(push.y));
        if (Math.abs(dPush.x) > 0.5 || Math.abs(dPush.y) > 0.5)
          animatePush(el, { x: -dPush.x, y: -dPush.y }, { x: 0, y: 0 }, id, cards[id] && cards[id].mini);
        r.push = { x: push.x, y: push.y };
        r.phase = PHASE.MINI;
        r.box = null;
        continue;
      }

      if (phase === PHASE.CLOSING) {
        const target = box || (cards[id] && cards[id].mini) || r.box;
        if (!target) continue;
        if (!r.staged) {
          /* 从没展开过就收到 closing（异常）→ 直接回 mini */
          r.phase = PHASE.MINI;
          continue;
        }
        if (r.phase !== PHASE.CLOSING) {
          /* 开始关闭：inline 几何先落到 mini 目标，再用 FLIP 把视觉倒推回当前 */
          const from = toFlip((cards[id] && cards[id].visual) || r.box);
          writeBox(el, target);
          el.dataset.lcPhase = PHASE.CLOSING;
          playClose(id, el, from, target, gens[id]);
          stats.closes += 1;
        } else if (box && !same(r.box, box)) {
          writeBox(el, box); // 关途中窗口 resize：直接改目标
        }
        r.phase = PHASE.CLOSING;
        r.box = { ...target };
        continue;
      }

      /* opening / open */
      if (!box) continue;
      const from = toFlip((cards[id] && cards[id].visual) || box);
      if (!r.staged) {
        const mini = (cards[id] && cards[id].mini) || null;
        adapter.stageCard(id, mini);
        r.staged = true;
      }
      const changing = !same(r.box, box, 0.6);
      if (r.phase === PHASE.MINI || r.phase === PHASE.CLOSING || (r.phase !== phase && phase === PHASE.OPENING)) {
        writeBox(el, box);
        el.dataset.lcPhase = PHASE.OPENING;
        if ((CARDS[id] && CARDS[id].rail) === 'dock') el.classList.add('dock-panel');
        playOpen(id, el, from, box, gens[id]);
        stats.opens += 1;
      } else if (changing && !r.dragging) {
        writeBox(el, box);
        el.dataset.lcPhase = phase;
        playOpen(id, el, from, box, gens[id], { retarget: true });
      } else if (changing) {
        writeBox(el, box);
      }
      if (phase === PHASE.OPEN) el.dataset.lcPhase = PHASE.OPEN;
      if ((CARDS[id] && CARDS[id].rail) === 'dock') el.classList.add('dock-panel');
      r.dragging = !!r.dragging;
      r.phase = phase;
      r.box = { ...box };
    }
    /* 让位位移清 0（卡片已不在 mini）*/
    for (const id of CARD_IDS) {
      const r = rec(id);
      if ((phases[id] || PHASE.MINI) !== PHASE.MINI && (r.push.x || r.push.y)) {
        const el = adapter.el(id);
        if (el) {
          el.style.setProperty('--lc-push-x', '0px');
          el.style.setProperty('--lc-push-y', '0px');
        }
        r.push = { x: 0, y: 0 };
      }
    }
  }

  function playOpen(id, el, from, to, gen, opts = {}) {
    stopAnim(id);
    el.style.willChange = 'transform';
    const anim = morph.run(el, from, {
      id,
      to,
      target: { w: to.w, h: to.h },
      onFinish: () => {
        el.style.willChange = '';
        if (typeof onAnimEnd === 'function') onAnimEnd(id, gen);
      },
    });
    if (anim) anims.set(id, anim);
    if (opts.retarget) stats.opens += 0;
  }

  function playClose(id, el, from, to, gen) {
    stopAnim(id);
    el.style.willChange = 'transform';
    const anim = morph.run(el, from, {
      id,
      to,
      target: { w: to.w, h: to.h },
      onFinish: () => {
        el.style.willChange = '';
        if (typeof onAnimEnd === 'function') onAnimEnd(id, gen);
      },
    });
    if (anim) anims.set(id, anim);
  }

  function animatePush(el, fromPush, toPush, id, size) {
    if (!el) return;
    if (Math.abs(fromPush.y - toPush.y) < 0.5 && Math.abs(fromPush.x - toPush.x) < 0.5) return;
    const anim = morph.runShift(el, { from: fromPush, to: toPush, size });
    if (anim) stats.pushAnims += 1;
  }

  function pushesOf() {
    const out = {};
    for (const id of CARD_IDS) {
      const r = rec(id);
      out[id] = { x: r.push.x, y: r.push.y };
    }
    return out;
  }

  /** ANIM_END(closing) 后由宿主同步调用：立即回填槽位（不留给下一帧，避免一帧空壳）。 */
  function finishClose(id) {
    const r = rec(id);
    stopAnim(id);
    if (r.staged) {
      adapter.unstageCard(id);
      r.staged = false;
    }
    r.phase = PHASE.MINI;
    r.box = null;
    r.push = { x: 0, y: 0 };
    const el = adapter.el(id);
    if (el) {
      el.dataset.lcPhase = PHASE.MINI;
      el.style.setProperty('--lc-push-x', '0px');
      el.style.setProperty('--lc-push-y', '0px');
    }
  }

  /** App 把展开卡抢回轨道 → 重新脱层（renderer 拥有「展开卡必须在 stage」这条不变量）。 */
  function assertStaged(phases) {
    let fixed = 0;
    for (const id of CARD_IDS) {
      const r = rec(id);
      const phase = (phases && phases[id]) || r.phase;
      if (phase === PHASE.OPENING || phase === PHASE.OPEN) {
        if (adapter.isStaged(id)) continue;
        adapter.stageCard(id, r.box);
        if (r.box) writeBox(adapter.el(id), r.box);
        fixed += 1;
      }
    }
    return fixed;
  }

  return {
    apply,
    finishClose,
    assertStaged,
    pushesOf,
    stats: () => ({ ...stats }),
    record: (id) => ({ ...rec(id) }),
    setDragging: (id, v) => {
      const r = rec(id);
      r.dragging = !!v;
    },
    /** 只读：当前每张卡的动画数（T16 断言用）。 */
    animations: () => Object.fromEntries([...anims.entries()].map(([k, a]) => [k, a && a.playState])),
  };
}

export default { createRenderer };
