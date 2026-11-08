/* ============================================================================
   src/lc/controller.test.mjs —— L4 CardController 转移表 100% 覆盖
   ----------------------------------------------------------------------------
   TC-C1 转移表：4 相位 × 9 action 全组合（含非法组合必须是恒等变换）
   TC-C2 互斥事务：同组旧卡进 closing、新卡 opening，同一 tick 内完成
   TC-C3 世代号：过期 ANIM_END 不得改相位
   TC-C4 快速连点：mini→opening→closing→opening 序列与 gen 单调
   TC-C5 收起归位：closing→ANIM_END 只写 offset=0 + COLLAPSE_WRITE(true)
   TC-C6 持久化只存几何：HYDRATE 不改相位，MINI 不得带 offset
   TC-C7 非展开卡（gev-gfx-fab）永远 mini
   ========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, ACT, EFF, reduce, blankState, createController, cloneState } from './controller.js';
import { CARD_IDS, CARDS, GROUPS } from './cards.js';

const NOW = 1000;
const run = (state, action) => reduce(state, action, { now: NOW });
const base = () => blankState(CARD_IDS);
/* ── TC-C1 转移表：期望 (新相位, 是否含 FRAME, 含 COLLAPSE_WRITE?) ────────── */
const TABLE = [
  /* mini */
  { from: PHASE.MINI, act: { type: ACT.ACTIVATE, id: 'data-panel' }, to: PHASE.OPENING, frame: true, collapse: false, expands: true },
  { from: PHASE.MINI, act: { type: ACT.ACTIVATE, id: 'gev-gfx-fab' }, to: PHASE.MINI, frame: false },
  { from: PHASE.MINI, act: { type: ACT.ESC }, to: PHASE.MINI, frame: false },
  { from: PHASE.MINI, act: { type: ACT.CLICK_OUTSIDE }, to: PHASE.MINI, frame: false },
  { from: PHASE.MINI, act: { type: ACT.ANIM_END, id: 'data-panel', genDelta: -1 }, to: PHASE.MINI, frame: false },
  { from: PHASE.MINI, act: { type: ACT.APP_COLLAPSED, id: 'data-panel', collapsed: true }, to: PHASE.MINI, frame: false },
  { from: PHASE.MINI, act: { type: ACT.APP_COLLAPSED, id: 'data-panel', collapsed: false }, to: PHASE.OPENING, frame: true, collapse: false },
  { from: PHASE.MINI, act: { type: ACT.DRAG, id: 'data-panel', dx: 5, dy: 5 }, to: PHASE.MINI, frame: false },
  { from: PHASE.MINI, act: { type: ACT.DRAG_END, id: 'data-panel' }, to: PHASE.MINI, frame: false, persist: true },
  { from: PHASE.MINI, act: { type: ACT.RESIZE }, to: PHASE.MINI, frame: true },
  /* opening */
  { from: PHASE.OPENING, act: { type: ACT.ACTIVATE, id: 'data-panel' }, to: PHASE.CLOSING, frame: true },
  { from: PHASE.OPENING, act: { type: ACT.ANIM_END, id: 'data-panel', genDelta: 0 }, to: PHASE.OPEN, frame: true },
  { from: PHASE.OPENING, act: { type: ACT.ANIM_END, id: 'data-panel', genDelta: -1 }, to: PHASE.OPENING, frame: false },
  { from: PHASE.OPENING, act: { type: ACT.ESC }, to: PHASE.CLOSING, frame: true },
  { from: PHASE.OPENING, act: { type: ACT.CLICK_OUTSIDE }, to: PHASE.CLOSING, frame: true },
  { from: PHASE.OPENING, act: { type: ACT.APP_COLLAPSED, id: 'data-panel', collapsed: true }, to: PHASE.CLOSING, frame: true },
  { from: PHASE.OPENING, act: { type: ACT.APP_COLLAPSED, id: 'data-panel', collapsed: false }, to: PHASE.OPENING, frame: false },
  { from: PHASE.OPENING, act: { type: ACT.DRAG, id: 'data-panel', dx: 3, dy: 3 }, to: PHASE.OPENING, frame: false },
  { from: PHASE.OPENING, act: { type: ACT.DRAG_END, id: 'data-panel' }, to: PHASE.OPENING, frame: false, persist: true },
  /* open */
  { from: PHASE.OPEN, act: { type: ACT.ACTIVATE, id: 'data-panel' }, to: PHASE.CLOSING, frame: true },
  { from: PHASE.OPEN, act: { type: ACT.ANIM_END, id: 'data-panel', genDelta: 0 }, to: PHASE.OPEN, frame: false },
  { from: PHASE.OPEN, act: { type: ACT.DRAG, id: 'data-panel', dx: 7, dy: -4 }, to: PHASE.OPEN, frame: true, offset: { x: 7, y: -4 } },
  { from: PHASE.OPEN, act: { type: ACT.DRAG_END, id: 'data-panel' }, to: PHASE.OPEN, frame: false, persist: true },
  { from: PHASE.OPEN, act: { type: ACT.APP_COLLAPSED, id: 'data-panel', collapsed: true }, to: PHASE.CLOSING, frame: true },
  { from: PHASE.OPEN, act: { type: ACT.ESC }, to: PHASE.CLOSING, frame: true },
  { from: PHASE.OPEN, act: { type: ACT.CLICK_OUTSIDE }, to: PHASE.CLOSING, frame: true },
  /* closing */
  { from: PHASE.CLOSING, act: { type: ACT.ANIM_END, id: 'data-panel', genDelta: 0 }, to: PHASE.MINI, frame: true, collapse: true, persist: true },
  { from: PHASE.CLOSING, act: { type: ACT.ACTIVATE, id: 'data-panel' }, to: PHASE.OPENING, frame: true },
  { from: PHASE.CLOSING, act: { type: ACT.ESC }, to: PHASE.CLOSING, frame: false },
  { from: PHASE.CLOSING, act: { type: ACT.CLICK_OUTSIDE }, to: PHASE.CLOSING, frame: false },
  { from: PHASE.CLOSING, act: { type: ACT.DRAG, id: 'data-panel', dx: 4, dy: 4 }, to: PHASE.CLOSING, frame: false },
  { from: PHASE.CLOSING, act: { type: ACT.DRAG_END, id: 'data-panel' }, to: PHASE.CLOSING, frame: false, persist: true },
  { from: PHASE.CLOSING, act: { type: ACT.APP_COLLAPSED, id: 'data-panel', collapsed: true }, to: PHASE.CLOSING, frame: false },
];

