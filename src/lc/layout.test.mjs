/* ============================================================================
   src/lc/layout.test.mjs —— L3 LayoutEngine 纯函数几何
   ----------------------------------------------------------------------------
   基线快照取真实页面实测值（1536×730，两条侧轨已上移到 y=94）：
     data [52,94,176,48]   scene [52,150,176,48]
     pp [1308,94,176,50]   cctv [1308,152,176,50]   context [1308,210,176,50]
     location [530,632,168,86]  voice [698,632,140,86]  control [838,632,168,86]
   TC-L1 纯度（零 DOM）           TC-L2 同输入同输出
   TC-L3 单开 8 张全不变量        TC-L4 跨组 21 组双开全不变量
   TC-L5 scene 展开 data 留槽     TC-L6 data 展开 scene 让位
   TC-L7 右轨整栈让位不叠死       TC-L8 dock 面板唯一形态/居中/贴内容
   TC-L9 保护区避让               TC-L10 小视口            TC-L11 drag 偏移
   TC-L12 closing 回填槽位
   ========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { layout, intersectArea, OVERLAP_TOL } from './layout.js';
import { dockPanelBox, DOCK_FORM } from './dock-overlay.js';
import { CARDS, CARD_IDS, GEO, PROTECT_IDS } from './cards.js';
import { PHASE } from './controller.js';

const W = 1536;
const H = 730;
const MINI = {
  'data-panel': { x: 52, y: 94, w: 176, h: 48 },
  'scene-panel': { x: 52, y: 150, w: 176, h: 48 },
  'pp-toggles': { x: 1308, y: 94, w: 176, h: 50 },
  'cctv-panel': { x: 1308, y: 152, w: 176, h: 50 },
  'global-context-panel': { x: 1308, y: 210, w: 176, h: 50 },
  'location-bar': { x: 530, y: 632, w: 168, h: 86 },
  'gev-voice-control': { x: 698, y: 632, w: 140, h: 86 },
  'control-panel': { x: 838, y: 632, w: 168, h: 86 },
};

function snapshot({ open = [], contentH = {}, viewport = { w: W, h: H }, protectedRects = [], offsets = {}, dock } = {}) {
  const cards = {};
  for (const id of CARD_IDS) {
    cards[id] = { mini: { ...MINI[id] }, contentH: contentH[id] || 320, connected: true };
  }
  const phases = {};
  for (const id of CARD_IDS) phases[id] = open.includes(id) ? PHASE.OPEN : PHASE.MINI;
  return {
    viewport,
    safe: { top: GEO.SAFE_TOP, bottom: GEO.SAFE_BOTTOM, left: 0, right: 0 },
    cards,
    phases,
    offsets,
    openOrder: open.slice(),
    dock: dock || { x: 530, y: 632, w: 476, h: 86, cx: 768, top: 632 },
    protected: protectedRects,
  };
}

const pushOf = (res, id) => (res.pushes && res.pushes[id]) || { x: 0, y: 0 };
const movedRect = (id, res) => {
  const p = pushOf(res, id);
  return { x: MINI[id].x + p.x, y: MINI[id].y + p.y, w: MINI[id].w, h: MINI[id].h };
};

/* ── TC-L1 纯度 ─────────────────────────────────────────────────────────── */
test('TC-L1 layout.js / dock-overlay.js 零 DOM 读取', () => {
  for (const f of ['layout.js', 'dock-overlay.js']) {
    const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const bad of ['document', 'window', 'getBoundingClientRect', 'querySelector', 'performance.now', 'requestAnimationFrame', 'setTimeout']) {
      assert.equal(src.includes(bad), false, `${f} 不得出现 ${bad}`);
    }
  }
});

test('TC-L2 同输入必同输出（含 push 顺序稳定性）', () => {
  const s = snapshot({ open: ['pp-toggles', 'location-bar'] });
  const a = layout(s);
  const b = layout(s);
  assert.deepEqual(a, b);
});

