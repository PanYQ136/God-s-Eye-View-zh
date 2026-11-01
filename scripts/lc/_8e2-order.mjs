import { createApplicationCatalog } from '../../src/app/constructCatalog.js';
import { createStandaloneLayerSources } from '../../src/standalone/layerSources.js';
import { createSurfaceServices } from '../../src/app/surfaceServices.js';

const controller = new AbortController();
const surface = createSurfaceServices({
  terrainSource: { getHeights: async () => [] },
  signal: controller.signal,
  eventTarget: null,
});
const sources = createStandaloneLayerSources();
sources.military = {
  getSnapshot: async () => [],
  async getIdentities(_q, { signal }) {
    signal?.addEventListener?.('abort', () => {});
    return [];
  },
};
const catalog = await createApplicationCatalog({
  sources,
  signal: controller.signal,
  surface,
  deferRest: true,
});
console.log('core', catalog.layers.map((l) => l.id));
console.log('keys', Object.keys(catalog)); console.log('pending', catalog.pendingLayerIds);
await catalog.hydrate();
console.log('all', catalog.layers.map((l) => l.id));
console.log('metadata', catalog.metadata.map((e) => e.id));
controller.abort();
