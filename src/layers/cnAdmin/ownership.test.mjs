import assert from 'node:assert/strict';
import test from 'node:test';
import { createCnAdminLayer } from './index.js';
import { createCnAdminSource } from './source.js';

// 与 src/layers/earthquakes/ownership.test.mjs 同构：验证「晚到刷新不可在
// disable/destroy 后发布」「两个显示各自拥有独立 dataSource」「source 尊重 abort」。
// cnAdmin 的 update() 取相机视口中心作为行政区查询点（无相机时回退北京），
// 故 harness 提供最小可用 camera；归一化快照直接由 source 返回（layer 信任其结构）。
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
        return { west: 2.0, south: 0.5, east: 2.2, north: 0.7 };
      },
    },
  };
  return { viewer, sources };
}

function harness(source) {
  const { viewer, sources } = makeViewer();
  const layer = createCnAdminLayer({ source });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources };
}

// 归一化快照：一个市界环（4 点方框，足够 addRings 计数 1 个多边形实体）。
const citySnapshot = {
  city: 'Shanghai',
  cityBoundary: {
    name: 'Shanghai',
    polyline: '121.0,31.0;121.8,31.0;121.8,31.8;121.0,31.8',
  },
  districts: [],
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
    resolve(citySnapshot);
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    h.layer.destroy(h.viewer);
  }
});

test('two displays own separate data sources and destruction', async () => {
  const a = harness({ getSnapshot: async () => citySnapshot });
  const b = harness({ getSnapshot: async () => null }); // 无数据：境外/兜底失败
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
  const source = createCnAdminSource({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        abort.abort();
        return {};
      },
    }),
  });
  await assert.rejects(
    source.getSnapshot({
      signal: abort.signal,
      lat: 31.2,
      lng: 121.4,
    }),
    { name: 'AbortError' },
  );
});