test('TC-L3 单开：8 张卡逐张开都满足全部不变量', () => {
  for (const id of CARD_IDS) {
    const res = layout(snapshot({ open: [id] }));
    assert.deepEqual(res.violations, [], `${id} 不得有 violation`);
    const box = res.boxes[id];
    assert.ok(box, `${id} 必须有展开盒`);
    const cfg = CARDS[id];
    if (cfg.rail !== 'dock') {
      assert.ok(box.h <= cfg.expH + 0.5, `${id} 高度不超过目标 ${cfg.expH}（实际 ${box.h}）`);
      assert.ok(box.h >= 120, `${id} 高度不低于 120（实际 ${box.h}）`);
      assert.ok(box.w <= cfg.expW, `${id} 宽度不超过目标`);
      assert.ok(box.y >= GEO.SAFE_TOP - 0.5, `${id} 不侵入安全顶`);
      assert.ok(box.y + box.h <= H - GEO.EDGE + 0.5, `${id} 不出屏`);
    }
    /* 未展开的卡：要么留在原槽位（在上方），要么被整体让位（在下方），且不压展开卡 */
    for (const other of CARD_IDS) {
      if (other === id) continue;
      const m = movedRect(other, res);
      assert.ok(m.y >= 0 && m.y + m.h <= H + 0.5, `${id} 打开后 ${other} 仍在视口内`);
      assert.ok(intersectArea(box, m) <= OVERLAP_TOL, `${id} 与 ${other} 不重叠`);
    }
    /* 同轨被让位的 mini 之间不得互相叠死 */
    const rails = {};
    for (const other of CARD_IDS) {
      if (other === id) continue;
      const r = CARDS[other].rail;
      (rails[r] = rails[r] || []).push(movedRect(other, res));
    }
    for (const r in rails) {
      const list = rails[r].filter((b) => b.w > 1);
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) assert.ok(intersectArea(list[i], list[j]) <= OVERLAP_TOL, `${id} 打开后 ${r} 轨道 mini 互相重叠`);
    }
  }
});

test('TC-L4 跨组双开：21 组全不变量', () => {
  const groupsOf = (id) => ['location-bar', 'control-panel', 'gev-voice-control'].includes(id) ? 'dock' : CARDS[id].rail;
  let combos = 0;
  for (let i = 0; i < CARD_IDS.length; i++) {
    for (let j = i + 1; j < CARD_IDS.length; j++) {
      const a = CARD_IDS[i];
      const b = CARD_IDS[j];
      if (groupsOf(a) === groupsOf(b)) continue; // 同轨互斥，不可能同时开着
      combos += 1;
      const res = layout(snapshot({ open: [a, b] }));
      assert.deepEqual(res.violations, [], `${a} + ${b} 不许有 violation`);
      const boxA = res.boxes[a];
      const boxB = res.boxes[b];
      if (groupsOf(a) !== 'dock' && groupsOf(b) !== 'dock') {
        assert.ok(intersectArea(boxA, boxB) <= OVERLAP_TOL, `${a} 与 ${b} 展开盒不重叠`);
      }
    }
  }
  assert.equal(combos, 21, '跨组组合数应为 21');
});

test('TC-L5 scene 展开时 data 留在原槽位（push 必须为 0）', () => {
  const res = layout(snapshot({ open: ['scene-panel'] }));
  assert.deepEqual(pushOf(res, 'data-panel'), { x: 0, y: 0 });
  const m = movedRect('data-panel', res);
  assert.deepEqual(m, { ...MINI['data-panel'] }, 'data 槽位逐像素不变');
  assert.equal(res.boxes['scene-panel'].y, MINI['scene-panel'].y, 'scene 贴自己的槽位顶边');
});

test('TC-L6 data 展开时 scene 让位：下沿 + GAP − miniY，且不叠死', () => {
  const res = layout(snapshot({ open: ['data-panel'] }));
  const box = res.boxes['data-panel'];
  const push = pushOf(res, 'scene-panel');
  assert.equal(push.y, box.y + box.h + GEO.GAP - MINI['scene-panel'].y);
  const m = movedRect('scene-panel', res);
  assert.equal(m.y, box.y + box.h + GEO.GAP, 'scene 顶边 = data 下沿 + 8');
});

test('TC-L7 右轨整栈让位：cctv/context 用同一 delta，间距不被压扁', () => {
  const res = layout(snapshot({ open: ['pp-toggles'] }));
  const box = res.boxes['pp-toggles'];
  const cctv = pushOf(res, 'cctv-panel');
  const ctx = pushOf(res, 'global-context-panel');
  assert.equal(cctv.y, ctx.y, '整栈统一 delta');
  assert.equal(cctv.y, box.y + box.h + GEO.GAP - MINI['cctv-panel'].y);
  const mc = movedRect('cctv-panel', res);
  const mg = movedRect('global-context-panel', res);
  assert.equal(mg.y - (mc.y + mc.h), MINI['global-context-panel'].y - (MINI['cctv-panel'].y + MINI['cctv-panel'].h), '间距保持原样');
  assert.ok(intersectArea(mc, mg) === 0, '两张 mini 不重叠');
});

