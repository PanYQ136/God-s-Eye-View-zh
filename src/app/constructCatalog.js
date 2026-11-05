import { createDeferredLayerCatalog, createLayerCatalog } from './catalog.js';
import { LAYER_STATE_REGISTRY } from '../data/layerState.js';

const SOURCE_METHODS = Object.freeze({
  flights: ['getSnapshot'],
  military: ['getSnapshot'],
  vessels: ['getSnapshot'],
  cctv: ['getCatalog', 'getHealth', 'getFrameUrl', 'getMediaUrl'],
  radio: ['getDirectory', 'recordClick'],
  traffic: [
    'requestRoads',
    'getStatus',
    'fetchFlowForBounds',
    'getFlowSessionStats',
    'resetFlowTileCache',
  ],
  bikeshare: ['getStations'],
  installations: ['getMappedSites', 'searchNearby'],
  satellites: ['readGroup'],
  launches: ['getLaunches', 'getActiveTle'],
  alpr: ['fetch'],
  firms: ['getSnapshot'],
  wind: ['getSnapshot'],
  weather: ['getSnapshot'],
  cyclones: ['getSnapshot'],
  earthquakes: ['getSnapshot'],
  'fire-perimeters': ['getSnapshot'],
  cables: ['fetch'],
  'cn-traffic': ['getSnapshot'],
  'cn-admin': ['getSnapshot'],
  'cn-quakes': ['getSnapshot'],
  'cn-typhoon': ['getSnapshot'],
});

/**
 * Hardware-local layers are registered like any other but never enter share
 * links or stored layer state: another browser cannot have this receiver.
 */
export const LOCAL_ONLY_LAYER_METADATA = Object.freeze([
  Object.freeze({ id: 'local-adsb', disposition: 'local-only' }),
]);

/** Serialization metadata for every layer the application catalog constructs. */
export const APPLICATION_LAYER_METADATA = Object.freeze([
  ...LAYER_STATE_REGISTRY,
  ...LOCAL_ONLY_LAYER_METADATA,
]);

/**
 * Copy the catalog surface onto a new frozen object without forcing its getters.
 * `{ ...catalog }` would snapshot `layers` at construction time, which is exactly
 * what a deferred catalog must not do.
 */
function attachCatalogServices(catalog, services) {
  return Object.freeze(
    Object.defineProperties(
      {},
      {
        ...Object.getOwnPropertyDescriptors(catalog),
        ...Object.fromEntries(
          Object.entries(services).map(([key, value]) => [
            key,
            { value, enumerable: true },
          ]),
        ),
      },
    ),
  );
}

/** Construct the current catalog without choosing any source provider.
 * Scene engines remain page-owned; layers and classification have this app's lifetime.
 * The manager owns layer destruction, while abort releases classification even if startup fails.
 *
 * Phase8E · #16：图层工厂分两波 `import()` 拉取（首屏默认组 → 非默认组），
 * 所以本函数是 async；调用方必须 `await`。
 *
 * Phase8E2（t_1ad4e981）：`deferRest` 为真时不再在启动期拉取波次 2，而是返回
 * 一个 append-only catalog（波次 1 的 5 个默认图层 + 完整元数据），把波次 2 的
 * `import()`/构造交给调用方在首帧之后调用 `catalog.hydrate()` 触发。
 * 默认值 false：单测与 standalone 兼容入口拿到的是与 Phase8E 完全一致的一次性
 * 构造结果（33 层，顺序与 clock 隔离不变）。
 */