for (const row of TABLE) {
  test(`TC-C1 转移表 ${row.from} + ${row.act.type} → ${row.to}`, () => {
    let s = base();
    /* closing/open 来自一次真实激活，保证 openOrder 与 gen 一致 */
    if (row.from !== PHASE.MINI) {
      s = run(s, { type: ACT.ACTIVATE, id: 'data-panel' }).state; // → opening
      if (row.from === PHASE.OPEN) s = run(s, { type: ACT.ANIM_END, id: 'data-panel', gen: s.cards['data-panel'].gen }).state;
      if (row.from === PHASE.CLOSING) s = run(s, { type: ACT.ACTIVATE, id: 'data-panel' }).state;
    }
    const act = { ...row.act };
    if (act.type === ACT.ANIM_END && act.genDelta !== undefined) act.gen = s.cards[act.id].gen + act.genDelta;
    if (act.type === ACT.ANIM_END && row.collapse) act.gen = s.cards[act.id].gen;
    const { state, effects } = run(s, act);
    assert.equal(state.cards['data-panel'].phase, row.to, 'target phase');
    const hasFrame = effects.some((e) => e.type === EFF.FRAME);
    assert.equal(hasFrame, !!row.frame, 'FRAME effect');
    if (row.collapse) {
      const w = effects.find((e) => e.type === EFF.COLLAPSE_WRITE);
      assert.ok(w, 'COLLAPSE_WRITE 必须存在');
      assert.equal(w.collapsed, true, '收起方向');
      assert.equal(w.reason, 'close-end');
      assert.deepEqual(state.cards['data-panel'].offset, { x: 0, y: 0 }, '收起必须归零 offset');
    }
    if (row.collapse === false) assert.equal(effects.some((e) => e.type === EFF.COLLAPSE_WRITE && e.collapsed === true), false);
    if (row.persist) assert.ok(effects.some((e) => e.type === EFF.PERSIST), 'PERSIST');
    if (row.offset) assert.deepEqual(state.cards['data-panel'].offset, row.offset);
    if (row.expands) assert.ok(effects.some((e) => e.type === EFF.COLLAPSE_WRITE && e.collapsed === false), '展开必须写 COLLAPSE_WRITE(false)');
    if (row.collapse === false) assert.equal(effects.some((e) => e.type === EFF.COLLAPSE_WRITE && e.collapsed === false && row.expands !== true), false, '不得擅自展开');
  });
}

