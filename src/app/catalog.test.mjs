import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayerCatalog, createDeferredLayerCatalog, catalogControlServices } from './catalog.js';
import { createPendingLayerHandle } from './pendingLayer.js';
import { createApplicationData } from './data.js';

const metadata = (layers) =>
  layers.map(({ id }) => ({ id, disposition: 'enabled-only' }));

test('catalog captures membership and metadata while preserving the supplied instances', () => {
  const first = { id: 'first' };
  const layers = [first];
  const schema = metadata(layers);
  const catalog = createLayerCatalog(layers, schema);
  layers.push({ id: 'later' });
  schema[0].disposition = 'invalid';
  assert.deepEqual(catalog.layers, [first]);
  assert.equal(catalog.get('first'), first);
  assert.equal(catalog.get('later'), undefined);
  assert.equal(catalog.metadata[0].disposition, 'enabled-only');
  assert.throws(() => catalog.layers.push({ id: 'later' }), TypeError);
});

test('duplicate, missing and extra metadata fail before application registration', () => {
  const layers = [{ id: 'first' }];
  assert.throws(
    () => createLayerCatalog([...layers, ...layers], metadata(layers)),
    /duplicate/,
  );
  assert.throws(() => createLayerCatalog(layers, []), /incomplete/);
  assert.throws(
    () => createLayerCatalog(layers, metadata([{ id: 'other' }])),
    /Unmatched/,
  );
  assert.throws(
    () =>
      createLayerCatalog(layers, [...metadata(layers), ...metadata(layers)]),
    /duplicate/,
  );
});

test('data setup seals the caller catalog before controls can restore and drains its exact instances', async (t) => {
  const previous = globalThis.document;
  globalThis.document = { getElementById: () => null };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  const attached = [];
  const layers = [
    {
      id: 'one',
      attachDataManager: (manager) => attached.push([...manager.layers.keys()]),
    },
    { id: 'two' },
  ];
  const releases = [];
  let observed;
  const { dataManager } = createApplicationData({
    scene: { viewer: {} },
    controls: {
      styleManager: {
        attachDataManager(manager) {
          assert.equal(manager.registrationsFinalized, true);
          assert.equal(manager.layers.get('one').module, layers[0]);
        },
      },
    },
    catalog: createLayerCatalog(layers, metadata(layers)),
    defer: (release) => releases.push(release),
    onData: (manager) => {
      observed = manager;
    },
  });
  assert.equal(observed, dataManager);
  assert.deepEqual(attached, [['one', 'two']]);
  assert.deepEqual([...dataManager.layers.keys()], ['one', 'two']);
  assert.throws(() => dataManager.register({ id: 'late' }), /finalized/);
  for (const release of releases.reverse()) await release();
  assert.equal(dataManager.layers.size, 0);
});

test('controls bind catalog instances rather than similarly named defaults', () => {
  const ids = [
    'traffic',
    'flights',
    'military',
    'satellites',
    'cctv',
    'radio',
    'bikeshare',
    'transit',
    'ais-live-vessels',
    'military-awareness',
    'military-installations',
    'rocket-launches',
    'local-adsb',
  ];
  const layers = ids.map((id) => ({ id }));
  const catalog = createLayerCatalog(layers, metadata(layers));
  const services = catalogControlServices(catalog);
  assert.equal(services.flightsLayer, layers[1]);
  assert.equal(services.transitLayer, layers[7]);
  assert.equal(services.aisLiveVesselsLayer, layers[8]);
  assert.equal(services.localAdsbLayer, layers[12]);
  assert.equal(new Set(Object.values(services)).size, layers.length);
  assert.throws(
    () => catalogControlServices(createLayerCatalog([], [])),
    /Control layer missing/,
  );
});

