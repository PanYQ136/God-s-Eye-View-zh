/**
 * src/lc/morph.test.mjs —— MorphAnimation 纯函数单测（Phase 1 · S4m / 架构 §15.2）
 *
 * 只测可离线复算的部分：时长公式（两点插值，端点 350/445）、值域、逐卡时长表、
 * easeOutBack 的 overshoot 标定、关键帧首尾自洽、reduced-motion 无回弹。
 * 运行时行为（WAAPI 实际时长/峰值）由 scripts/lc/phase1-accept.mjs 在真浏览器里断言。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { durationMs, keyframes, backC1, MIN_MS, MAX_MS, REDUCE_MS, TARGET_OVERSHOOT } from './morph.js';

const K = (445 - 350) / (Math.sqrt(320 * 380) - Math.sqrt(176 * 43));

/* 架构 §15.2 的逐卡时长表（目标盒来自 gev-liquid-cards.js 的 CARDS） */
const CARDS = {
  'data-panel': [320, 380, 445],
  'scene-panel': [320, 340, 438],
  'pp-toggles': [300, 430, 449],
  'cctv-panel': [340, 430, 450],
  'global-context-panel': [320, 400, 448],
  'location-bar': [380, 240, 428],
  'control-panel': [520, 380, 450],
  'gev-voice-control': [260, 240, 409],
};

test('K 常量与文档一致（0.3630）', () => {
  assert.equal(K.toFixed(4), '0.3630');
});

test('端点：176×43 = 350ms，320×380 = 445ms', () => {
  assert.equal(durationMs(176, 43), 350);
  assert.equal(durationMs(320, 380), 445);
});

test('逐卡时长表 9/9 命中 ±1ms', () => {
  for (const [id, [w, h, want]] of Object.entries(CARDS)) {
    const got = durationMs(w, h);
    assert.ok(Math.abs(got - want) <= 1, `${id}: ${got} != ${want}`);
  }
});

test('值域恒定夹在 [350,450]，且随面积单调不减', () => {
  let prev = 0;
  for (let a = 1; a < 400000; a = Math.round(a * 1.6) + 1) {
    const v = durationMs(Math.sqrt(a), Math.sqrt(a));
    assert.ok(v >= MIN_MS && v <= MAX_MS, `${a} → ${v}`);
    assert.ok(v >= prev, `${a} → ${v} < ${prev}`);
    prev = v;
  }
});

test('P 表原式（350+√area*4）会夹到 450 —— 反例留档', () => {
  const orig = (w, h) => Math.round(Math.min(450, Math.max(350, 350 + Math.sqrt(w * h) * 4)));
  assert.equal(orig(176, 43), 450); // 表里写的是「≈350」
  assert.equal(orig(320, 380), 450);
});

test('backC1：overshoot 1.035 → c1≈0.972；峰值反算一致', () => {
  const c1 = backC1(1.035);
  assert.ok(Math.abs(c1 - 0.972) < 0.02, `c1=${c1}`);
  const over = (c) => (4 * c * c * c) / (27 * (c + 1) * (c + 1));
  assert.ok(Math.abs(over(c1) - 0.035) < 1e-6);
});


/** 单轴「视觉过冲」：放大方向取 max，缩小方向取 1/min —— 两种方向都归一成「比目标大多少倍」。 */
function overshootOf(values, start) {
  return start < 1 ? Math.max(...values) : 1 / Math.min(...values);
}
const scalesOf = (frames) =>
  frames.map((f) => {
    const m = /scale\(([-\d.]+),([-\d.]+)\)/.exec(f.transform);
    return [Number(m[1]), Number(m[2])];
  });