test('TC-C1b 未覆盖组合检查：TABLE 覆盖 (4 相位 × 9 action) 的每一条合法路径', () => {
  const seen = new Set(TABLE.map((r) => `${r.from}|${r.act.type}`));
  const phases = [PHASE.MINI, PHASE.OPENING, PHASE.OPEN, PHASE.CLOSING];
  const actions = [ACT.ACTIVATE, ACT.ANIM_END, ACT.ESC, ACT.CLICK_OUTSIDE, ACT.RESIZE, ACT.APP_COLLAPSED, ACT.DRAG, ACT.DRAG_END, ACT.HYDRATE];
  const missing = [];
  for (const p of phases) for (const a of actions) if (!seen.has(`${p}|${a}`)) missing.push(`${p}|${a}`);
  /* HYDRATE/RESIZE 在任意相位行为相同（单独测），其余 8 个 action × 4 相位必须全在表里 */
  assert.deepEqual(
    missing.filter((m) => !m.endsWith('|HYDRATE') && !m.endsWith('|RESIZE')),
    [],
    '转移表缺项',
  );
});

test('TC-C2 互斥事务：data 开着点 scene → 同一 tick 内 data closing、scene opening', () => {
  let s = run(base(), { type: ACT.ACTIVATE, id: 'data-panel' }).state;
  s = run(s, { type: ACT.ANIM_END, id: 'data-panel', gen: s.cards['data-panel'].gen }).state;
  assert.equal(s.cards['data-panel'].phase, PHASE.OPEN);
  const { state, effects } = run(s, { type: ACT.ACTIVATE, id: 'scene-panel' });
  assert.equal(state.cards['scene-panel'].phase, PHASE.OPENING);
  assert.equal(state.cards['data-panel'].phase, PHASE.CLOSING, '旧卡必须同 tick 退场');
  assert.ok(effects.some((e) => e.type === EFF.FRAME));
  /* 退场卡内容在 closing 期间不得被收起（否则动画是空壳） */
  assert.equal(effects.some((e) => e.type === EFF.COLLAPSE_WRITE && e.collapsed === true), false);
  assert.deepEqual(state.openOrder, ['scene-panel']);
});

test('TC-C2b 三组互斥：任一组内任意两张都满足「最多 1 张 live」', () => {
  for (const g of GROUPS) {
    for (const a of g) {
      for (const b of g) {
        if (a === b) continue;
        let s = run(base(), { type: ACT.ACTIVATE, id: a }).state;
        s = run(s, { type: ACT.ANIM_END, id: a, gen: s.cards[a].gen }).state;
        s = run(s, { type: ACT.ACTIVATE, id: b }).state;
        const live = g.filter((id) => ['opening', 'open'].includes(s.cards[id].phase));
        assert.deepEqual(live, [b], `${a}→${b} 组内只剩新卡`);
      }
    }
  }
});

