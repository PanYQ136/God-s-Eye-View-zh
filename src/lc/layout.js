/* ============================================================================
   src/lc/layout.js —— L3 LayoutEngine（纯函数，零 DOM 读）
   ----------------------------------------------------------------------------
   架构 §5：
     输入 snapshot（只由 app-adapter.measure() 在测量帧产一次）→ 输出 Box。
     · 锚点取 mini（自然槽位），不用当前 rect
     · 左右轨道向下生长（贴自己的 header 顶边）；dock 组由 dock-overlay 统一居中
     · 同轨下方的迷你兄弟被「让位」（只 translate，不换槽位、不改尺寸）
     · 保护区（固定 chrome）相交 → 先收缩、再平移
     · 不变量（视口内 / 两两不重叠 / 让位后在视口内）在本模块里算出来，供 render 与应用层断言
   同输入必同输出：node --test 直接喂 12 组快照。
   ========================================================================== */
import { CARDS, GEO, CARD_IDS } from './cards.js';
import { dockPanelBox } from './dock-overlay.js';
import { PHASE } from './controller.js';

/** 面积容差：小于它不算「重叠」（避免 2px 边缘咬合被当成遮挡）。 */
export const OVERLAP_TOL = 64;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const live = (p) => p === PHASE.OPENING || p === PHASE.OPEN;

export function intersectArea(a, b) {
  if (!a || !b) return 0;
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return x * y;
}

const inside = (b, view) =>
  b.x >= 0 &&
  b.y >= 0 &&
  b.x + b.w <= view.w + 0.5 &&
  b.y + b.h <= view.h + 0.5;

/**
 * @param {object} snap
 * @returns {{boxes:Object,pushes:Object,dockPanel:object|null,violations:Array}}
 */