test('逐轴标定：各向异性 FLIP（含收起 1.82/7.9）两轴视觉过冲都落 1.02–1.05，振幅足够时精确 1.035', () => {
  const cases = [
    [0.5, 0.4], // 等比近似
    [1.8182, 7.9], // data-panel 收起（宽/高比差 4 倍以上）
    [2.8333, 7.9], // dock 收起（实测 FLIP 起点）
    [0.55, 0.126], // data-panel 展开
    [0.47, 0.29], // dock 展开
    [0.9, 0.35], // 小振幅宽轴
  ];
  for (const [sx, sy] of cases) {
    const { frames } = keyframes(-40, -60, sx, sy, { reduce: false, duration: 420 });
    const sc = scalesOf(frames);
    const xs = sc.map((v) => v[0]);
    const ys = sc.map((v) => v[1]);
    const ox = overshootOf(xs, sx);
    const oy = overshootOf(ys, sy);
    /* 硬规格：任一轴都落在 1.02–1.05 */
    assert.ok(ox >= 1.02 && ox <= 1.05, `sx=${sx} ox=${ox.toFixed(4)}`);
    assert.ok(oy >= 1.02 && oy <= 1.05, `sy=${sy} oy=${oy.toFixed(4)}`);
    /* 振幅足够（≥0.15，即 ≥15% 尺寸变化）时，两轴都精确标到 1.035，且各向同性 */
    if (Math.abs(1 - sx) >= 0.15 && Math.abs(1 - sy) >= 0.15) {
      assert.ok(Math.abs(ox - TARGET_OVERSHOOT) < 0.005, `sx=${sx} ox=${ox.toFixed(4)}`);
      assert.ok(Math.abs(oy - TARGET_OVERSHOOT) < 0.005, `sy=${sy} oy=${oy.toFixed(4)}`);
      assert.ok(Math.abs(ox - oy) < 0.006, `sx=${sx} sy=${sy} ox=${ox.toFixed(4)} oy=${oy.toFixed(4)}`);
    }
  }
});

test('逐轴标定后关键帧仍自洽：首帧 = 起点、末帧 = 恒等、无 NaN', () => {
  const { frames } = keyframes(-120, 80, 1.8182, 7.9, { reduce: false, duration: 360 });
  const first = /translate\(([-\d.]+)px,([-\d.]+)px\)\s*scale\(([-\d.]+),([-\d.]+)\)/.exec(frames[0].transform).slice(1).map(Number);
  assert.deepEqual([first[0], first[1], first[2], first[3]], [-120, 80, 1.8182, 7.9]);
  const last = /translate\(([-\d.]+)px,([-\d.]+)px\)\s*scale\(([-\d.]+),([-\d.]+)\)/.exec(frames[frames.length - 1].transform).slice(1).map(Number);
  assert.ok(Math.abs(last[0]) < 0.01 && Math.abs(last[1]) < 0.01);
  assert.ok(Math.abs(last[2] - 1) < 0.01 && Math.abs(last[3] - 1) < 0.01);
  for (const f of frames) assert.ok(!/NaN|Infinity/.test(f.transform), f.transform);
});

test('关键帧：首帧 = 起点，末帧 = 恒等，峰值 = 目标视觉放大', () => {
  const { frames, pPeak } = keyframes(-100, -200, 0.5, 0.4, { reduce: false, duration: 445 });
  assert.equal(frames[0].offset, 0);
  assert.equal(frames[frames.length - 1].offset, 1);
  const parse = (s) => {
    const m = /translate\(([-\d.]+)px,([-\d.]+)px\)\s*scale\(([-\d.]+),([-\d.]+)\)/.exec(s);
    return m ? m.slice(1).map(Number) : null;
  };
  const first = parse(frames[0].transform);
  assert.deepEqual(first, [-100, -200, 0.5, 0.4]);
  const last = parse(frames[frames.length - 1].transform);
  assert.ok(Math.abs(last[0]) < 0.01 && Math.abs(last[1]) < 0.01);
  assert.ok(Math.abs(last[2] - 1) < 0.01 && Math.abs(last[3] - 1) < 0.01);
  /* 逐轴标定：两轴视觉峰值都必须 = TARGET_OVERSHOOT（不再是两轴平均） */
  const sc = scalesOf(frames);
  const peakX = Math.max(...sc.map((v) => v[0]));
  const peakY = Math.max(...sc.map((v) => v[1]));
  for (const v of [peakX, peakY]) assert.ok(Math.abs(v - TARGET_OVERSHOOT) < 0.005, `peak ${v}`);
  assert.ok(pPeak > 1 && pPeak < 1.2);
});

test('小位移/等尺寸时不产生动画（返回 null）', async () => {
  const { run } = await import('./morph.js');
  const fake = { getBoundingClientRect: () => ({ left: 10, top: 10, width: 100, height: 100 }), animate: () => { throw new Error('should not animate'); } };
  assert.equal(run(fake, { left: 10, top: 10, width: 100, height: 100 }), null);
});

test('reduced-motion：150ms、ease-out、零回弹', () => {
  assert.equal(REDUCE_MS, 150);
  const { frames, pPeak } = keyframes(0, 0, 0.5, 0.5, { reduce: true, duration: 150 });
  assert.equal(pPeak, 1);
  for (const f of frames) {
    const v = Number(/scale\(([-\d.]+),/.exec(f.transform)[1]);
    assert.ok(v <= 1 + 1e-9, `scale ${v} > 1`);
  }
  assert.ok(TARGET_OVERSHOOT > 1.02 && TARGET_OVERSHOOT < 1.05);
});
