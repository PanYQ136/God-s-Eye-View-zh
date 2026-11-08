/* ============================================================================
   src/lc/interaction.js —— L5 Interaction（指针/键盘/wheel 的唯一入口）
   ----------------------------------------------------------------------------
   架构 §3.2 L5 / §9.1：
     · 真实 pointer press → move → up/cancel；不用 click 解析（补间中目标会跑掉）
     · 键盘 Esc / Enter / Space
     · wheel 归属（§5.3 滚动职责表）
     · 只产 action（dispatch），**不碰 DOM 状态**（不改 class / 不写几何）
   ========================================================================== */
import { ACT } from './controller.js';
import { PHASE } from './controller.js';
import {
  HEAD_SEL,
  HEAD_NO_TOGGLE,
  HEAD_TOGGLE_SELF,
  INTERACTIVE,
} from './cards.js';

const DRAG_THRESHOLD = 6;

export function createInteraction({ dispatch, phaseOf, onDrag }) {
  let press = null; // {id, x, y, pointerId, t, kind:'card'|'outside', header, draggable}
  let drag = null; // {id, lastX, lastY}

  const clear = () => {
    press = null;
    drag = null;
  };

  /**
   * 纯分类（无副作用，导出给单测）：这个 target 上的按下算「切卡」还是「控件」。
   * @returns {{header:boolean, draggable:boolean}|null} null = 不是切换热区
   */
  function classifyTarget(t, phase) {
    if (!t || !t.closest) return null;
    const isToggleSelf = !!t.closest(HEAD_TOGGLE_SELF);
    if (!isToggleSelf) {
      /* 标题里任何按钮/输入都不是「切卡」热区（.scene-shot-btn 这种漏登记 class 也兜住） */
      if (t.closest(HEAD_NO_TOGGLE) || t.closest('button')) return null;
    }
    if (t.closest(HEAD_SEL))
      return { header: true, draggable: phase === PHASE.OPEN };
    if (phase === PHASE.MINI) {
      /* mini 态：整张卡就是一条标题条（内部控件除外） */
      if (t.closest(INTERACTIVE) && !isToggleSelf) return null;
      return { header: true, draggable: false };
    }
    return null; // 展开态只有 header 是热区
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const cardEl =
      e.target && e.target.closest ? e.target.closest('.gev-lc') : null;
    if (!cardEl || !cardEl.id) {
      press = {
        id: null,
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
        t: e.timeStamp,
        kind: 'outside',
      };
      return;
    }
    const id = cardEl.id;
    const phase = phaseOf(id);
    const k = classifyTarget(e.target, phase);
    if (!k) {
      /* 点的是卡内控件：既不是切换、也不算「点外」 */
      press = {
        id,
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
        t: e.timeStamp,
        kind: 'control',
      };
      return;
    }
    press = {
      id,
      x: e.clientX,
      y: e.clientY,
      pointerId: e.pointerId,
      t: e.timeStamp,
      kind: 'card',
      header: k.header,
      draggable: k.draggable,
    };
  }

  function onPointerMove(e) {
    if (!press || e.pointerId !== press.pointerId) return;
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    if (!drag && press.draggable && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      drag = { id: press.id, lastX: e.clientX, lastY: e.clientY };
      if (typeof onDrag === 'function') onDrag(press.id, true);
    }
    if (drag) {
      const mx = e.clientX - drag.lastX;
      const my = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      dispatch({ type: ACT.DRAG, id: drag.id, dx: mx, dy: my });
      e.preventDefault();
    }
  }

  function onPointerUp(e) {
    if (
      !press ||
      (e.pointerId !== undefined && e.pointerId !== press.pointerId)
    ) {
      clear();
      return;
    }
    const dx = e.clientX - press.x;
    const dy = e.clientY - press.y;
    const moved = Math.hypot(dx, dy) > DRAG_THRESHOLD;
    if (drag) {
      dispatch({ type: ACT.DRAG_END, id: drag.id });
      if (typeof onDrag === 'function') onDrag(drag.id, false);
      clear();
      return;
    }
    if (!moved) {
      if (press.kind === 'card') dispatch({ type: ACT.ACTIVATE, id: press.id });
      else if (press.kind === 'outside') dispatch({ type: ACT.CLICK_OUTSIDE });
    }
    clear();
  }

  function onPointerCancel() {
    if (drag) {
      dispatch({ type: ACT.DRAG_END, id: drag.id });
      if (typeof onDrag === 'function') onDrag(drag.id, false);
    }
    clear();
  }

  function onKeyDown(e) {
    const t = e.target;
    const cardEl = t && t.closest ? t.closest('.gev-lc') : null;
    if (e.key === 'Escape') {
      /* 卡内输入框优先（用户正在输入位置搜索等）*/
      if (t && t.closest && t.closest('input,select,textarea')) return;
      dispatch({
        type: ACT.ESC,
        id: cardEl && cardEl.id ? cardEl.id : undefined,
      });
      return;
    }
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    if (!cardEl || !cardEl.id) return;
    if (t.closest(HEAD_NO_TOGGLE)) return;
    if (!t.closest(HEAD_SEL)) return;
    if (e.repeat) return;
    e.preventDefault();
    e.stopPropagation();
    dispatch({ type: ACT.ACTIVATE, id: cardEl.id });
  }

  function onWheel(e) {
    const cardEl =
      e.target && e.target.closest ? e.target.closest('.gev-lc') : null;
    if (!cardEl || !cardEl.id) return;
    const phase = phaseOf(cardEl.id);
    /* §5.3：mini / opening / closing 一律吞掉（不滚内容、不穿透地图） */
    if (phase !== PHASE.OPEN) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    /* open：卡壳是唯一滚动容器；内层有 data-lc-scroll 的交给它自己 */
    const inner = e.target.closest('[data-lc-scroll]');
    e.stopPropagation();
    if (inner && inner !== cardEl) {
      const canScroll = inner.scrollHeight > inner.clientHeight + 2;
      const atTop = inner.scrollTop <= 0;
      const atBottom =
        inner.scrollTop + inner.clientHeight >= inner.scrollHeight - 1;
      if (
        canScroll &&
        !((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom))
      ) {
        return; // 内层自己滚（不 preventDefault）
      }
    }
    const step = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const before = cardEl.scrollTop;
    cardEl.scrollTop = before + step;
    e.preventDefault();
  }

  function onDocumentClick(e) {
    /* App 第二个 owner 的「灭口」：标题条的 click 不得再改 .collapsed。
       披露按钮已由 externalDisclosure 解绑，这里是兜底（不计为状态写入）。 */
    const t = e.target;
    if (!t || !t.closest) return;
    const cardEl = t.closest('.gev-lc');
    if (!cardEl) return;
    if (t.closest(HEAD_NO_TOGGLE)) return;
    /* 披露按钮（UiPanelToggle / PanelCollapseButton）自己带 Vue handler：
       它不在 HEAD_TOGGLE_SELF 里（不是 pointerdown 驱动的整卡热区），
       灭口会让它的 click 彻底收不到，折叠按钮静默失效。
       dock 的 .location-bar-toggle / .dock-tray-toggle 仍走 pointerdown，保持灭口。 */
    const disclosure = t.closest('.panel-collapse-btn');
    if (disclosure && !disclosure.matches(HEAD_TOGGLE_SELF)) return;
    if (t.closest(HEAD_SEL)) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function')
        e.stopImmediatePropagation();
    }
  }

  function bind(target = document) {
    const opts = { capture: true, passive: false };
    target.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerCancel, true);
    target.addEventListener('keydown', onKeyDown, true);
    target.addEventListener('wheel', onWheel, opts);
    target.addEventListener('click', onDocumentClick, true);
    return () => {
      target.removeEventListener('pointerdown', onPointerDown, {
        capture: true,
      });
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp, true);
      window.removeEventListener('pointercancel', onPointerCancel, true);
      target.removeEventListener('keydown', onKeyDown, true);
      target.removeEventListener('wheel', onWheel, opts);
      target.removeEventListener('click', onDocumentClick, true);
    };
  }

  return {
    bind,
    classifyTarget,
    state: () => ({ press: press && { ...press }, drag: drag && { ...drag } }),
  };
}

export default { createInteraction };
