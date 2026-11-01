/**
 * worldOverlay 纯常量与纯比较/工具函数（问题清单 #17 · Phase8E）
 *
 * 从 `src/overlays/worldOverlay.js`（2,946 行）里切出两块**不碰渲染状态**的内容：
 *   ① 常量与选择器：根节点 id、绘制车道表、遮挡物选择器、容量/间隔阈值；
 *   ② 纯函数：时间戳、clamp、sourceId 断言、entry key、稳定比较器、
 *      池化区间插入排序、keyed index 摊还清理、默认碰撞组。
 *
 * 模块级可变状态（`_viewer`/`_canvas`/帧池/诊断计数/相机位姿）**没有**搬走：
 * 它们被原文件的几百个函数闭包读写，搬出去会变成「跨模块改 import 绑定」。
 * 所以这里只有 const 与纯函数，搬动后行为逐行不变。
 *
 * 回滚：把内容粘回 `worldOverlay.js` 对应位置、删掉那边的 import 即可。
 */
export const ROOT_ID = 'world-overlay-root';
export const CANVAS_ID = 'world-overlay-canvas';
export const DETECTION_SURFACE_ID = 'world-overlay-detection-surface';
export const ACCESSIBILITY_ROOT_ID = 'world-overlay-actions';
export const ACCESSIBILITY_LIST_ID = 'world-overlay-action-list';
export const ACCESSIBILITY_STATUS_ID = 'world-overlay-status';
export const PAINT_TARGET_SHARED = 'shared';
export const PAINT_TARGET_DETECTION = 'detection';
export const OCCLUDER_PADDING_PX = 6;
export const OCCLUDER_REFRESH_MS = 100;
export const DEFAULT_COHORT_LIMIT = 256;
export const MAX_SOURCE_COHORT_LIMIT = 900;
export const DEFAULT_COLLISION_CAPACITY = 96;
// Phase 4 adds CCTV's shipped 40-card ambient tier to Phase 3's two 96-card
// infrastructure budgets, FIRMS' 18, and the vessel selector's configured
// 900-row absolute ceiling. Runtime vessel demand is the much smaller 118px
// viewport grid (112 at 1600x900, 170 at full HD). This aggregate
// work-conserving ceiling preserves every source's shipped cap; pinned and
// active/protected entries bypass it.
export const AMBIENT_CARD_COLLISION_CAPACITY = 1150;
export const DEFAULT_MOVING_SOLVE_MS = 125;
export const VALID_VARIANTS = new Set([
  'label',
  'track',
  'card',
  'thumbnail',
  'selected',
  'tracked',
]);

/** Stable logical bottom-to-top paint order across the host-owned surfaces. */
export const WORLD_OVERLAY_PAINT_LANES = Object.freeze([
  'detection',
  'ambient-label',
  'ambient-track',
  'ambient-card',
  'thumbnail',
  'selected',
  'tracked',
]);

export const PAINT_LANE_INDEX = new Map(
  WORLD_OVERLAY_PAINT_LANES.map((lane, index) => [lane, index]),
);

/**
 * Unified UI exclusion inventory. Selectors may match multiple elements; the
 * service caches their rectangles and observes layout/visibility changes.
 *
 * These rectangles are a PLACEMENT policy, never a paint mask. Every element
 * listed here composites ABOVE the overlay host — map chrome sits at z90–z1000
 * and the cockpit HUD at z145, against this host's z5/z6 — so the browser
 * already keeps overlay pixels off it and no canvas needs clipping. What the
 * inventory buys is readability: a card placed under solid chrome is simply
 * lost, so the solver PREFERS placements clear of it. When nothing is clear the
 * entry still renders and the chrome covers it, exactly as it did before the
 * host existed.
 *
 * The list therefore holds only chrome dense enough to swallow a card. The
 * cockpit's thin translucent line art — rims, arcs, rails, tapes, toplines,
 * readouts — is deliberately ABSENT under the owner's AR-HUD ruling:
 * world-space overlay content renders beneath the cockpit's screen-space HUD,
 * which paints over it by z-order. Those elements are also enormous (the
 * altitude rim is keyhole-tall, the topline viewport-wide), and excluding them
 * suppressed essentially the entire cockpit view. Only the two solid,
 * backdrop-filled cockpit windows survive as exclusions.
 */
export const WORLD_OVERLAY_OCCLUDER_SELECTORS = Object.freeze([
  '#title-bar',
  '#style-indicator',
  '#top-center-actions',
  '#traffic-sync-chip',
  '#cctv-sync-chip',
  '#left-panel-stack',
  '#right-context-rail',
  '.weather-summary',
  '#pp-toggles',
  '#command-dock',
  '#gev-voice-control',
  '#cesium-credits',
  '.hud-top-left',
  '.hud-top-right',
  '.hud-bottom-left',
  '.hud-bottom-right',
  '.hud-top-bar',
  '.hud-bottom-bar',
  '#space-mission-panel',
  '#space-mission-panel-host',
  '#military-awareness-panel',
  '#bhote-koshi-event-panel',
  // Cockpit: solid backdrop-filled windows only (both bounded to
  // `min(340px, 28vw)` wide and `min(42vh, 410px)` tall, both `hidden` until
  // toggled). Every other cockpit selector was removed — see the block comment.
  '#cockpit-context',
  '#cockpit-signal-stream',
]);

export function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function clamp01(value, fallback = 1) {
  return Number.isFinite(Number(value))
    ? Math.max(0, Math.min(1, Number(value)))
    : fallback;
}

export function assertSourceId(sourceId) {
  if (typeof sourceId !== 'string' || !sourceId.trim()) {
    throw new TypeError('WorldOverlay sourceId must be a non-empty string');
  }
  return sourceId.trim();
}

export function entryKey(sourceId, entryId) {
  return `${sourceId}\u0000${entryId}`;
}

export function compareStableKeys(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareProtectedEntries(a, b) {
  return (
    b.priority - a.priority || compareStableKeys(a._overlayKey, b._overlayKey)
  );
}

export function compareProtectedCandidates(a, b) {
  return b.priority - a.priority || compareStableKeys(a.key, b.key);
}

export function comparePaintItems(a, b) {
  return (
    a.lane - b.lane || a.zIndex - b.zIndex || compareStableKeys(a.key, b.key)
  );
}

/**
 * Stable in-place insertion sort over the live prefix of a pooled array.
 * `Array#sort` allocates a work buffer per call; the frame path only ever
 * orders a short, nearly sorted prefix.
 */
export function sortPooledRange(items, count, compare) {
  for (let i = 1; i < count; i++) {
    const item = items[i];
    let j = i - 1;
    while (j >= 0 && compare(items[j], item) > 0) {
      items[j + 1] = items[j];
      j--;
    }
    items[j + 1] = item;
  }
}

/** Map#forEach callback that zeroes a demand tally without clearing the map. */
export function zeroDemandEntry(value, key, map) {
  map.set(key, 0);
}

/**
 * Amortized prune for a keyed index that is rebuilt every frame but only
 * grows when a source publishes new identities. Clearing unconditionally
 * reallocates the backing hash table per domain per frame, so the index is
 * dropped only once it dwarfs the live cohort — the same policy the arbiter
 * applies to its per-solve key stamps.
 * @param {Map<string, object>} index
 * @param {number} liveCount
 */
export function pruneKeyedIndex(index, liveCount) {
  if (index.size > liveCount * 4 + 64) index.clear();
}

export function defaultCollisionGroup(variant) {
  if (variant === 'label') return 'ambient-label';
  if (variant === 'track' || variant === 'tracked') return 'ambient-track';
  return 'ambient-card';
}
