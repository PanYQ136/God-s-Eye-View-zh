import { test } from 'node:test';
import assert from 'node:assert/strict';

/* bridge 在浏览器里跟 window 打交道；这里给一个最小 window 替身，顺带证明
   「兼容面 = 白名单内的 getter/setter」这条契约是活的。 */
globalThis.window = globalThis.window || {};
globalThis.window.dispatchEvent = () => true;

const bridge = await import('./bridge.js');

test('register / get / has / dispose 基本契约', () => {
  const lens = { stats: () => ({ frames: 0 }) };
  bridge.register('edge.lens', lens, { owner: 'public/gev-edge-lens.js' });
  assert.equal(bridge.has('edge.lens'), true);
  assert.equal(bridge.get('edge.lens'), lens);
  assert.deepEqual(bridge.get('edge.lens').stats(), { frames: 0 });
  assert.equal(bridge.dispose('edge.lens'), true);
  assert.equal(bridge.has('edge.lens'), false);
  assert.equal(bridge.get('edge.lens', null), null);
  assert.equal(bridge.dispose('edge.lens'), false, 'dispose 必须幂等');
});

test('重复注册报错，replace 才允许覆盖', () => {
  bridge.register('lc.api', { v: 1 }, { owner: 'src/lc/index.js' });
  assert.throws(() => bridge.register('lc.api', { v: 2 }), /已被 .* 注册/);
  bridge.register('lc.api', { v: 3 }, { owner: 'src/lc/index.js', replace: true });
  assert.equal(bridge.get('lc.api').v, 3);
  bridge.dispose('lc.api');
});

test('非法名字与 undefined 注册值被拒绝', () => {
  assert.throws(() => bridge.register('edge lens', {}), TypeError);
  assert.throws(() => bridge.register('edge.lens', undefined), TypeError);
});

test('set 写命名空间属性，未注册命名空间报错', () => {
  const ns = bridge.ensure('lc', { owner: 'src/lc/index.js' });
  bridge.set('lc.result', { ok: true });
  assert.equal(ns.result.ok, true);
  assert.equal(bridge.get('lc').result.ok, true);
  assert.throws(() => bridge.set('nope.field', 1), /命名空间 nope 未注册/);
  bridge.dispose('lc');
});

test('window 兼容面只允许白名单名，且读写都落到槽位', () => {
  const edge = { set: () => {} };
  bridge.register('edge.lens', edge, { owner: 'lens', global: '__gevEdge' });
  assert.equal(window.__gevEdge, edge, '白名单名应直接可见');
  const other = { x: 1 };
  window.__gevEdge = other;
  assert.equal(bridge.get('edge.lens'), other, 'window 赋值必须回写槽位（gate 脚本会这么用）');
  assert.throws(() => bridge.register('edge.other', {}, { global: '__notWhitelisted' }), /白名单/);
  bridge.dispose('edge.lens');
  assert.equal(window.__gevEdge, undefined, 'dispose 后兼容面读到 undefined，而不是旧引用');
  delete window.__gevEdge;
});

test('disposeAll 按 owner 整块卸载', () => {
  bridge.register('edge.lens', {}, { owner: 'lens' });
  bridge.register('edge.lensState', {}, { owner: 'lens' });
  bridge.register('app.panelApi', {}, { owner: 'src/ui/panelChrome.js' });
  assert.equal(bridge.disposeAll('lens'), 2);
  assert.equal(bridge.has('app.panelApi'), true);
  bridge.disposeAll('src/ui/panelChrome.js');
  assert.deepEqual(bridge.list(), []);
});

test('总线版本可断言（gate 用）', () => {
  assert.match(bridge.version(), /^8d\./);
  assert.equal(bridge.toJSON, undefined);
});
