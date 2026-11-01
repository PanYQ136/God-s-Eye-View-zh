/* ============================================================================
   src/lc/dock-overlay.js —— L2c DockOverlay（dock 组展开面板的唯一几何）
   ----------------------------------------------------------------------------
   架构 §14.2：
     D2 面板居中在语音栏上方：x = dock.cx − w/2（容差 2px）、bottom = dock.top − 12；
        w = clamp(320, min(dock.w, 560), viewport.w − 24)；
        h = clamp(MIN_H, contentH, dock.top − SAFE_TOP − 12) —— 越界由面板自己滚。
     D3 只有一种形态（.dock-panel）；D5 高度由内容决定（无空玻璃块）。
   纯函数：不读 rect、不写 DOM；`form` 只有一个值。
   ========================================================================== */
import { GEO } from './cards.js';

export const DOCK_FORM = 'single';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * @param {object} p
 * @param {{x:number,y:number,w:number,h:number,cx?:number,top?:number}|null} p.dock
 * @param {number} p.contentH 内容自然高度（app-adapter 量到的 scrollHeight）
 * @param {{w:number,h:number}} p.viewport
 * @param {{top:number}} [p.safe]
 * @returns {{x:number,y:number,w:number,h:number,radius:number}|null}
 */
export function dockPanelBox({ dock, contentH, viewport, safe, protect = [] }) {
  if (!dock || !viewport) return null;
  const vw = viewport.w;
  const cx = Number.isFinite(dock.cx) ? dock.cx : dock.x + dock.w / 2;
  const dockTop = Number.isFinite(dock.top) ? dock.top : dock.y;
  const safeTop = (safe && Number(safe.top)) || GEO.SAFE_TOP;

  const wMax = Math.max(GEO.PANEL_MIN_W, vw - 2 * GEO.PANEL_EDGE);
  const w = Math.round(
    clamp(Math.min(dock.w, GEO.PANEL_MAX_W), GEO.PANEL_MIN_W, wMax),
  );
  const x = Math.round(
    clamp(
      cx - w / 2,
      GEO.PANEL_EDGE,
      Math.max(GEO.PANEL_EDGE, vw - GEO.PANEL_EDGE - w),
    ),
  );

  /* P0-3：高度贴合内容。底界不是「dock 顶边」而是「dock 顶边与横向重叠的固定 chrome 顶边取小」——
     dock 上方那一排 chip（perf / 语言 / 定位 / 语音）是常驻 chrome，面板压上去就是遮挡。 */
  let floor = dockTop;
  for (const r of protect) {
    if (!r || !(r.w > 1) || !(r.h > 1)) continue;
    if (r.id === 'command-dock') continue;
    const xOver = Math.min(x + w, r.x + r.w) - Math.max(x, r.x);
    if (xOver <= 8) continue;
    if (r.y + r.h <= safeTop + 1) continue; // 安全区之上，不算遮挡
    if (r.y >= dockTop) continue; // dock 之下
    floor = Math.min(floor, r.y);
  }
  const bottom = Math.round(floor - GEO.DOCK_LIFT);
  const maxH = Math.max(GEO.PANEL_MIN_H, bottom - safeTop);
  const want = Math.round(Number(contentH) || GEO.PANEL_MIN_H);
  const h = Math.round(clamp(want, GEO.PANEL_MIN_H, maxH));
  const y = Math.round(
    clamp(bottom - h, safeTop, Math.max(safeTop, viewport.h - h - GEO.EDGE)),
  );

  return { x, y, w, h, radius: 16 };
}

export default { dockPanelBox, DOCK_FORM };