test('TC-L8 dock 面板：唯一形态、居中 dock、高贴合内容、宽度夹紧', () => {
  assert.equal(DOCK_FORM, 'single');
  for (const id of ['location-bar', 'control-panel', 'gev-voice-control']) {
    for (const ch of [40, 200, 900]) {
      const res = layout(snapshot({ open: [id], contentH: { [id]: ch } }));
      const box = res.boxes[id];
      assert.ok(box && box.dock, `${id} 必须落在 dock 面板`);
      const cx = box.x + box.w / 2;
      assert.ok(Math.abs(cx - 768) <= 2, `${id} 水平居中 dock（漂 ${Math.round(cx - 768)}px）`);
      assert.equal(box.y + box.h, 632 - GEO.DOCK_LIFT, '底边 = dock.top − 12');
      assert.ok(box.h >= GEO.PANEL_MIN_H, '高度不低于下限（面板自己滚）');
      assert.ok(box.h <= 632 - GEO.SAFE_TOP - GEO.DOCK_LIFT, '高度不超过 dock 上方可用空间');
      if (ch >= GEO.PANEL_MIN_H && ch <= 632 - GEO.SAFE_TOP - GEO.DOCK_LIFT) assert.equal(box.h, ch, '高度贴合内容');
      assert.ok(box.w >= GEO.PANEL_MIN_W - 0.5 && box.w <= GEO.PANEL_MAX_W + 0.5, '宽度夹在 [320,560]');
      assert.deepEqual(res.violations.filter((v) => v.id === id), []);
    }
  }
});

test('TC-L8d 回归：dock 面板高度贴合真实内容（实测 location 76 / control 203 不得撑成 478）', () => {
  /* 2026-10-28 实测缺陷：App 给 dock 卡同时设 top+bottom，height:auto 被拉伸成 516，
     量到的 contentH=600 → 面板按 maxH=478 撑满，底部空白 410px。修好后 contentH=76。 */
  const cases = [
    ['location-bar', 76, 88], // 76 < PANEL_MIN_H → 取下限 88（余量 12px，不再是 140/478）
    ['control-panel', 203, 203], // ≥ 下限 → 精确贴合
    ['location-bar', 300, 300],
  ];
  for (const [id, ch, want] of cases) {
    const box = layout(snapshot({ open: [id], contentH: { [id]: ch } })).boxes[id];
    assert.equal(box.h, want, `${id} contentH=${ch} → 期望 ${want}，实际 ${box.h}`);
    assert.ok(box.h - ch <= 24, `${id} 底部空白必须 ≤24px（实际 ${box.h - ch}）`);
  }
  assert.ok(GEO.PANEL_MIN_H <= 96, `PANEL_MIN_H=${GEO.PANEL_MIN_H} 会让小面板留大片空白`);
});

test('TC-L8b dock 组互斥：三选一都占同一块面板区域（几何一致，不叠加两种形态）', () => {
  const boxes = ['location-bar', 'control-panel', 'gev-voice-control'].map((id) => layout(snapshot({ open: [id], contentH: { [id]: 300 } })).boxes[id]);
  for (const b of boxes) assert.equal(b.h, 300);
  const ys = new Set(boxes.map((b) => b.y + b.h));
  assert.equal(ys.size, 1, '三张卡的底边一致（都贴 dock 上方）');
});

test('TC-L8c dock 面板不得压住 dock 上方常驻 chip（perf/语言/定位）', () => {
  /* 真实实测：gev-perf-wrap [688,575,394,31]、gev-lang-toggle [846,573,72,29]、gev-locate-btn [618,573,63,29] */
  const protect = [
    { id: 'gev-perf-wrap', x: 688, y: 575, w: 394, h: 31 },
    { id: 'gev-lang-toggle', x: 846, y: 573, w: 72, h: 29 },
    { id: 'gev-locate-btn', x: 618, y: 573, w: 63, h: 29 },
    { id: 'command-dock', x: 530, y: 632, w: 476, h: 86 },
  ];
  for (const id of ['location-bar', 'control-panel', 'gev-voice-control']) {
    const res = layout(snapshot({ open: [id], contentH: { [id]: 536 }, protectedRects: protect }));
    const box = res.boxes[id];
    assert.ok(box.y + box.h <= 573 - 12 + 0.5, `${id} 底边必须在 chip 之上（实际 ${box.y + box.h}）`);
    assert.deepEqual(res.violations.filter((v) => v.rule === 'protected'), [], `${id} 不得压 chrome`);
    assert.ok(box.h >= GEO.PANEL_MIN_H, '仍有可读高度，内容自己滚');
  }
});

test('TC-L9 保护区：右侧 chrome 相交时左移；顶部 chrome 与展开盒相交时下移', () => {
  const protR = [{ id: 'gev-perf-wrap', x: 1184, y: 94, w: 340, h: 60 }];
  const res2 = layout(snapshot({ open: ['pp-toggles'], protectedRects: protR }));
  assert.deepEqual(res2.violations.filter((v) => v.rule === 'protected'), []);
  assert.ok(intersectArea(res2.boxes['pp-toggles'], protR[0]) <= OVERLAP_TOL, '必须让开 chrome（方向由最小位移决定）');
  assert.ok(res2.boxes['pp-toggles'].x > W / 2, '仍在右半边（不被推到地图中间）');

  /* 顶部 chrome 挡住展开盒上部（拖到 y=200 后撞上）：盒子回落到 chrome 下沿 */
  const protT = [{ id: 'top-center-actions', x: 52, y: 120, w: 320, h: 60 }];
  const res3 = layout(snapshot({ open: ['data-panel'], protectedRects: protT, offsets: { 'data-panel': { x: 0, y: 106 } } }));
  assert.ok(res3.boxes['data-panel'].y >= 180, `从 chrome 下沿开始（实际 ${res3.boxes['data-panel'].y}）`);
  assert.deepEqual(res3.violations.filter((v) => v.rule === 'protected'), []);
});

