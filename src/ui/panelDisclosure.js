import { get as bridgeGet } from '../bridge.js';

/** Track listeners so a discarded controller leaves no active DOM callbacks. */
function listenerScope() {
  const removers = [];
  return {
    listen(target, type, callback, options) {
      if (!target) return;
      target.addEventListener(type, callback, options);
      removers.push(() => target.removeEventListener(type, callback, options));
    },
    destroy() {
      for (const remove of removers.splice(0)) remove();
    },
  };
}

/**
 * Bind bubbling Escape to an existing panel. Its collapse buttons are views
 * that ask the panel's owner to toggle it (PanelCollapseButton).
 */
export function bindPanelDisclosure({ panel, onEscape, ...retired }) {
  if (!panel || typeof onEscape !== 'function') {
    throw new TypeError('Panel disclosure requires a panel and onEscape');
  }
  // Buttons are views now; a caller still passing them would lose its clicks.
  if ('buttons' in retired || 'onChange' in retired) {
    throw new TypeError(
      'Panel disclosure binds Escape only; render the buttons as views',
    );
  }
  const scope = listenerScope();
  scope.listen(panel, 'keydown', onEscape);
  return { destroy: () => scope.destroy() };
}

/**
 * Close the nearest expanded panel and return focus to its disclosure, or to
 * `returnFocusTo()` when that names a control (a rail item standing in for a
 * panel that collapsing hid).
 */
export function collapsePanelOnEscape(
  event,
  { panel, onChange, beforeCollapse, returnFocusTo },
) {
  if (event.key !== 'Escape' || event.defaultPrevented) return false;
  if (
    !panel ||
    panel.classList.contains('collapsed') ||
    !panel.contains(event.target)
  )
    return false;
  const focusedPanel = event.target?.closest?.(
    '.panel-collapsible:not(.collapsed), #param-slider-panel:not(.collapsed)',
  );
  if (focusedPanel && focusedPanel !== panel) return false;
  event.preventDefault();
  event.stopPropagation();
  beforeCollapse?.();
  onChange(true, { explicit: true });
  const stand = returnFocusTo?.();
  if (stand) {
    stand.focus?.({ preventScroll: true });
    return true;
  }
  const disclosure =
    panel.querySelector(`[data-dock-toggle-target="${panel.id}"]`) ||
    panel.querySelector(`[data-collapse-target="${panel.id}"]`);
  const escapedFromDisclosure =
    event.target === disclosure || disclosure?.contains?.(event.target);
  if (escapedFromDisclosure) disclosure?.blur?.();
  else disclosure?.focus?.({ preventScroll: true });
  return true;
}

/**
 * Own hover/focus timing for an existing dock tray. Application callbacks own
 * collapsed state and optional content focus; destroying cancels every timer
 * and listener without changing saved state or moving focus.
 */