test('a deferred catalog declares the full registry while instances arrive later', async () => {
  const ids = [
    'traffic',
    'flights',
    'military',
    'satellites',
    'cctv',
    'radio',
    'bikeshare',
    'transit',
    'ais-live-vessels',
    'military-awareness',
    'military-installations',
    'rocket-launches',
    'local-adsb',
  ];
  const schema = metadata(ids.map((id) => ({ id })));
  const flights = { id: 'flights' };
  const produced = ids.filter((id) => id !== 'flights').map((id) => ({ id }));
  let builds = 0;
  const catalog = createDeferredLayerCatalog([flights], schema, {
    hydrate: async () => {
      builds += 1;
      return produced;
    },
  });
  assert.deepEqual(catalog.layers, [flights]);
  assert.equal(
    catalog.metadata.length,
    ids.length,
    'the registry is complete from the start',
  );
  assert.equal(catalog.pendingLayerIds.length, ids.length - 1);
  assert.equal(catalog.complete, false);
  assert.equal(catalog.get('satellites'), undefined);

  // Control bindings captured before hydration keep working afterwards.
  const services = catalogControlServices(catalog);
  assert.equal(services.flightsLayer, flights);
  assert.equal(services.satellitesLayer.id, 'satellites');
  assert.equal(
    typeof services.satellitesLayer.getDetectableObjects,
    'undefined',
  );

  const added = [];
  const release = catalog.subscribeLayers((layer) => added.push(layer.id));
  const restIds = ids.filter((id) => id !== 'flights');
  const first = catalog.hydrate();
  const second = catalog.hydrate();
  assert.equal(first, second, 'hydration is single-flight');
  await first;
  assert.equal(builds, 1);
  assert.deepEqual(added, restIds);
  assert.deepEqual(
    catalog.layers.map(({ id }) => id),
    ['flights', ...restIds],
  );
  assert.equal(catalog.complete, true);
  assert.equal(catalog.get('satellites').id, 'satellites');
  // The handle forwards to the real instance once it exists.
  assert.equal(services.satellitesLayer === undefined, false);
  release();
  assert.throws(() => catalog.add({ id: 'satellites' }), /duplicate/);
  assert.throws(() => catalog.add({ id: 'nope' }), /incomplete/);
});

test('a pending handle queues subscriptions, ignores unknown reads and materializes once', async () => {
  let real;
  const handle = createPendingLayerHandle('satellites', () => real);
  assert.equal(handle.id, 'satellites');
  assert.equal(handle.pending, true);
  assert.equal(typeof handle.getDetectableObjects, 'undefined');
  const seen = [];
  const release = handle.subscribe((state) => seen.push(state));
  real = {
    id: 'satellites',
    subscribe(callback) {
      callback('first');
      return () => seen.push('released');
    },
    getTrackedInfo: () => ({ tracked: true }),
  };
  assert.equal(handle.pending, false, 'reads resolve the materialized layer');
  handle.materialize(real);
  await Promise.resolve();
  assert.deepEqual(seen, ['first']);
  assert.deepEqual(handle.getTrackedInfo(), { tracked: true });
  release();
  assert.deepEqual(seen, ['first', 'released']);
});

test('deferred data setup seals the declared registry and registers late layers once', async () => {
  const previous = globalThis.document;
  globalThis.document = { getElementById: () => null };
  try {
    const releases = [];
    const attachedTo = [];
    const late = {
      id: 'satellites',
      attachDataManager: (manager) => attachedTo.push([...manager.layers.keys()]),
    };
    const catalog = createDeferredLayerCatalog(
      [{ id: 'flights' }],
      metadata([{ id: 'flights' }, { id: 'satellites' }]),
      { hydrate: async () => [late] },
    );
    const { dataManager } = createApplicationData({
      scene: { viewer: {} },
      controls: { styleManager: { attachDataManager() {} } },
      catalog,
      defer: (release) => releases.push(release),
      onData: () => {},
    });
    assert.equal(dataManager.registrationsFinalized, true);
    assert.deepEqual([...dataManager.layers.keys()], ['flights']);
    assert.deepEqual(dataManager.pendingLayerIds, ['satellites']);
    await catalog.hydrate();
    // Deferred registration lands synchronously with the catalog add.
    assert.deepEqual([...dataManager.layers.keys()], ['flights', 'satellites']);
    assert.deepEqual(attachedTo, [['flights', 'satellites']]);
    assert.deepEqual(dataManager.pendingLayerIds, []);
    for (const release of releases.reverse()) await release();
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});