test('TC-L10 小视口 1280×620：仍不出屏、不重叠', () => {
  const viewport = { w: 1280, h: 620 };
  const mini = {
    'data-panel': { x: 40, y: 94, w: 160, h: 44 },
    'scene-panel': { x: 40, y: 146, w: 160, h: 44 },
    'pp-toggles': { x: 1070, y: 94, w: 160, h: 44 },
    'cctv-panel': { x: 1070, y: 146, w: 160, h: 44 },
    'global-context-panel': { x: 1070, y: 198, w: 160, h: 44 },
    'location-bar': { x: 420, y: 530, w: 150, h: 80 },
    'gev-voice-control': { x: 580, y: 530, w: 120, h: 80 },
    'control-panel': { x: 710, y: 530, w: 150, h: 80 },
  };
  for (const id of CARD_IDS) {
    const cards = {};
    for (const k of CARD_IDS) cards[k] = { mini: { ...mini[k] }, contentH: 300, connected: true };
    const phases = {};
    for (const k of CARD_IDS) phases[k] = k === id ? PHASE.OPEN : PHASE.MINI;
    const res = layout({
      viewport,
      safe: { top: GEO.SAFE_TOP, bottom: GEO.SAFE_BOTTOM },
      cards,
      phases,
      offsets: {},
      openOrder: [id],
      dock: { x: 420, y: 530, w: 440, h: 80, cx: 640, top: 530 },
      protected: [],
    });
    assert.deepEqual(res.violations, [], `${id} 在 1280×620 下不许有 violation`);
    const box = res.boxes[id];
    assert.ok(box.x >= 0 && box.x + box.w <= viewport.w, `${id} 水平不出屏`);
    assert.ok(box.y >= 0 && box.y + box.h <= viewport.h, `${id} 垂直不出屏`);
  }
});

test('TC-L11 drag 偏移：只平移展开盒，仍被视口夹住', () => {
  const res = layout(snapshot({ open: ['data-panel'], offsets: { 'data-panel': { x: 60, y: 40 } } }));
  assert.equal(res.boxes['data-panel'].x, MINI['data-panel'].x + 60);
  assert.equal(res.boxes['data-panel'].y, MINI['data-panel'].y + 40);
  const clamped = layout(snapshot({ open: ['data-panel'], offsets: { 'data-panel': { x: 5000, y: 5000 } } }));
  const b = clamped.boxes['data-panel'];
  assert.ok(b.x + b.w <= W - GEO.EDGE + 0.5, '右边界夹紧');
  assert.ok(b.y + b.h <= H - GEO.EDGE + 0.5, '下边界夹紧');
});

test('TC-L12 closing 相位：盒目标 = 自然槽位（回填），不参与让位', () => {
  const s = snapshot();
  s.phases['data-panel'] = PHASE.CLOSING;
  const res = layout(s);
  assert.deepEqual(res.boxes['data-panel'], { x: 52, y: 94, w: 176, h: 48, radius: 16, z: 40, phase: PHASE.CLOSING });
  assert.deepEqual(res.pushes, {});
});

test('TC-L13 dockPanelBox 边界：无 dock / 无 viewport 返回 null', () => {
  assert.equal(dockPanelBox({ dock: null, contentH: 100, viewport: { w: 1000, h: 700 } }), null);
  assert.equal(dockPanelBox({ dock: { x: 0, y: 600, w: 400 }, contentH: 100, viewport: null }), null);
  const b = dockPanelBox({ dock: { x: 0, y: 600, w: 400 }, contentH: 0, viewport: { w: 1000, h: 700 } });
  assert.equal(b.h, GEO.PANEL_MIN_H, '空内容也不给空玻璃');
  assert.ok(b.w >= GEO.PANEL_MIN_W && b.w <= GEO.PANEL_MAX_W);
  assert.ok(b.x >= GEO.PANEL_EDGE);
});

test('TC-L14 PROTECT_IDS 与实测 chrome 一致（防新增 chrome 忘记登记）', () => {
  assert.ok(PROTECT_IDS.includes('top-center-actions'));
  assert.ok(PROTECT_IDS.includes('gev-perf-wrap'));
  assert.ok(PROTECT_IDS.includes('gev-gfx-fab'));
});