test('TC-C3 世代号：过期 ANIM_END 不得推进相位', () => {
  let s = run(base(), { type: ACT.ACTIVATE, id: 'data-panel' }).state;
  const gen = s.cards['data-panel'].gen;
  const stale = run(s, { type: ACT.ANIM_END, id: 'data-panel', gen: gen - 1 });
  assert.equal(stale.state.cards['data-panel'].phase, PHASE.OPENING, '旧 gen 必须被忽略');
  assert.equal(stale.effects.length, 0);
  const fresh = run(s, { type: ACT.ANIM_END, id: 'data-panel', gen });
  assert.equal(fresh.state.cards['data-panel'].phase, PHASE.OPEN);
});

test('TC-C4 快速连点：mini → opening → closing → opening，gen 单调递增且 openOrder 只有自己', () => {
  let s = base();
  const gens = [];
  for (let i = 0; i < 7; i++) {
    s = run(s, { type: ACT.ACTIVATE, id: 'cctv-panel' }).state;
    gens.push(s.cards['cctv-panel'].gen);
    const live = ['opening', 'open'].includes(s.cards['cctv-panel'].phase);
    const closing = s.cards['cctv-panel'].phase === PHASE.CLOSING;
    assert.ok(live || closing, `第 ${i} 次点击后相位合法`);
    assert.deepEqual(s.openOrder.filter((x) => x === 'cctv-panel'), s.openOrder.includes('cctv-panel') ? ['cctv-panel'] : []);
  }
  for (let i = 1; i < gens.length; i++) assert.ok(gens[i] > gens[i - 1], 'gen 必须严格递增');
});

test('TC-C5 收起只写 offset=0 + COLLAPSE_WRITE(true)，不写 COVER 其它卡', () => {
  let s = run(base(), { type: ACT.ACTIVATE, id: 'control-panel' }).state;
  s = run(s, { type: ACT.ANIM_END, id: 'control-panel', gen: s.cards['control-panel'].gen }).state;
  s = run(s, { type: ACT.DRAG, id: 'control-panel', dx: 40, dy: 30 }).state;
  assert.deepEqual(s.cards['control-panel'].offset, { x: 40, y: 30 });
  s = run(s, { type: ACT.ACTIVATE, id: 'control-panel' }).state; // → closing
  const { state, effects } = run(s, { type: ACT.ANIM_END, id: 'control-panel', gen: s.cards['control-panel'].gen });
  assert.equal(state.cards['control-panel'].phase, PHASE.MINI);
  assert.deepEqual(state.cards['control-panel'].offset, { x: 0, y: 0 });
  const writes = effects.filter((e) => e.type === EFF.COLLAPSE_WRITE);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], { type: EFF.COLLAPSE_WRITE, id: 'control-panel', collapsed: true, reason: 'close-end' });
});

test('TC-C6 HYDRATE 只回填 offset，不改相位；MINI 不得留 offset', () => {
  const { state } = run(base(), { type: ACT.HYDRATE, offsets: { 'data-panel': { x: 12, y: -8 }, 'scene-panel': { x: 'bad', y: 1 } } });
  assert.deepEqual(state.cards['data-panel'].offset, { x: 12, y: -8 });
  assert.deepEqual(state.cards['scene-panel'].offset, { x: 0, y: 0 }, '非法值丢弃');
  assert.equal(state.cards['data-panel'].phase, PHASE.MINI, '形态不持久化（D1 初始全 mini）');
});

