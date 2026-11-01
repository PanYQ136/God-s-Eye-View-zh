import { LayerLifecycle } from '../data/lifecycle.js';
import { LayerPresentation } from './layerPresentation.js';
import { createCyberSonarScene } from '../cyberSonarScene.js';
/** Register the application layer catalog before allowing state restoration. */
export function createApplicationData({
  scene: { viewer, mapStackController },
  controls: { styleManager },
  catalog,
  allowQaRegistration,
  onData,
  defer,
}) {
  // Initialize data layer manager
  const dataManager = new LayerLifecycle(viewer, {
    allowQaRegistration,
  });
  defer(async () => {
    await dataManager.destroyAll();
    if (dataManager.layers.size)
      throw new Error(
        `Data layers could not be destroyed: ${[...dataManager.layers.keys()].join(', ')}`,
      );
  });
  const presentation = new LayerPresentation(dataManager, {
    weatherClock: catalog?.weatherClock,
  });
  defer(() => presentation.destroy());
  onData?.(dataManager);
  if (!catalog?.layers || !catalog?.metadata)
    throw new TypeError('An application layer catalog is required');
  for (const layer of catalog.layers) dataManager.register(layer);
  for (const layer of catalog.layers) layer.attachDataManager?.(dataManager);
  for (const layer of catalog.layers)
    layer.attachMapStackController?.(mapStackController);
  // Phase8E2：catalog 可以是 append-only 的（波次 2 在首帧之后才注册）。
  // 已到位的图层在这里一次性注册；后到的图层通过 catalog.subscribeLayers
  // 逐个补注册——注册表完整性仍由 finalizeRegistrations 的 pending 名单保证。
  const pendingLayerIds = Array.isArray(catalog.pendingLayerIds)
    ? catalog.pendingLayerIds
    : [];
  if (typeof catalog.subscribeLayers === 'function') {
    const release = catalog.subscribeLayers((layer) => {
      dataManager.registerDeferred(layer);
      layer.attachDataManager?.(dataManager);
      layer.attachMapStackController?.(mapStackController);
      presentation.refresh();
    });
    defer(() => release());
  }
  // Restoration starts only after the caller's complete registry is sealed.
  dataManager.finalizeRegistrations(catalog.metadata, {
    allowPending: pendingLayerIds.length > 0,
  });
  if (allowQaRegistration) {
    window.__gevQaRegisterLayer = (targetManager, layerModule) => {
      if (targetManager !== dataManager)
        throw new Error('QA layer manager mismatch');
      return dataManager.registerForQa(layerModule);
    };
    window.__gevQaUnregisterLayer = (targetManager, layerId) => {
      if (targetManager !== dataManager)
        throw new Error('QA layer manager mismatch');
      return dataManager.unregisterForQa(layerId);
    };
    const register = window.__gevQaRegisterLayer;
    const unregister = window.__gevQaUnregisterLayer;
    defer(() => {
      if (window.__gevQaRegisterLayer === register)
        delete window.__gevQaRegisterLayer;
      if (window.__gevQaUnregisterLayer === unregister)
        delete window.__gevQaUnregisterLayer;
    });
  }
  presentation.mount(document.getElementById('data-toggles'));
  styleManager.attachDataManager(dataManager);
  defer(createCyberSonarScene(viewer, dataManager));

  return { dataManager, catalog, presentation };
}
