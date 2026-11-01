import { createSurfaceServices } from './surfaceServices.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApplicationCatalog } from './constructCatalog.js';
import { createStandaloneLayerSources } from '../standalone/layerSources.js';
import { catalogControlServices } from './catalog.js';
import { LayerLifecycle } from '../data/lifecycle.js';

function fixtureSources(ids, calls) {
  const sources = createStandaloneLayerSources();
  sources.military = {
    getSnapshot: async () => {
      throw new Error('Use identity acquisition');
    },
    async getIdentities(_query, { signal }) {
      calls.push(signal);
      return ids;
    },
  };
  return sources;
}

test('catalogs construct distinct layers and classification from their supplied source', async (t) => {
  const a = new AbortController();
  const b = new AbortController();
  t.after(() => {
    a.abort();
    b.abort();
  });
  const callsA = [];
  const callsB = [];
  const first = await createApplicationCatalog({
    sources: fixtureSources(['abc123'], callsA),
    signal: a.signal,
    surface: fixtureSurface(a.signal),
  });
  const second = await createApplicationCatalog({
    sources: fixtureSources(['def456'], callsB),
    signal: b.signal,
    surface: fixtureSurface(b.signal),
  });
  assert.equal(first.layers.length, 29);
  assert.ok(first.get('local-adsb'), 'Local ADS-B is registered');
  assert.deepEqual(
    first.metadata.find(({ id }) => id === 'local-adsb'),
    { id: 'local-adsb', disposition: 'local-only' },
    'the hardware-local layer is never serialized into links',
  );
  assert.notEqual(first.weatherClock, second.weatherClock);
  await first.weatherClock.setTarget('2026-09-21T12:00:00.000Z');
  assert.match(
    first.get('wind').getRowControls().info,
    /Forecast · does not follow history/,
  );
  assert.equal(second.get('wind').getRowControls().summary.status, null);
  for (const id of ['weather-radar', 'weather-satellite', 'weather-lightning'])
    assert.equal(
      first.get(id).getDiagnostics().clock.target,
      '2026-09-21T12:00:00.000Z',
    );
  assert.ok(first.get('fire-perimeters'));
  assert.ok(first.get('transit'));
  const order = first.layers.map(({ id }) => id);
  assert.deepEqual(
    order.slice(order.indexOf('traffic'), order.indexOf('directions') + 1),
    ['traffic', 'cctv', 'radio', 'transit', 'bikeshare', 'directions'],
  );
  assert.ok(first.get('bhote-koshi-2026'));
  assert.ok(first.get('bhote-koshi-locator'));
  const lifecycle = new LayerLifecycle({});
  for (const layer of first.layers) lifecycle.register(layer);
  const rows = lifecycle.getAll();
  for (const id of ['bhote-koshi-2026', 'bhote-koshi-locator']) {
    assert.equal(
      rows.find((row) => row.id === id)?.showInTogglePanel,
      false,
      `${id} remains registered for Scenes but is absent from Data Layers`,
    );
    assert.equal(typeof first.get(id).enable, 'function');
    assert.equal(typeof first.get(id).setParams, 'function');
  }
  assert.equal(
    rows.find((row) => row.id === 'flights')?.showInTogglePanel,
    true,
    'ordinary data layer entries remain visible',
  );
  assert.deepEqual(
    first.layers.map(({ id }) => id),
    second.layers.map(({ id }) => id),
  );
  for (const layer of first.layers)
    assert.notEqual(layer, second.get(layer.id));
  assert.equal(
    catalogControlServices(first).satellitesLayer,
    first.get('satellites'),
  );
  assert.equal(callsA.length, 0, 'construction must not acquire');
  await first.militaryRegistry.refreshMilitaryRegistryIfStale();
  await second.militaryRegistry.refreshMilitaryRegistryIfStale();
  assert.equal(first.militaryRegistry.isMilitaryIcao('abc123'), true);
  assert.equal(first.militaryRegistry.isMilitaryIcao('def456'), false);
  assert.equal(second.militaryRegistry.isMilitaryIcao('def456'), true);
  a.abort();
  assert.equal(
    await first.weatherClock.setTarget('2026-09-21T13:00:00.000Z'),
    false,
  );
  assert.equal(callsA[0].aborted, true);
  assert.equal(first.militaryRegistry.isMilitaryIcao('abc123'), false);
  assert.equal(callsB[0].aborted, false);
  assert.equal(second.militaryRegistry.isMilitaryIcao('def456'), true);
});

