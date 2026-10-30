/* ============================================================================
   src/lc/cards.js —— 卡片层唯一配置源（controller / layout / adapter 共用）
   ----------------------------------------------------------------------------
   架构 §4.4 / §5.1：互斥组、轨道归属、展开目标尺寸只在这里定义一次。
   任何模块不得再写一份 CARDS / GROUPS / HEAD_SEL。
   ========================================================================== */

/** 8 张卡（gev-gfx-fab 只上玻璃皮、不展开 → expandable:false）。 */
export const CARDS = Object.freeze({
  'data-panel': { expW: 320, expH: 380, rail: 'left', expandable: true },
  'scene-panel': { expW: 320, expH: 340, rail: 'left', expandable: true },
  'pp-toggles': { expW: 300, expH: 430, rail: 'right', expandable: true },
  'cctv-panel': { expW: 340, expH: 430, rail: 'right', expandable: true },
  'global-context-panel': {
    expW: 320,
    expH: 400,
    rail: 'right',
    expandable: true,
  },
  'location-bar': { expW: 380, expH: 240, rail: 'dock', expandable: true },
  'control-panel': { expW: 520, expH: 380, rail: 'dock', expandable: true },
  'gev-voice-control': { expW: 260, expH: 240, rail: 'dock', expandable: true },
  'gev-gfx-fab': { expW: 0, expH: 0, rail: 'chrome', expandable: false },
});

export const CARD_IDS = Object.freeze(
  Object.keys(CARDS).filter((id) => CARDS[id].expandable),
);

/** 互斥组（§4.4）：每组同时最多 1 张 opening/open。 */
export const GROUPS = Object.freeze([
  Object.freeze(['location-bar', 'control-panel', 'gev-voice-control']),
  Object.freeze(['pp-toggles', 'cctv-panel', 'global-context-panel']),
  Object.freeze(['data-panel', 'scene-panel']),
]);

export const railOf = (id) => (CARDS[id] && CARDS[id].rail) || null;
export const groupOf = (id) => GROUPS.find((g) => g.includes(id)) || [id];

/** 标题命中选择器（真实用户点这里 = 切换开合）。 */
export const HEAD_SEL =
  '.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle,' +
  '.location-toolbar,.panel-title,.pp-header-label,.location-toolbar-label,' +
  '.gev-voice-heading,.gev-voice-readout';

/** 标题区域内仍属内部控件：点了不切换卡片。 */
export const HEAD_NO_TOGGLE =
  'input,select,textarea,a,label,[role=slider],[contenteditable],' +
  '.pp-slider,.pp-select,.pp-mode-btn,.dock-pin-btn,' +
  '[data-no-toggle],.style-btn,.pp-toggle-btn,.scene-btn,.scene-shot-btn,.map-stack-chip,' +
  '.context-mode-button,.search-toggle-btn,.cctv-cal-btn,.context-radio-dock,.context-radio-toggle,' +
  '.context-radio-mini,.gev-voice-tier-btn,.gev-voice-cost-value,.gev-voice-error-dismiss';

/** 本身「就是」切换按钮的元素：它们虽然是 <button>，但必须算标题热区。 */
export const HEAD_TOGGLE_SELF =
  '.dock-tray-toggle,.location-bar-toggle,button.panel-header';

/** mini 态里任何交互控件都不该触发「整卡=标题」的切换。 */
export const INTERACTIVE =
  'button,input,select,textarea,a,label,[role=slider],.pp-slider,.pp-select,.pp-mode-btn,' +
  '[data-no-toggle],.style-btn,' +
  '.pp-toggle-btn,.scene-btn,.scene-shot-btn,.map-stack-chip,.context-radio-dock,' +
  '.context-radio-toggle,.context-radio-mini';

/** 布局几何常量（§5.2 / §5.4，唯一一份）。 */
export const GEO = Object.freeze({
  MIN_W: 150,
  MIN_H: 44,
  MIN_EXP_H: 180, // 展开卡收缩下限（低于它就一直内容滚动）
  GAP: 8, // 卡与卡最小间隙
  SAFE_TOP: 84,
  SAFE_BOTTOM: 158,
  EDGE: 12, // 视口安全边
  DOCK_LIFT: 12, // 面板底边 = dock.top − 12
  PANEL_MIN_W: 320,
  PANEL_MAX_W: 560,
  PANEL_MIN_H: 88, // 面板高度贴合内容的下限（mini 高 86 + 2），不再留 140 的空白底
  PANEL_EDGE: 12,
});

/** 固定 chrome：展开卡与让位卡都不得压住它们（面积容差见 layout OVERLAP_TOL）。 */
export const PROTECT_IDS = Object.freeze([
  'gev-gfx-fab',
  'style-indicator',
  'top-center-actions',
  'gev-perf-wrap',
  'key-setup-chip',
  'gev-lang-toggle',
  'gev-locate-btn',
]);

/** 持久化键：只存几何（offset），不存形态（D1 初始全 mini）。 */
export const STORE_KEY = 'gev-lc:geom:v1';