export function createHoverDisclosure({
  panel: panelEl,
  disclosure = null,
  onChange,
  onEscape,
  focusTarget = null,
  isActive = () => true,
  openDelayMs = 850,
  closeDelayMs = 1000,
  documentRef = panelEl?.ownerDocument,
}) {
  if (
    !panelEl ||
    !documentRef ||
    typeof onChange !== 'function' ||
    typeof onEscape !== 'function'
  ) {
    throw new TypeError(
      'Hover disclosure requires a panel, document, onChange and onEscape',
    );
  }
  const document = documentRef;
  const window = document.defaultView;
  const clearTimeout = window.clearTimeout.bind(window);
  const performance = window.performance;
  const scope = listenerScope();
  const listen = scope.listen;
  /* LC 层接管开合（挂载时给卡片打 .gev-lc，并在 document 捕获期把 HEAD_SEL 的
     点击整体收走）之后，App 侧不能再写一次 collapsed —— 那是同一状态的两个写者：
     点击被 App 的 onChange 与 LC 的 ACTIVATE 各翻译一次，最终 phase 会反着落。
     点击/键盘入口统一留给 LC；hover 计时仍归 App（LC 没有 hover 能力）。 */
  const lcOwned = () => !!panelEl.classList.contains('gev-lc');
  /* LC 接管后，hover 展开也归它：App 写 store 而 LC 的 phase 仍是 mini，
     就是同一状态的两个真值（点击 header 时 LC 会当成「没开」再开一次）。 */
  const lcActivate = () => {
    let api = null;
    try {
      api = bridgeGet('lc.api');
    } catch {
      api = null;
    }
    if (!api || typeof api.dispatch !== 'function') return false;
    api.dispatch({ type: 'ACTIVATE', id: panelEl.id });
    return true;
  };
  /* 这次展开是不是 hover 打开的：只有 hover 打开的才该被 hover 离开关掉。
     点击打开后指针因为展开动画被判定离开又回来时，closeTimer 不会被
     pointerenter 清掉（指针没动），于是刚点开的卡会在 ~486ms 后自己关上。 */
  let hoverOpened = false;
  let destroyed = false;
  let openTimer = null;
  let closeTimer = null;
  let lastWheelTime = 0;
  let disclosureFocusTimer = null;
  let focusRequest = 0;

  const cancelPendingFocus = () => {
    clearTimeout(disclosureFocusTimer);
    disclosureFocusTimer = null;
    focusRequest += 1;
  };

  const clearOpen = () => {
    if (!openTimer) return;
    clearTimeout(openTimer);
    openTimer = null;
  };

  const clearClose = () => {
    if (!closeTimer) return;
    clearTimeout(closeTimer);
    closeTimer = null;
  };

  const scheduleOpen = () => {
    clearOpen();
    openTimer = window.setTimeout(() => {
      openTimer = null;
      if (destroyed || !isActive()) return;
      if (!panelEl.matches(':hover')) return;
      if (performance.now() - lastWheelTime < 280) return;
      if (!panelEl.classList.contains('collapsed')) return;
      hoverOpened = lcOwned() ? lcActivate() : true;
      if (!lcOwned()) onChange(false);
    }, openDelayMs);
  };

  // Focus inside the tray defers the unpinned auto-dismiss, but only for the
  // KEYBOARD: the disclosure hands focus to a Map Source tile on Enter/Space,
  // and closing the tray out from under that focus would strand the caret.
  // Plain `document.activeElement` is the wrong test — Chromium focuses a
  // <button> on mouse press, so once Map Source moved into this tray a tile
  // CLICK left focus parked inside and the popover never dismissed on
  // mouse-away (owner field report; Location, whose input is genuinely
  // keyboard-focused when clicked, still dismissed). `:focus-visible` is the
  // platform's own pointer-vs-keyboard focus signal, so a typed-into field
  // still holds the tray open while a clicked tile does not. A browser
  // without `:focus-visible` keeps the conservative hold.
  const keyboardFocusInside = () => {
    const active = document.activeElement;
    if (!active || !panelEl.contains(active)) return false;
    try {
      return active.matches(':focus-visible');
    } catch {
      return true;
    }
  };

  const scheduleClose = () => {
    clearClose();
    closeTimer = window.setTimeout(() => {
      closeTimer = null;
      if (destroyed || !isActive()) return;
      if (panelEl.matches(':hover') || keyboardFocusInside()) return;
      if (panelEl.classList.contains('dock-pinned')) return;
      if (panelEl.classList.contains('collapsed')) return;
      onChange(true);
    }, closeDelayMs);
  };

  listen(
    panelEl,
    'wheel',
    () => {
      lastWheelTime = performance.now();
      clearOpen();
    },
    { passive: true },
  );

  listen(panelEl, 'click', (event) => {
    if (event.target.closest('.panel-collapse-btn, .dock-tray-toggle')) return;
    clearOpen();
    clearClose();
    if (lcOwned()) return;
    if (panelEl.classList.contains('collapsed')) {
      onChange(false, { explicit: true });
    }
  });

  listen(panelEl, 'pointerenter', (event) => {
    const pointerType = event.pointerType || 'mouse';
    if (pointerType !== 'mouse' && pointerType !== 'pen') return;
    clearClose();
    if (panelEl.classList.contains('collapsed')) {
      scheduleOpen();
    }
  });

  listen(panelEl, 'pointerleave', (event) => {
    const pointerType = event.pointerType || 'mouse';
    if (pointerType !== 'mouse' && pointerType !== 'pen') return;
    clearOpen();
    if (!hoverOpened) return; // 点击打开的卡归 LC 的点击外部/Escape 关
    scheduleClose();
  });

  listen(panelEl, 'pointerdown', () => {
    hoverOpened = false;
    cancelPendingFocus();
    clearOpen();
    clearClose();
  });

  const focusContent = () => {
    const target = focusTarget?.();
    if (destroyed || !isActive() || !target?.focus) return false;
    target.focus({ preventScroll: true });
    return document.activeElement === target;
  };

  // The tray opens behind a 180ms `visibility` transition (.dock-popover-content
  // in style.css), and a chip inside it cannot take focus until that lands.
  // A single fixed delay therefore races the transition: when the machine is
  // slow enough that the fade has not finished by the time the timer fires,
  // focus() silently does nothing and the keyboard user is stranded on the
  // disclosure with an open tray they cannot reach (#54). Retry on a short
  // cadence until focus actually lands, bounded so a permanently hidden tray
  // cannot spin.
  const scheduleContentFocus = () => {
    cancelPendingFocus();
    if (destroyed || !isActive() || !focusTarget) return;
    const request = focusRequest;
    let attempts = 0;
    const attemptFocus = () => {
      if (request !== focusRequest) return;
      disclosureFocusTimer = null;
      if (destroyed || !isActive() || panelEl.classList.contains('collapsed'))
        return;
      // A Tab or click elsewhere owns focus now. A delayed transition must
      // not pull the keyboard back into a tray the user has already left.
      if (document.activeElement !== disclosure) return;
      if (focusContent()) return;
      if (request !== focusRequest) return;
      if (++attempts > 24) return; // ~720ms past the first try, then give up
      disclosureFocusTimer = window.setTimeout(attemptFocus, 30);
    };
    disclosureFocusTimer = window.setTimeout(attemptFocus, 240);
  };

  const toggleDisclosure = ({ focusContent = false } = {}) => {
    if (destroyed || !isActive()) return;
    if (lcOwned()) return; // 开合的唯一写者是 LC 状态机，App 侧不再二次翻译
    cancelPendingFocus();
    clearOpen();
    clearClose();
    const shouldOpen = panelEl.classList.contains('collapsed');
    onChange(!shouldOpen, { explicit: true });
    if (shouldOpen && focusContent) scheduleContentFocus();
  };

  listen(disclosure, 'click', (event) => {
    event.stopPropagation();
    // Keep native button activation semantics: Enter activates on keydown,
    // Space on keyup, and pointer clicks report a non-zero detail. Scheduling
    // focus from the synthesized click avoids a key latch that can outlive the
    // disclosure after a long Enter hold moves focus into the tray.
    toggleDisclosure({ focusContent: event.detail === 0 });
  });
  listen(disclosure, 'keydown', (event) => {
    if (event.key !== 'Enter') return;
    /* LC 接管后键盘也不在这里 toggle：拦掉默认行为就等于抢走了 native click，
       LC 再也收不到那次激活（表现为「键盘能开、鼠标点关不掉」）。放行浏览器
       派发 click，由 LC 的 HEAD_SEL 分类统一处理。 */
    if (lcOwned()) return;
    // Preserve immediate Enter activation while leaving Space to the native
    // button path, which emits its synthesized click only after key release.
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    toggleDisclosure({ focusContent: true });
  });

  listen(panelEl, 'focusin', () => clearClose());
  listen(panelEl, 'focusout', (event) => {
    cancelPendingFocus();
    if (panelEl.contains(event.relatedTarget)) return;
    if (!hoverOpened) return;
    scheduleClose();
  });
  listen(panelEl, 'keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!event.defaultPrevented) onEscape(event);
    cancelPendingFocus();
    clearOpen();
    clearClose();
  });
  return {
    cancelPendingFocus,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearOpen();
      clearClose();
      cancelPendingFocus();
      scope.destroy();
    },
  };
}