test('invalid or already cancelled construction fails before classification can acquire', async () => {
  const lifetime = new AbortController();
  await assert.rejects(
    () =>
      createApplicationCatalog({
        sources: {},
        signal: lifetime.signal,
        surface: fixtureSurface(lifetime.signal),
      }),
    /catalog source/,
  );
  lifetime.abort();
  await assert.rejects(
    () =>
      createApplicationCatalog({
        sources: createStandaloneLayerSources(),
        signal: lifetime.signal,
      }),
    { name: 'AbortError' },
  );
});

function fixtureSurface(signal) {
  return createSurfaceServices({
    terrainSource: { getHeights: async () => [] },
    signal,
    eventTarget: null,
  });
}

/** The catalog order frozen by Phase8E — deferred hydration must reproduce it. */
const CATALOG_LAYER_ORDER = Object.freeze([
  'bhote-koshi-2026',
  'bhote-koshi-locator',
  'flights',
  'military',
  'local-adsb',
  'earthquakes',
  'fire-perimeters',
  'alpr-cameras',
  'satellites',
  'rocket-launches',
  'traffic',
  'cctv',
  'radio',
  'transit',
  'bikeshare',
  'directions',
  'recent-imagery',
  'ais-live-vessels',
  'military-installations',
  'military-awareness',
  'wind',
  'weather-radar',
  'weather-satellite',
  'weather-lightning',
  'weather-cyclones',
  'local-datacenters',
  'local-dams',
  'telegeography-submarine-cables',
  'local-firms',
]);
const CORE_LAYER_ORDER = CATALOG_LAYER_ORDER.slice(0, 5);

test('deferred construction keeps the registry, order and clock isolation intact', async (t) => {
  const lifetime = new AbortController();
  t.after(() => lifetime.abort());
  const catalog = await createApplicationCatalog({
    sources: fixtureSources(['abc123'], []),
    signal: lifetime.signal,
    surface: fixtureSurface(lifetime.signal),
    deferRest: true,
  });
  // Wave 1 arrives at startup; wave 2 is declared but not built.
  assert.deepEqual(
    catalog.layers.map(({ id }) => id),
    CORE_LAYER_ORDER,
  );
  assert.equal(catalog.metadata.length, 29, 'the registry is complete');
  assert.equal(CATALOG_LAYER_ORDER.length - CORE_LAYER_ORDER.length, catalog.pendingLayerIds.length);
  // Control bindings captured at startup survive the deferral.
  const services = catalogControlServices(catalog);
  assert.equal(services.flightsLayer, catalog.get('flights'));
  const satellitesHandle = services.satellitesLayer;
  assert.equal(satellitesHandle.id, 'satellites');
  assert.equal(
    typeof satellitesHandle.getDetectableObjects,
    'undefined',
    'a pending handle exposes no methods before the factory arrives',
  );
  await catalog.hydrate();
  assert.deepEqual(
    catalog.layers.map(({ id }) => id),
    CATALOG_LAYER_ORDER,
    'deferred registration reproduces the frozen catalog order',
  );
  assert.deepEqual(catalog.pendingLayerIds, []);
  assert.equal(typeof satellitesHandle.getDetectableObjects, 'function');
  assert.equal(
    catalog.resolve('satellites'),
    catalog.get('satellites'),
    'a materialized layer resolves to the real instance',
  );
  // Clock isolation still holds: every weather layer reads THIS catalog's clock.
  await catalog.weatherClock.setTarget('2026-09-21T12:00:00.000Z');
  assert.match(
    catalog.get('wind').getRowControls().info,
    /Forecast · does not follow history/,
  );
  for (const id of ['weather-radar', 'weather-satellite', 'weather-lightning'])
    assert.equal(
      catalog.get(id).getDiagnostics().clock.target,
      '2026-09-21T12:00:00.000Z',
    );
  assert.equal(
    catalog.metadata.find(({ id }) => id === 'local-adsb').disposition,
    'local-only',
    'the hardware-local layer stays local-only through the deferral',
  );
  assert.ok(catalog.get('local-adsb'), 'local ADS-B is available from wave 1');
});

