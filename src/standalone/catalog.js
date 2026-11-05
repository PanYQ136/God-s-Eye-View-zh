import { createSurfaceServices } from '../app/surfaceServices.js';
import { createApplicationRequestServices } from '../services/requests.js';
import { createApplicationCatalog } from '../app/constructCatalog.js';
import { createStandaloneLayerSources } from './layerSources.js';
export { createStandaloneReferenceSources } from './layerSources.js';

/**
 * Create fresh layer instances using the existing standalone source choices.
 *
 * Phase8E · #16：`createApplicationCatalog` 已成 async（图层工厂分两波 `import()`），
 * 所以这里同样是 async。启动链路里唯一的调用点是
 * `src/standalone/application.js` 的 `createScene`（本来就是 async）。
 *
 * Phase8E2：默认 `deferRest: true` —— 波次 2 的 22 个非默认图层不在启动期构造，
 * 由 `scheduleCatalogHydration()` 在应用就绪后的首个空闲帧水合并后置注册。
 * `?layerdefer=0` 回到 Phase8E 的一次性构造（A/B 与回滚用）。
 */
export async function createStandaloneCatalog({
  nepalBoundaryResolver,
  sources = {},
  streetLevelProviders,
  signal = new AbortController().signal,
  surface = createSurfaceServices({
    terrainSource: createApplicationRequestServices().terrain,
    signal,
  }),
} = {}) {
  return createApplicationCatalog({
    nepalBoundaryResolver,
    surface,
    sources: createStandaloneLayerSources(sources),
    streetLevelProviders,
    signal,
    deferRest:
      typeof location === 'undefined' ||
      new URLSearchParams(location.search).get('layerdefer') !== '0',
    vesselOptions: {
      maxRows: import.meta.env?.VITE_AIS_LIVE_MAX_ROWS,
      maxLabels: import.meta.env?.VITE_AIS_LIVE_LABEL_MAX_ROWS,
    },
  });
}

// 兼容目录：由启动链路 `setStandaloneCatalog()` 装入（catalog 构造已是 async）。
let compatibilityCatalog;
/** @deprecated Phase8E：catalog 构造已 async。新代码请 `await createStandaloneCatalog()`
 *  并把实例显式传下去；本入口只返回启动链路 `setStandaloneCatalog()` 装入的那一份。 */
export function getStandaloneCatalog() {
  if (!compatibilityCatalog)
    throw new TypeError(
      'getStandaloneCatalog(): catalog construction is async since Phase8E — await createStandaloneCatalog() and pass the result explicitly',
    );
  return compatibilityCatalog;
}

/** Publish the catalog built by the async startup path for legacy compat callers. */
export function setStandaloneCatalog(catalog) {
  compatibilityCatalog = catalog;
  return catalog;
}
