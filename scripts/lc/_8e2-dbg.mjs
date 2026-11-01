import { createDeferredLayerCatalog } from '../../src/app/catalog.js';

const ids = ['a', 'b'];
const schema = ids.map((id) => ({ id, disposition: 'enabled-only' }));
const catalog = createDeferredLayerCatalog([{ id: 'a' }], schema, {
  hydrate: async () => [{ id: 'b' }],
});
console.log('keys', Object.keys(catalog));
console.log('desc pending', JSON.stringify(Object.getOwnPropertyDescriptor(catalog, 'pendingLayerIds')));
const copy = Object.freeze(
  Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(catalog) }),
);
console.log('copy keys', Object.keys(copy));
console.log('copy pending', copy.pendingLayerIds, typeof copy.pendingLayerIds);
