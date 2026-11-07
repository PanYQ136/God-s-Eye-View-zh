/* ============================================================================
   src/lc/runtime.test.mjs —— 材质门槛 / 动画时序 / 交互分类 / CollapsePort
   ----------------------------------------------------------------------------
   TC-M1 时长：所有 8 卡目标尺寸都落在 [480,520]ms（A1 · kit.md --glass-spring-duration 500ms）
   TC-M2 视觉峰值：逐卡 1.02–1.05（这是「果冻」的唯一量化标准）
   TC-M3 backC1：峰值反解精度（保留导出，A1 采样改用 Spring 形状）
   TC-M4 shiftKeyframes：t=0.5 精确等于 peak；端点精确；reduced 无回弹
   TC-M5 run()：单元素单动画、连点取消、reduced→150ms
   TC-M6 material.css 硬门槛：≤340 行、!important=0、双 ID=0、token 与 tokens.json 一致
   TC-M7 卡壳 Apple 毛玻璃契约：tint / backdrop-filter / 4 层 shadow；内容层仍零 blur（防双层）
   TC-M8 interaction 分类：header 切卡 / 控件不切 / mini 整条切 / 点外关闭
   TC-M9 CollapsePort：唯一 API 路径 + 精确 options + 语音卡不在披露体系
   ========================================================================== */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as Morph from './morph.js';
import { CARDS, CARD_IDS, GEO } from './cards.js';
import { PHASE } from './controller.js';
import { createInteraction } from './interaction.js';
import { createCollapsePort, DEFAULT_PORT_IDS } from './collapse-port.js';