export async function createApplicationCatalog({
  surface,
  sources,
  signal,
  metadata = APPLICATION_LAYER_METADATA,
  vesselOptions,
  resolveAsset,
  nepalBoundaryResolver,
  deferRest = false,
}) {
  if (!signal?.addEventListener)
    throw new TypeError('An application lifetime signal is required');
  signal.throwIfAborted();
  if (!surface?.groundFloor || !surface?.terrain)
    throw new TypeError('Application surface services are required');

  for (const [name, methods] of Object.entries(SOURCE_METHODS)) {
    if (
      methods.some((method) => typeof sources?.[name]?.[method] !== 'function')
    )
      throw new TypeError(`Invalid catalog source: ${name}`);
  }
  // 波次 1：首屏默认图层（flights 组 + 分类/天气时钟/Bhote Koshi）。
  const {
    createMilitaryRegistry,
    createWeatherClock,
    createApplicationFlights,
    createApplicationMilitary,
    createApplicationLocalAdsb,
    createBhoteKoshiEventLayer,
    createBhoteKoshiLocatorLayer,
  } = await import('./catalogFactoriesCore.js');
  const militaryRegistry = createMilitaryRegistry();
  const weatherClock = createWeatherClock();
  const dispose = () => {
    signal.removeEventListener('abort', dispose);
    militaryRegistry.dispose();
    weatherClock.destroy();
  };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    militaryRegistry.configureSource(sources.military, { signal });
    const flights = createApplicationFlights({
      surface,
      source: sources.flights,
      militaryRegistry,
      resolveAsset,
    });
    const military = createApplicationMilitary({
      surface,
      source: sources.military,
      militaryRegistry,
      resolveAsset,
    });
    const coreLayers = [
      createBhoteKoshiEventLayer(),
      createBhoteKoshiLocatorLayer({
        boundaryResolver: nepalBoundaryResolver,
      }),
      flights,
      military,
      createApplicationLocalAdsb({
        surface,
        enrichment: sources.flights,
        displayParams: () => flights.getParams(),
        ...(resolveAsset ? { resolveAsset } : {}),
      }),
    ];
    /** 波次 2：非默认图层 chunk（22 个工厂），默认图层实例就位后再构造。
     *  顺序必须与一次性构造时 `catalog.layers` 的顺序逐条一致。 */
    const buildRestLayers = async () => {
      signal.throwIfAborted();
      const {
        createApplicationVessels,
        createApplicationCctv,
        createApplicationRadio,
        createApplicationTraffic,
        createApplicationBikeshare,
        createApplicationDirections,
        createApplicationRecentImagery,
        createApplicationTransit,
        createApplicationInstallations,
        createApplicationSatellites,
        createApplicationLaunches,
        createApplicationAlpr,
        createApplicationAwareness,
        createApplicationFirms,
        createApplicationEarthquakes,
        createApplicationFirePerimeters,
        createApplicationCables,
        createInfrastructureLayers,
        localGeoJsonServices,
        createWindLayer,
        createWeatherLayer,
        createCyclonesLayer,
        createApplicationCnTraffic,
        createApplicationCnAdmin,
        createApplicationCnQuakes,
        createApplicationCnTyphoon,
      } = await import('./catalogFactoriesRest.js');
      signal.throwIfAborted();
      const vessels = createApplicationVessels({
        source: sources.vessels,
        options: vesselOptions,
      });
      const installations = createApplicationInstallations({
        surface,
        source: sources.installations,
      });
      const satellites = createApplicationSatellites({
        source: sources.satellites,
      });
      return [
        createApplicationEarthquakes({ source: sources.earthquakes }),
        createApplicationFirePerimeters({
          source: sources['fire-perimeters'],
        }),
        createApplicationAlpr({ surface, source: sources.alpr }),
        satellites,
        createApplicationLaunches({ source: sources.launches, satellites }),
        createApplicationTraffic({ source: sources.traffic }),
        createApplicationCctv({ surface, source: sources.cctv }),
        createApplicationRadio({ surface, source: sources.radio }),
        createApplicationTransit({ surface, source: sources.transit }),
        createApplicationBikeshare({ source: sources.bikeshare }),
        createApplicationDirections(),
        createApplicationRecentImagery(),
        vessels,
        installations,
        createApplicationAwareness({
          flights,
          military,
          vessels,
          installations,
        }),
        createWindLayer({ feed: sources.wind, clock: weatherClock }),
        createWeatherLayer({
          feed: sources.weather,
          id: 'weather-radar',
          clock: weatherClock,
        }),
        createWeatherLayer({
          feed: sources.weather,
          id: 'weather-satellite',
          clock: weatherClock,
        }),
        createWeatherLayer({
          feed: sources.weather,
          id: 'weather-lightning',
          clock: weatherClock,
        }),
        createCyclonesLayer({ feed: sources.cyclones }),
        ...createInfrastructureLayers(localGeoJsonServices),
        createApplicationCables({ source: sources.cables }),
        createApplicationFirms({
          surface,
          id: 'local-firms',
          name: 'FIRMS Active Fires',
          icon: '▲',
          source: 'NASA FIRMS · LIVE',
          feed: sources.firms,
        }),
        createApplicationCnTraffic({ source: sources['cn-traffic'] }),
        createApplicationCnAdmin({ source: sources['cn-admin'] }),
        createApplicationCnQuakes({ source: sources['cn-quakes'] }),
        createApplicationCnTyphoon({ source: sources['cn-typhoon'] }),
      ];
    };
    const services = { militaryRegistry, surface, weatherClock };
    if (!deferRest) {
      const catalog = createLayerCatalog(
        [...coreLayers, ...(await buildRestLayers())],
        metadata,
      );
      return attachCatalogServices(catalog, services);
    }
    // 后置注册：注册表必须覆盖全部图层（add() 会拒绝注册表外的 id）。
    const catalog = createDeferredLayerCatalog(coreLayers, metadata, {
      hydrate: buildRestLayers,
    });
    return attachCatalogServices(catalog, services);
  } catch (error) {
    dispose();
    throw error;
  }
}
