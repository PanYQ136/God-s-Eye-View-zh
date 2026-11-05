<<<<<<< ours
/** Own panel collapsed-state preferences and the one-time layout-reset notice. */
import { t } from '../i18n/index.js';
import { readPanelState } from './rail/panelState.js';
/** Versioned localStorage namespace prefix to invalidate stale panel layouts. */
const PANEL_LAYOUT_STORAGE_VERSION = 'v6';
/**
 * Position keys are versioned separately from collapsed-state keys. The rails
 * now lay panels out themselves and store no position; the version still names
 * the layout-reset notice and the documented key.
 */
const PANEL_POSITION_STORAGE_VERSION = 'v8';
/** Floating panels' stored positions and hint flag: nothing reads them now. */
const RETIRED_PANEL_KEY_PREFIXES = [
  `godsEyeView.${PANEL_POSITION_STORAGE_VERSION}.panelPos.`,
  `godsEyeView.${PANEL_POSITION_STORAGE_VERSION}.panelFloatHintShown`,
];
export class PanelPositionControls {
  constructor({ presentPanel, shownPanel = readPanelState, showToast }) {
    this._presentPanel = presentPanel;
    this._shownPanel = shownPanel;
    this._showToast = showToast;
  }

=======
/** Own panel disclosure persistence and the one-time layout-reset notice.
 *
 *  Phase 3（2026-10-29）：旧「自由拖拽 / 缩放 / z 轴提升 / 位置持久化」整层删除。
 *  7 张卡（以及其它面板）的几何只由 src/lc/layout.js + render.js 写入；
 *  任何在此文件里写 left/top 的路径都会和 Renderer 的 fixed 盒模型打架。
 */
/** Versioned localStorage namespace prefix to invalidate stale panel layouts. */
const PANEL_LAYOUT_STORAGE_VERSION = 'v6';
/** Legacy position-key version. No longer written — only swept once on upgrade. */
const PANEL_POSITION_STORAGE_VERSION = 'v8';
export class PanelPositionControls {
  constructor({ syncPanelDisclosureState, showToast } = {}) {
    this._syncPanelDisclosureState = syncPanelDisclosureState;
    this._showToast = showToast;
    this.removers = [];
    this.destroyed = false;
  }
  listen(target, type, callback) {
    if (this.destroyed || !target) return;
    const listener = (event) => {
      if (!this.destroyed) callback(event);
    };
    target.addEventListener(type, listener);
    this.removers.push(() => target.removeEventListener(type, listener));
  }
>>>>>>> theirs
  _maybeNotifyLayoutReset() {
    this._dropRetiredPanelKeys();
    try {
      const marker = `godsEyeView.${PANEL_POSITION_STORAGE_VERSION}.layoutResetNotified`;
      if (localStorage.getItem(marker)) return;
      localStorage.setItem(marker, '1');
      const hadOldPositions = Object.keys(localStorage).some((key) =>
        key.startsWith(
          `godsEyeView.${PANEL_POSITION_STORAGE_VERSION}.panelPos.`,
        ),
      );
      if (hadOldPositions) {
<<<<<<< ours
        this._showToast(
          t('Panel layout updated — positions reset to new defaults'),
=======
        this._showToast?.(
          'Panel layout updated — positions reset to new defaults',
>>>>>>> theirs
        );
      }
    } catch {
      // storage unavailable
    }
  }
<<<<<<< ours

  _dropRetiredPanelKeys() {
    try {
      for (const key of Object.keys(localStorage))
        if (RETIRED_PANEL_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)))
          localStorage.removeItem(key);
    } catch {
      // storage unavailable
    }
  }

=======
>>>>>>> theirs
  _panelCollapseStorageKey(panelId) {
    return `godsEyeView.${PANEL_LAYOUT_STORAGE_VERSION}.panelCollapsed.${panelId}`;
  }
  _restorePanelCollapsedState(panelId, { allowStored = true } = {}) {
    const panelEl = document.getElementById(panelId);
    if (!panelEl) return;
    let collapsed = this._shownPanel(panelEl).collapsed;
    let stored = null;
    if (allowStored) {
      try {
        stored = localStorage.getItem(this._panelCollapseStorageKey(panelId));
        if (stored === '1') collapsed = true;
        if (stored === '0') collapsed = false;
      } catch {
        // storage unavailable
      }
    }
    if (panelId === 'pp-toggles' && stored === null) collapsed = true;
    this._presentPanel(panelEl, { collapsed });
    // Bodies that expand themselves on first appearance must not override a
    // choice the user (or a share link) already made.
    if (panelEl.dataset)
      panelEl.dataset.collapsedPreference = !allowStored
        ? 'share'
        : stored === null
          ? 'default'
          : 'stored';
<<<<<<< ours
=======
    this._syncPanelDisclosureState?.(panelEl);
>>>>>>> theirs
  }
  _savePanelCollapsedState(panelId, collapsed) {
    try {
      localStorage.setItem(
        this._panelCollapseStorageKey(panelId),
        collapsed ? '1' : '0',
      );
    } catch {
      // storage unavailable
    }
  }
<<<<<<< ours
=======
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const remove of this.removers.splice(0)) remove();
  }
>>>>>>> theirs
}
