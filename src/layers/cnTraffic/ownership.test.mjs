import assert from 'node:assert/strict';
import test from 'node:test';
import { createCnTrafficLayer } from './index.js';
import { createCnTrafficSource } from './source.js';

// 与 src/layers/earthquakes/ownership.test.mjs 同构：验证「晚到刷新不可在
// disable/destroy 后发布」「两个显示各自拥有独立 dataSource」「source 尊重 abort」。
// cnTraffic 的 update() 需要相机视口 bbox，故 harness 提供最小可用 camera。
function makeViewer() {
  const sources = [];
  const viewer = {
    dataSources: {
      add(value) {
        sources.push(value);
      },
      remove(value) {
        const i = sources.indexOf(value);
        if (i >= 0) sources.splice(i, 1);
      },
    },
    camera: {
      computeViewRectangle() {
        return { west: -1, south: 0.5, east: 1, north: 1 };
      },
    },
  };
  return { viewer, sources };
}

function harness(source) {
  const { viewer, sources } = makeViewer();
  const layer = createCnTrafficLayer({ source });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources };
}

const row = {
  stableId: 'cell-0',
  lat: 31.2,
  lng: 121.4,
  radius: 800,
  level: 2,
  label: '缓行',
  expedite: 0,
  congested: 0,
  blocked: 0,
  sample: 0,
};

test('late refresh cannot publish after disable, re-enable, or destroy', async () => {
  for (const action of ['disable', 'destroy']) {
    let resolve, signal;
    const h = harness({
      getSnapshot(options) {
        signal = options.signal;
        return new Promise((done) => {
          resolve = done;
        });
      },
    });
    const pending = h.layer.update(h.viewer);
    h.layer[action](h.viewer);
    assert.equal(signal.aborted, true);
    if (action === 'disable') h.layer.enable(h.viewer);
    resolve([row]);
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    h.layer.destroy(h.viewer);
  }
});

test('two displays own separate data sources and destruction', async () => {
  const a = harness({ getSnapshot: async () => [row] });
  const b = harness({ getSnapshot: async () => [] });
  await a.layer.update(a.viewer);
  await b.layer.update(b.viewer);
  assert.equal(a.layer.getStats().count, 1);
  assert.equal(b.layer.getStats().count, 0);
  a.layer.destroy();
  assert.equal(a.sources.length, 0);
  assert.equal(b.sources.length, 1);
  b.layer.destroy();
});

test('source cancellation honors abort', async () => {
  const abort = new AbortController();
  const source = createCnTrafficSource({
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        abort.abort();
        return {};
      },
    }),
  });
  await assert.rejects(
    source.getSnapshot({
      signal: abort.signal,
      bbox: [-10, -10, 10, 10],
      grid: 2,
    }),
    { name: 'AbortError' },
  );
});
