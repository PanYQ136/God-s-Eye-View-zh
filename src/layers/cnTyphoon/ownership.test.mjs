import assert from 'node:assert/strict';
import test from 'node:test';
import { createCnTyphoonLayer } from './index.js';
import { createCnTyphoonSource } from './source.js';

// 与 src/layers/earthquakes/ownership.test.mjs 同构：验证「晚到刷新不可在
// disable/destroy 后发布」「两个显示各自拥有独立 dataSource」「source 尊重 abort」。
// cnTyphoon 的 update() 直取快照（无需相机），快照为归一化台风数组。
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
  };
  return { viewer, sources };
}

function harness(source) {
  const { viewer, sources } = makeViewer();
  const layer = createCnTyphoonLayer({ source });
  layer.init(viewer);
  layer.enable(viewer);
  return { layer, viewer, sources };
}

// 一个台风：3 个实况点（渲染 1 条路径线 + 3 个点 = 4 个实体），无预报点。
const storm = {
  id: '2024-01',
  nameEn: 'KOINU',
  nameCn: '小犬',
  year: '2024',
  points: [
    { lng: 121.0, lat: 21.0, grade: 'TY', pressure: 945, wind: 45, ms: 1 },
    { lng: 121.5, lat: 21.5, grade: 'TY', pressure: 940, wind: 48, ms: 2 },
    { lng: 122.0, lat: 22.0, grade: 'STY', pressure: 935, wind: 52, ms: 3 },
  ],
  forecast: [],
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
    resolve([storm]);
    assert.equal(await pending, false);
    assert.equal(h.layer.getStats().count, 0);
    h.layer.destroy(h.viewer);
  }
});

test('two displays own separate data sources and destruction', async () => {
  const a = harness({ getSnapshot: async () => [storm] });
  const b = harness({ getSnapshot: async () => [] });
  await a.layer.update(a.viewer);
  await b.layer.update(b.viewer);
  assert.equal(a.layer.getStats().count, 5); // 1 路径线 + 3 实况点 + 1 标签
  assert.equal(b.layer.getStats().count, 0);
  a.layer.destroy();
  assert.equal(a.sources.length, 0);
  assert.equal(b.sources.length, 1);
  b.layer.destroy();
});

test('source cancellation honors abort', async () => {
  const abort = new AbortController();
  const source = createCnTyphoonSource({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        abort.abort();
        return {};
      },
    }),
  });
  await assert.rejects(source.getSnapshot({ signal: abort.signal }), {
    name: 'AbortError',
  });
});