export function layout(snap) {
  const view = snap.viewport || { w: 0, h: 0 };
  const safe = snap.safe || {
    top: GEO.SAFE_TOP,
    bottom: GEO.SAFE_BOTTOM,
    left: 0,
    right: 0,
  };
  const cards = snap.cards || {};
  const phases = snap.phases || {};
  const offsets = snap.offsets || {};
  const order = snap.openOrder || [];
  const protAll = (snap.protected || []).filter((r) => r && r.w > 1 && r.h > 1);

  const boxes = {};
  const pushes = {};
  const violations = [];
  let dockPanel = null;

  const limitY = Math.max(safe.top + GEO.MIN_EXP_H, view.h - GEO.EDGE);

  const ids = CARD_IDS.filter(
    (id) => cards[id] && cards[id].connected !== false,
  );

  /* ── 1. 展开盒 ─────────────────────────────────────────────────────────── */
  for (const id of ids) {
    const phase = phases[id] || PHASE.MINI;
    const cfg = CARDS[id];
    if (!cfg || !cfg.expandable) continue;
    const c = cards[id];
    const mini = c.mini;
    if (!mini || !(mini.w > 1) || !(mini.h > 1)) continue;

    /* closing：动画目标就是自然槽位（回填） */
    if (phase === PHASE.CLOSING) {
      boxes[id] = {
        x: mini.x,
        y: mini.y,
        w: mini.w,
        h: mini.h,
        radius: 16,
        z: 40,
        phase,
      };
      continue;
    }
    if (!live(phase)) continue;

    if (cfg.rail === 'dock') {
      const panel = dockPanelBox({
        dock: snap.dock,
        contentH: c.contentH,
        viewport: view,
        safe,
        protect: protAll,
      });
      if (panel) {
        dockPanel = { id, ...panel, z: 80 };
        boxes[id] = {
          x: panel.x,
          y: panel.y,
          w: panel.w,
          h: panel.h,
          radius: 16,
          z: 80,
          phase,
          dock: true,
        };
      }
      continue;
    }

    /* 同轨、位于本卡下方的迷你兄弟：预留它们的高度（让位后仍在视口内） */
    let reserve = 0;
    for (const other of ids) {
      if (other === id) continue;
      const oc = cards[other];
      if (!oc || !oc.mini) continue;
      if (!CARDS[other] || CARDS[other].rail !== cfg.rail) continue;
      if ((phases[other] || PHASE.MINI) !== PHASE.MINI) continue;
      if (oc.mini.y > c.mini.y + 1) reserve += oc.mini.h + GEO.GAP; // 只预留「槽位在下方」的兄弟
    }

    let availH = Math.max(GEO.MIN_H, limitY - c.mini.y - reserve);
    /* G07：再受「宿主栈底」约束（limitH 由 adapter.measure 给出，已含 liftRails 位移）。
       只受视口 SAFE_BOTTOM 约束时，内容高的左卡会长出 #left-panel-stack 的可视底界。 */
    if (c.limitH > 0) availH = Math.min(availH, c.limitH);
    let h = Math.min(cfg.expH, availH);
    if (h < GEO.MIN_EXP_H) h = Math.max(120, Math.min(GEO.MIN_EXP_H, availH));
    let w = Math.min(cfg.expW, view.w - 2 * GEO.EDGE);

    /* G10：左轨向左取整、右轨从右边界回推 —— 两侧混用 round 会在 0.5 边界各漂 1px，
       连续 resize 往返后表现为可见的「热漂移」。
       Q1：右轨的右边界优先取 rail 容器的**实时**右缘（snap.rails，adapter 每测量帧现读），
       而不是 `c.mini.x + c.mini.w`。原因：同轨有卡展开时槽位按设计冻结不刷新，
       视口一变旧槽位不自愈，只剩 EDGE clamp 兜底 → 展开盒贴视口右缘 12px，
       与 mini 卡右对齐基准（rail 右界）错位。rail 边缘永不过期，且 mini 卡右缘本就贴它。
       无 rails 的快照（如单元测试喂的 12 组静态数据）自动回落到原 mini 锚，行为不变。 */
    const railRight =
      snap.rails && snap.rails.right && snap.rails.right.right > 0
        ? snap.rails.right.right
        : null;
    let x =
      cfg.rail === 'right'
        ? Math.floor((railRight != null ? railRight : c.mini.x + c.mini.w) - w)
        : Math.floor(c.mini.x);
    let y = Math.floor(c.mini.y);

    const off = offsets[id] || { x: 0, y: 0 };
    x += off.x || 0;
    y += off.y || 0;

    /* 视口钳制 */
    x = clamp(x, GEO.EDGE, Math.max(GEO.EDGE, view.w - GEO.EDGE - w));
    y = clamp(y, safe.top, Math.max(safe.top, limitY - h));

    /* 保护区：面积相交才处理（2px 咬合不算遮挡）。
       策略 = 「最小位移让开」（上/下/左/右里选位移最小的合法方向），
       而不是先判上下再判左右 —— 后者对「右侧常驻 chrome 从卡左边缘就开始」会误判成收高。 */
    const xMax = Math.max(GEO.EDGE, view.w - GEO.EDGE - w);
    const yMax = Math.max(safe.top, limitY - h);
    for (let round = 0; round < 4; round++) {
      const hit = protAll.find(
        (p) => intersectArea({ x, y, w, h }, p) > OVERLAP_TOL,
      );
      if (!hit) break;
      const opts = [
        { k: 'up', y: clamp(hit.y - GEO.GAP - h, safe.top, yMax) },
        { k: 'down', y: clamp(hit.y + hit.h + GEO.GAP, safe.top, yMax) },
        { k: 'left', x: clamp(hit.x - GEO.GAP - w, GEO.EDGE, xMax) },
        { k: 'right', x: clamp(hit.x + hit.w + GEO.GAP, GEO.EDGE, xMax) },
      ]
        .map((o) => ({
          ...o,
          d:
            Math.abs((o.x === undefined ? x : o.x) - x) +
            Math.abs((o.y === undefined ? y : o.y) - y),
        }))
        .filter((o) => o.d > 0.5)
        .sort((a, b) => a.d - b.d);
      if (!opts.length) break;
      const pick = opts[0];
      if (pick.x !== undefined) x = pick.x;
      if (pick.y !== undefined) y = pick.y;
    }
    /* 仍相交：最后手段收高（不低于 120，内容自己滚） */
    const still = protAll.find(
      (p) => intersectArea({ x, y, w, h }, p) > OVERLAP_TOL,
    );
    if (still && still.y > y) {
      const nh = Math.max(GEO.MIN_EXP_H, still.y - y - GEO.GAP);
      if (nh < h) h = nh;
    }

    boxes[id] = {
      x: Math.round(x),
      y: Math.round(y),
      w: Math.round(w),
      h: Math.round(h),
      radius: 16,
      z: 60,
      phase,
    };
  }

  /* z 序：后开在上（openOrder 顺序） */
  order.forEach((id, i) => {
    if (boxes[id]) boxes[id].z = 60 + i;
  });

  /* ── 2. 同轨让位（只 translate；不换槽位、不改尺寸、不加 .collapsed）─────
     关键：让位是**整栈统一平移** delta，不是逐卡「贴到展开卡下沿」——
     后者会把多个 mini 推到同一个 y 互相叠死（cctv/context 曾经都落到 532）。 */
  for (const id of ids) {
    const box = boxes[id];
    if (!box || !live(phases[id])) continue;
    const rail = CARDS[id] && CARDS[id].rail;
    if (rail === 'dock') continue;
    const below = [];
    for (const other of ids) {
      if (other === id) continue;
      const oc = cards[other];
      if (!oc || !oc.mini) continue;
      if (!CARDS[other] || CARDS[other].rail !== rail) continue;
      if ((phases[other] || PHASE.MINI) !== PHASE.MINI) continue;
      /* 只推「槽位在展开卡下方」的兄弟（按 mini.y 判断，不按 box.y —— 盒被保护区推下去时
         上方兄弟仍是「上方」，否则会被漏推而与展开盒相压）→ scene 展开时 data 留在原槽位 */
      if (oc.mini.y < cards[id].mini.y + 1) continue;
      below.push({ y: oc.mini.y, h: oc.mini.h });
    }
    if (!below.length) continue;
    const first = Math.min(...below.map((b) => b.y));
    let delta = Math.max(0, box.y + box.h + GEO.GAP - first);

    /* 让位后仍在视口内：否则压展开卡高度（只压那一轨，最多一轮） */
    const bottomAfter = Math.max(...below.map((b) => b.y + b.h)) + delta;
    const over = Math.max(0, bottomAfter - (view.h - GEO.EDGE));
    if (over > 0) {
      const shrink = Math.min(over, Math.max(0, box.h - 120));
      box.h -= Math.round(shrink);
      delta = Math.max(0, delta - shrink);
    }
    if (delta <= 0) continue;
    for (const other of ids) {
      if (other === id) continue;
      const oc = cards[other];
      if (!oc || !oc.mini) continue;
      if (!CARDS[other] || CARDS[other].rail !== rail) continue;
      if ((phases[other] || PHASE.MINI) !== PHASE.MINI) continue;
      if (oc.mini.y < cards[id].mini.y + 1) continue;
      pushes[other] = { x: 0, y: Math.round(delta) };
    }
  }

  /* ── 3. 不变量（算出来，不抛）──────────────────────────────────────────── */
  const liveBoxes = Object.entries(boxes).filter(([id]) => live(phases[id]));
  for (const [id, b] of liveBoxes) {
    if (!inside(b, view)) violations.push({ rule: 'viewport', id, box: b });
  }
  for (let i = 0; i < liveBoxes.length; i++) {
    for (let j = i + 1; j < liveBoxes.length; j++) {
      const a = liveBoxes[i][1];
      const b = liveBoxes[j][1];
      if (
        CARDS[liveBoxes[i][0]].rail === 'dock' &&
        CARDS[liveBoxes[j][0]].rail === 'dock'
      )
        continue;
      const area = intersectArea(a, b);
      if (area > OVERLAP_TOL)
        violations.push({
          rule: 'overlap',
          a: liveBoxes[i][0],
          b: liveBoxes[j][0],
          area,
        });
    }
  }
  for (const [id, b] of liveBoxes) {
    for (const other of ids) {
      if (other === id) continue;
      const oc = cards[other];
      if (!oc || !oc.mini) continue;
      if (live(phases[other])) continue;
      const push = pushes[other] || { x: 0, y: 0 };
      const mb = {
        x: oc.mini.x + push.x,
        y: oc.mini.y + push.y,
        w: oc.mini.w,
        h: oc.mini.h,
      };
      if (!inside(mb, view))
        violations.push({ rule: 'mini-viewport', id: other, push });
      const area = intersectArea(b, mb);
      if (area > OVERLAP_TOL)
        violations.push({ rule: 'mini-overlap', open: id, mini: other, area });
    }
    for (const p of protAll) {
      const area = intersectArea(b, p);
      if (area > OVERLAP_TOL)
        violations.push({ rule: 'protected', id, area, prot: p.id || null });
    }
  }

  return { boxes, pushes, dockPanel, violations };
}

export default { layout, intersectArea, OVERLAP_TOL };