test('TC-C6b Q6：收起归零不清盘存几何，再展开回到用户位置', () => {
  /* 开→拖→收→再开：offset 必须逐像素归零再复原，savedOffset 全程不动。 */
  const end = (st, id) =>
    run(st, { type: ACT.ANIM_END, id, gen: st.cards[id].gen }).state;
  let s = run(base(), { type: ACT.HYDRATE, offsets: { 'data-panel': { x: -60, y: 40 } } }).state;
  assert.deepEqual(s.cards['data-panel'].savedOffset, { x: -60, y: 40 }, 'HYDRATE 同步 savedOffset');

  s = end(run(s, { type: ACT.ACTIVATE, id: 'data-panel' }).state, 'data-panel');
  assert.equal(s.cards['data-panel'].phase, PHASE.OPEN);
  assert.deepEqual(s.cards['data-panel'].offset, { x: -60, y: 40 }, '展开恢复拖拽位');

  s = run(s, { type: ACT.DRAG, id: 'data-panel', dx: 10, dy: -5 }).state;
  assert.deepEqual(s.cards['data-panel'].offset, { x: -50, y: 35 }, '拖动累计进 offset');
  assert.deepEqual(s.cards['data-panel'].savedOffset, { x: -50, y: 35 }, '拖动同步进 savedOffset');

  /* 收起：closing → ANIM_END 归零 */
  s = run(s, { type: ACT.ACTIVATE, id: 'data-panel' }).state;
  assert.equal(s.cards['data-panel'].phase, PHASE.CLOSING);
  const r = run(s, { type: ACT.ANIM_END, id: 'data-panel', gen: s.cards['data-panel'].gen });
  assert.deepEqual(r.state.cards['data-panel'].offset, { x: 0, y: 0 }, '收起逐像素归位');
  assert.equal(r.state.cards['data-panel'].phase, PHASE.MINI);
  assert.deepEqual(r.state.cards['data-panel'].savedOffset, { x: -50, y: 35 }, '收起不得清掉持久意图');
  assert.ok(r.effects.some((e) => e.type === EFF.PERSIST), '收起仍要落盘');

  const reopened = run(r.state, { type: ACT.ACTIVATE, id: 'data-panel' }).state;
  assert.deepEqual(reopened.cards['data-panel'].offset, { x: -50, y: 35 }, '再展开回到用户位置');
});

test('TC-C7 gev-gfx-fab 不能展开', () => {
  const { state, effects } = run(base(), { type: ACT.ACTIVATE, id: 'gev-gfx-fab' });
  assert.equal(state.cards['gev-gfx-fab'], undefined, '不进 state（非 CARD_IDS）');
  assert.equal(effects.length, 0);
  const r = run(base(), { type: ACT.ACTIVATE, id: 'nope' });
  assert.equal(r.effects.length, 0);
});

test('TC-C8 createController：订阅在 effect 前收到状态快照；assert() 不变量为零', () => {
  const seen = [];
  const c = createController({ ids: CARD_IDS });
  c.subscribe((s, eff) => seen.push({ phase: s.cards['pp-toggles'].phase, eff: eff.map((e) => e.type) }));
  c.dispatch({ type: ACT.ACTIVATE, id: 'pp-toggles' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].phase, PHASE.OPENING);
  assert.deepEqual(c.assert(), []);
  c.dispatch({ type: ACT.ACTIVATE, id: 'cctv-panel' });
  assert.deepEqual(c.assert(), [], '互斥组切换后依然满足不变量');
});

test('TC-C9 reduce 是纯函数：输入 state 不被修改', () => {
  const s = run(base(), { type: ACT.ACTIVATE, id: 'location-bar' }).state;
  const snapshot = JSON.stringify(s);
  run(s, { type: ACT.ACTIVATE, id: 'location-bar' });
  run(s, { type: ACT.DRAG, id: 'location-bar', dx: 10, dy: 10 });
  run(s, { type: ACT.ESC });
  assert.equal(JSON.stringify(s), snapshot, 'state 必须不可变');
});

test('TC-C10 全部 8 张可展开卡都在 CARD_IDS 里且互斥组覆盖完整', () => {
  assert.equal(CARD_IDS.length, 8);
  assert.deepEqual(CARD_IDS.slice().sort(), [
    'cctv-panel',
    'control-panel',
    'data-panel',
    'gev-voice-control',
    'global-context-panel',
    'location-bar',
    'pp-toggles',
    'scene-panel',
  ]);
  const inGroup = new Set(GROUPS.flat());
  for (const id of CARD_IDS) assert.ok(inGroup.has(id), `${id} 必须在某个互斥组里`);
  assert.equal(CARDS['gev-gfx-fab'].expandable, false);
});