const read = (f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
const CSS = read('material.css');
const TOKENS = JSON.parse(read('tokens.json'));

/* ── 动画 ───────────────────────────────────────────────────────────────── */

test('TC-M1 时长：8 卡目标尺寸逐一落在 [480,520]（A1 · Spring 500ms）', () => {
  for (const id of CARD_IDS) {
    const { expW, expH } = CARDS[id];
    const d = Morph.durationMs(expW, expH);
    assert.ok(d >= Morph.MIN_MS && d <= Morph.MAX_MS, `${id} ${expW}×${expH} → ${d}ms`);
  }
  for (const [w, h] of [[1, 1], [9999, 9999], [0, 0], [176, 43]]) {
    const d = Morph.durationMs(w, h);
    assert.ok(d >= 480 && d <= 520, `${w}×${h} → ${d}ms`);
  }
});

test('TC-M2 视觉峰值：逐卡 FLIP 的 scale 峰值 ∈ [1.02,1.05]', () => {
  const peakOf = (frames, sx) => {
    let peak = 0;
    for (const f of frames) {
      const m = f.transform.match(/scale\(([-\d.]+),([-\d.]+)\)/);
      peak = Math.max(peak, Number(m[1]));
    }
    return peak;
  };
  for (const id of CARD_IDS) {
    const mini = { left: 100, top: 100, width: 176, height: 43 };
    const to = { left: 100, top: 100, width: CARDS[id].expW, height: CARDS[id].expH };
    const sx = mini.width / to.width;
    const sy = mini.height / to.height;
    const { frames } = Morph.keyframes(mini.left - to.left, mini.top - to.top, sx, sy, { duration: 400 });
    const peak = peakOf(frames, sx);
    assert.ok(peak >= 1.019 && peak <= 1.051, `${id} 峰值 ${peak.toFixed(4)} 越界`);
    /* 首帧 = 起点、末帧 = 目标 */
    const first = frames[0].transform.match(/scale\(([-\d.]+),([-\d.]+)\)/);
    const last = frames[frames.length - 1].transform.match(/scale\(([-\d.]+),([-\d.]+)\)/);
    assert.ok(Math.abs(Number(first[1]) - sx) < 1e-3, '首帧 scale = 起点');
    assert.ok(Math.abs(Number(last[1]) - 1) < 1e-3, '末帧 scale = 1');
    assert.equal(frames[0].offset, 0);
    assert.equal(frames[frames.length - 1].offset, 1);
  }
});

test('TC-M3 backC1 反解精度：目标峰值误差 < 1e-3', () => {
  const peakOf = (c) => (4 * c * c * c) / (27 * (c + 1) * (c + 1));
  for (const target of [1.01, 1.02, 1.035, 1.05, 1.1]) {
    const c = Morph.backC1(target);
    assert.ok(Math.abs(peakOf(c) - (target - 1)) < 1e-3, `${target} → c1=${c.toFixed(4)}`);
  }
  assert.equal(Morph.backC1(1), 0, '无过量需求时 c1=0');
});

test('TC-M4 shiftKeyframes：t=0.5 精确 peak、端点精确、reduced 无回弹', () => {
  const from = { x: 0, y: 0 };
  const to = { x: 0, y: 380 };
  const kf = Morph.shiftKeyframes(from, to, { duration: 400 });
  const mid = kf.frames[Math.round((kf.frames.length - 1) / 2)];
  const s = Number(mid.transform.match(/scale\(([-\d.]+)\)/)[1]);
  assert.ok(Math.abs(s - Morph.SHIFT_PEAK) < 2e-3, `t≈0.5 处 scale=${s}`);
  assert.ok(Morph.SHIFT_PEAK >= 1.02 && Morph.SHIFT_PEAK <= 1.05);
  assert.match(kf.frames[0].transform, /translate3d\(0\.00px,0\.00px,0\)/);
  assert.match(kf.frames[kf.frames.length - 1].transform, /translate3d\(0\.00px,380\.00px,0\)/);
  const red = Morph.shiftKeyframes(from, to, { duration: 150, reduce: true });
  for (const f of red.frames) {
    const v = Number(f.transform.match(/scale\(([-\d.]+)\)/)[1]);
    assert.ok(v <= 1.0001, 'reduced 不得放大');
  }
});

function fakeEl() {
  const calls = { animate: [], cancel: 0 };
  const listeners = {};
  const el = {
    id: 'fake',
    style: {},
    animate(frames, timing) {
      const anim = {
        frames,
        timing,
        playState: 'running',
        cancel() {
          anim.playState = 'canceled';
          calls.cancel += 1;
          (listeners.cancel || []).forEach((f) => f());
        },
        addEventListener(t, f) {
          (listeners[t] = listeners[t] || []).push(f);
        },
        finish() {
          anim.playState = 'finished';
          (listeners.finish || []).forEach((f) => f());
        },
      };
      calls.animate.push(anim);
      return anim;
    },
  };
  return { el, calls };
}

test('TC-M5 run()：单元素单动画 + 连点取消 + reduced→150ms', () => {
  const { el, calls } = fakeEl();
  const first = { left: 100, top: 100, width: 176, height: 43 };
  const to = { x: 100, y: 100, w: 320, h: 380 };
  const a1 = Morph.run(el, first, { to, target: { w: 320, h: 380 } });
  assert.ok(a1, '必须有动画');
  assert.equal(calls.animate[0].timing.duration, Morph.durationMs(320, 380));
  assert.ok(calls.animate[0].timing.duration >= 480 && calls.animate[0].timing.duration <= 520);
  const a2 = Morph.run(el, first, { to, target: { w: 320, h: 380 } });
  assert.ok(a2);
  assert.equal(calls.cancel, 1, '第二次必须取消第一条（一个元素只有一条）');
  assert.equal(Morph.animationsOf(el).length, 1);

  const { el: el2, calls: calls2 } = fakeEl();
  Morph.run(el2, first, { to, target: { w: 320, h: 380 }, reducedMotion: true });
  assert.equal(calls2.animate[0].timing.duration, Morph.REDUCE_MS);
  for (const f of calls2.animate[0].frames) {
    const v = Number(f.transform.match(/scale\(([-\d.]+),/)[1]);
    assert.ok(v <= 1.0001, 'reduced 不得回弹');
  }

  /* 起点 = 终点 → 不做动画（避免空动画打架） */
  const { el: el3, calls: calls3 } = fakeEl();
  assert.equal(Morph.run(el3, { left: 100, top: 100, width: 320, height: 380 }, { to: { ...to } }), null);
  assert.equal(calls3.animate.length, 0);
});

/* ── 材质门槛 ───────────────────────────────────────────────────────────── */

test('TC-M6 material.css 硬门槛：≤340 行 / !important=0 / 双 ID=0', () => {
  const lines = CSS.split('\n').length - (CSS.endsWith('\n') ? 1 : 0);
  /* A1（2026-11-07）：Apple 毛玻璃新增 --glass-* token 段，行数预算 300→340。
     !important=0 与双 ID=0 是灰圈/层叠纪律，任何材质下都不放宽。 */
  assert.ok(lines <= 340, `行数 ${lines} > 340`);
  assert.equal((CSS.match(/!important/g) || []).length, 0, '!important 必须为 0');
  const stripped = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = [];
  for (const block of stripped.split('}')) {
    const i = block.indexOf('{');
    if (i < 0) continue;
    const sel = block.slice(0, i).trim();
    if (!sel || sel.startsWith('@')) continue;
    for (const one of sel.split(',')) {
      const ids = (one.replace(/:is\([^()]*\)/g, 'X').match(/#[A-Za-z0-9_-]+/g) || []).length;
      if (ids >= 2) bad.push(one.trim());
    }
  }
  assert.deepEqual(bad, [], '双 ID 选择器必须为 0');
});

test('TC-M7 卡壳 Apple 毛玻璃契约；内容层仍零 blur；token 与 tokens.json 一致', () => {
  /* A1（2026-11-07）：卡壳从「透明壳」换成 kit.md §公共 CSS 的 Apple 毛玻璃。
     断言随之换契约——仍是硬断言，不是放宽：
       卡壳 = tint + backdrop-filter(blur/saturate/brightness) + 4 层 shadow；
       内容层(后代) = 零 blur，防止一张卡出现两层 backdrop-filter。 */
  const shell = CSS.slice(CSS.indexOf('/* ── 2)'), CSS.indexOf('/* ── 3)'));
  assert.match(shell, /background:\s*var\(--glass-tint-light\)/, '卡壳 tint 必须走 --glass-tint-light');
  assert.match(shell, /border:\s*0/);
  assert.match(shell, /outline:\s*0/);
  assert.match(shell, /box-shadow:\s*var\(--glass-shadow-blur\),\s*var\(--glass-rim-tl\),\s*var\(--glass-rim-br\)/, '4 层 shadow 必须齐备');
  assert.match(shell, /backdrop-filter:\s*blur\(var\(--glass-blur-radius\)\)/, '卡壳必须有 backdrop blur');
  assert.match(shell, /saturate\(var\(--glass-saturate\)\)/);
  assert.match(shell, /brightness\(var\(--glass-brightness\)\)/);
  assert.match(shell, /var\(--glass-lens\)/, 'lens 必须走变量，禁止直接写死 url()');
  /* 运行时防回归（2026-11-07 浏览器实测）：backdrop-filter 的 <filter-function>+
     不能与 none 混用，否则整条声明作废、毛玻璃消失。默认值必须是合法 no-op。 */
  assert.equal(
    TOKENS.tokens['--glass-lens'],
    'contrast(1)',
    '--glass-lens 默认值不得为 none：blur()...none 会让整条 backdrop-filter 失效',
  );
  assert.equal(/inset 0 0 0|inset\s+0\s+0\s+0\s+1px/.test(shell), false, '卡壳不得有闭合 inset 圆环');
  /* 内容层：仍归零（A1 保留，防双层玻璃 / 灰圈） */
  const body = CSS.slice(CSS.indexOf('/* ── 3)'), CSS.indexOf('/* ── 4)'));
  assert.match(body, /border:\s*0/);
  assert.match(body, /box-shadow:\s*none/);
  assert.match(body, /backdrop-filter:\s*none/, '后代必须零 blur，否则双层玻璃');
  /* 命名防火墙：kit 的 --glass-* 与 App 既有 --glass-bg/-border 不得混用 */
  assert.equal(CSS.includes('--glass-bg'), false, '禁止复用 App 的 --glass-bg');
  assert.equal(CSS.includes('--glass-border'), false, '禁止复用 App 的 --glass-border');
  /* token 唯一来源：tokens.json 每个键都必须在 material.css 逐值出现 */
  for (const [k, v] of Object.entries(TOKENS.tokens)) {
    assert.equal(CSS.includes(`${k}: ${v};`), true, `material.css 缺少 ${k}: ${v}`);
  }
  for (const banned of Object.keys(TOKENS.banned)) assert.equal(CSS.includes(banned), false, `${banned} 是灰圈来源，禁止出现`);
});

/* ── 交互分类（最小 DOM 桩） ──────────────────────────────────────────── */

function stubNode(chain, attrs = {}) {
  /* chain: [[tag, classes[]], ...] 自身 → 根；attrs 用于 [role=slider] / [data-no-toggle] */
  return {
    tagName: chain[0][0].toUpperCase(),
    className: (chain[0][1] || []).join(' '),
    closest(sel) {
      for (let i = 0; i < chain.length; i++) {
        const [tag, classes] = chain[i];
        for (const part of sel.split(',')) {
          const s = part.trim();
          if (!s) continue;
          if (s.startsWith('.') && classes.includes(s.slice(1))) return { idx: i };
          if (s.startsWith('[') && attrs[s.slice(1, -1)]) return { idx: i };
          if (!s.startsWith('.') && !s.startsWith('[') && tag.toLowerCase() === s.toLowerCase()) return { idx: i };
        }
      }
      return null;
    },
  };
}

test('TC-M8 interaction 分类：标题=切卡、控件不切、mini 整条切、展开体不切、拖动只在 OPEN', () => {
  const inter = createInteraction({ dispatch: () => {}, phaseOf: () => PHASE.MINI, onDrag: () => {} });
  const cls = inter.classifyTarget;

  const title = stubNode([['span', ['panel-title']], ['div', ['panel-header']], ['section', ['gev-lc']]]);
  assert.deepEqual(cls(title, PHASE.MINI), { header: true, draggable: false }, 'mini 点标题 = 展开');

  const btn = stubNode([['button', ['pp-toggle-btn']], ['div', ['panel-header']], ['section', ['gev-lc']]]);
  assert.equal(cls(btn, PHASE.MINI), null, '标题里的按钮不切卡');

  const bodyMini = stubNode([['div', ['panel-inner']], ['section', ['gev-lc']]]);
  assert.deepEqual(cls(bodyMini, PHASE.MINI), { header: true, draggable: false }, 'mini 态整条都是热区');

  const bodyOpen = stubNode([['div', ['panel-inner']], ['section', ['gev-lc']]]);
  assert.equal(cls(bodyOpen, PHASE.OPEN), null, '展开态正文不是热区（否则滚动变收起）');

  const headOpen = stubNode([['div', ['panel-header']], ['section', ['gev-lc']]]);
  assert.deepEqual(cls(headOpen, PHASE.OPEN), { header: true, draggable: true }, '展开态标题 = 可拖/可收');

  const chip = stubNode([['div', ['scene-shot-btn']], ['div', ['panel-header']], ['section', ['gev-lc']]]);
  assert.equal(cls(chip, PHASE.OPEN), null, '标题里的 .scene-btn 控件不切卡');

  const slider = stubNode([['div', ['pp-slider']], ['section', ['gev-lc']]], { 'role=slider': true });
  assert.equal(cls(slider, PHASE.MINI), null, '滑杆不切卡');

  const noToggle = stubNode([['span', ['x']], ['section', ['gev-lc']]], { 'data-no-toggle': true });
  assert.equal(cls(noToggle, PHASE.MINI), null, '[data-no-toggle] 一律不切');
});

test('TC-M9 CollapsePort：唯一 API 路径、精确 options、语音卡不在披露体系', () => {
  const calls = [];
  const state = new Map(CARD_IDS.map((id) => [id, true]));
  const adapter = {
    el: (id) => (state.has(id) ? { id } : null),
    isCollapsed: (id) => state.get(id),
    setPanelCollapsed: (id, collapsed, opts) => {
      calls.push({ id, collapsed, opts });
      state.set(id, collapsed);
      return 'app';
    },
  };
  const ext = [];
  const port = createCollapsePort({ adapter, onExternalChange: (id, c) => ext.push([id, c]), clock: () => 0 });
  assert.deepEqual(port.ids(), DEFAULT_PORT_IDS);
  assert.equal(DEFAULT_PORT_IDS.includes('gev-voice-control'), false, '语音卡 mini 就是 dock 行那张卡');
  assert.equal(port.ids().length, 7);

  /* 展开 */
  const r1 = port.write('data-panel', false, 'open');
  assert.deepEqual(calls[0], { id: 'data-panel', collapsed: false, opts: { explicit: false, persist: false, syncShare: false } });
  assert.equal(r1.path, 'app');
  assert.equal(r1.changed, true);
  /* 同值不重复写 */
  const r2 = port.write('data-panel', false, 'open');
  assert.equal(r2.path, 'noop');
  assert.equal(calls.length, 1, '同值不得重复写');
  /* 全收 */
  const all = port.forceAll(true);
  assert.equal(Object.keys(all).length, 7);
  assert.equal(state.get('data-panel'), true);
  /* 失败计数：adapter 不生效时必须标记 ok=false */
  const bad = createCollapsePort({ adapter: { ...adapter, isCollapsed: () => false, setPanelCollapsed: () => 'app' }, clock: () => 0 });
  const rb = bad.write('data-panel', true, 'x');
  assert.equal(rb.ok, false);
  assert.equal(bad.stats().failures, 1);
});
