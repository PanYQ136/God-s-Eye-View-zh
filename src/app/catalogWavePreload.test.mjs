/**
 * 波次预取（D2-3）：`preloadCatalogFactories` 是 `createApplicationCatalog`
 * 之前唯一能提前发起波次请求的入口，必须满足三件事——
 * 幂等共享（同一请求不会发两遍）、失败可重试（不污染后续构造）、可关闭（A/B）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { preloadCatalogFactories } from './constructCatalog.js';

function withLocation(search, fn) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    value: { search },
    configurable: true,
    writable: true,
  });
  try {
    return fn();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'location', descriptor);
    else delete globalThis.location;
  }
}

test('the preload hands the same request to every caller', async () => {
  const first = preloadCatalogFactories();
  const second = preloadCatalogFactories();
  assert.ok(first, 'preload is enabled by default');
  assert.equal(first, second, 'a second caller reuses the in-flight request');

  const factories = await first;
  assert.equal(typeof factories.createApplicationFlights, 'function');
  assert.equal(typeof factories.createApplicationFirms, 'function');
  assert.ok(
    Object.isFrozen(factories),
    'the shared record is frozen so callers cannot rewrite it',
  );
});

test('the preload resolves the same factories the catalog then builds from', async () => {
  const factories = await preloadCatalogFactories();
  // Both waves contribute: core (flights/military/registry) and rest (weather,
  // vessels, every CN layer, the overlay collections).
  for (const name of [
    'createMilitaryRegistry',
    'createWeatherClock',
    'createApplicationFlights',
    'createCyclonesLayer',
    'createApplicationCnTyphoon',
    'createOsmOverlayLayers',
    'createInfrastructureLayers',
  ]) {
    assert.equal(typeof factories[name], 'function', `${name} is preloaded`);
  }
});

test('?wavepreload=0 restores on-demand loading', () => {
  withLocation('?wavepreload=0', () => {
    assert.equal(preloadCatalogFactories(), null, 'the escape hatch returns null');
  });
  withLocation('', () => {
    assert.ok(preloadCatalogFactories(), 'default stays preloaded');
  });
});
