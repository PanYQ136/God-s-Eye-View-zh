import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleCatalogHydration } from './deferredCatalog.js';

const immediateFrame = (fn) => fn();
const immediateIdle = (fn) => fn();

function deferredCatalog({ pending = 2 } = {}) {
  let resolveHydrate;
  const state = { hydrations: 0, pending };
  const catalog = {
    get pendingLayerIds() {
      return Array.from({ length: state.pending }, (_, i) => `layer-${i}`);
    },
    hydrate() {
      state.hydrations += 1;
      return new Promise((resolve) => {
        resolveHydrate = () => {
          state.pending = 0;
          resolve(catalog);
        };
      });
    },
    finish() {
      resolveHydrate();
    },
  };
  return { catalog, state };
}

test('hydration waits for a frame, then idle, then pulls the layer chunk', async () => {
  const { catalog, state } = deferredCatalog();
  const calls = [];
  const promise = scheduleCatalogHydration(catalog, {
    requestFrame: (fn) => {
      calls.push('frame');
      fn();
    },
    requestIdle: (fn) => {
      calls.push('idle');
      fn();
    },
  });
  assert.deepEqual(calls, ['frame', 'idle']);
  assert.equal(state.hydrations, 1);
  catalog.finish();
  const result = await promise;
  assert.equal(result.ok, true);
  assert.equal(result.pendingBefore, 2);
  assert.equal(result.pendingAfter, 0);
  assert.equal(typeof result.frameAt, 'number');
  assert.equal(typeof result.startAt, 'number');
  assert.equal(typeof result.doneAt, 'number');
  assert.equal(globalThis.__gevCatalogHydration, result);
});

test('an eager catalog, a disabled schedule and an empty pending set are no-ops', async () => {
  const eager = await scheduleCatalogHydration(
    { layers: [] },
    { requestFrame: immediateFrame, requestIdle: immediateIdle },
  );
  assert.equal(eager.supported, false);
  assert.equal(eager.reason, 'eager-catalog');

  const { catalog, state } = deferredCatalog();
  const disabled = await scheduleCatalogHydration(catalog, {
    disabled: true,
    requestFrame: immediateFrame,
    requestIdle: immediateIdle,
  });
  assert.equal(disabled.reason, 'disabled');
  assert.equal(state.hydrations, 0);

  const { catalog: complete, state: completeState } = deferredCatalog({
    pending: 0,
  });
  const nothing = await scheduleCatalogHydration(complete, {
    requestFrame: immediateFrame,
    requestIdle: immediateIdle,
  });
  assert.equal(nothing.reason, 'nothing-pending');
  assert.equal(completeState.hydrations, 0);
});

test('a failed chunk keeps the application alive and reports the failure', async () => {
  const errors = [];
  const previous = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    const catalog = {
      get pendingLayerIds() {
        return ['layer-0'];
      },
      hydrate: () => Promise.reject(new Error('chunk exploded')),
    };
    const result = await scheduleCatalogHydration(catalog, {
      requestFrame: immediateFrame,
      requestIdle: immediateIdle,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /chunk exploded/);
    assert.equal(errors.length, 1);
  } finally {
    console.error = previous;
  }
});
