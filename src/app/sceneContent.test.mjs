import test from 'node:test';
import assert from 'node:assert/strict';
import { contentStats, isSceneContentVisible } from './sceneContent.js';

function fill(w, h, fn) {
  const buf = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const [r, g, b, a = 255] = fn(x, y);
      const p = (y * w + x) * 4;
      buf[p] = r;
      buf[p + 1] = g;
      buf[p + 2] = b;
      buf[p + 3] = a;
    }
  return buf;
}

test('uniform fill has zero spread (未成片的灰屏)', () => {
  const s = contentStats(fill(32, 32, () => [83, 83, 83]));
  assert.equal(s.std, 0);
  assert.equal(s.uniq, 1);
  assert.equal(s.mean, 83);
  assert.equal(isSceneContentVisible(s), false);
});

test('two-tone fill has spread but too few unique colours', () => {
  const s = contentStats(fill(40, 40, (x) => (x < 20 ? [0, 0, 0] : [255, 255, 255])));
  assert.ok(s.std > 18);
  assert.equal(s.uniq, 2);
  assert.equal(isSceneContentVisible(s), false);
});

test('real imagery-like noise is visible (成片)', () => {
  const s = contentStats(fill(64, 64, (x, y) => {
    const v = (x * 7 + y * 13) % 256;
    return [v, (v * 3 + x) % 256, (v * 5 + y * 2) % 256];
  }));
  assert.ok(s.std >= 18, `std ${s.std}`);
  assert.ok(s.uniq >= 800, `uniq ${s.uniq}`);
  assert.equal(isSceneContentVisible(s), true);
});

test('empty buffer is not visible', () => {
  const s = contentStats(new Uint8Array(0));
  assert.equal(s.px, 0);
  assert.equal(isSceneContentVisible(s), false);
});

test('thresholds are参数化且 null 安全', () => {
  const sample = { std: 20, uniq: 900 };
  assert.equal(isSceneContentVisible(sample), true);
  assert.equal(isSceneContentVisible(sample, { minStd: 30 }), false);
  assert.equal(isSceneContentVisible(null), false);
});
