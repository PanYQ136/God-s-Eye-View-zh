<<<<<<< ours
import { resolveCatalogSources } from './sourceComposition.js';
import { createWeatherClock } from '../layers/weather/clock.js';
import { createWeatherLayer } from '../layers/weather/index.js';
import { createCyclonesLayer } from '../layers/cyclones/index.js';
import { createWindLayer } from '../layers/wind/index.js';
import { createLayerCatalog } from './catalog.js';
import { LAYER_STATE_REGISTRY } from '../data/layerState.js';
import { createMilitaryRegistry } from '../layers/aircraft/classification.js';
import { createApplicationFlights } from './layers/flights.js';
import { createApplicationMilitary } from './layers/militaryFlights.js';
import { createApplicationVessels } from './layers/aisLiveVessels.js';
import { createApplicationCctv } from './layers/cctv.js';
import { createApplicationRadio } from './layers/radio.js';
import { createApplicationTraffic } from './layers/traffic.js';
import { createApplicationBikeshare } from './layers/bikeshare.js';
import { createApplicationDirections } from './layers/directions.js';
import { createApplicationRecentImagery } from './layers/recentImagery.js';
import { createApplicationOsmPlaces } from './layers/osmPlaces.js';
import { createApplicationTransit } from './layers/transit.js';
import { createApplicationInstallations } from './layers/militaryInstallations.js';
import { createApplicationSatellites } from './layers/satellites.js';
import { createApplicationLaunches } from './layers/rocketLaunches.js';
import { createApplicationAlpr } from './layers/alprCameras.js';
import { createApplicationLocalAdsb } from './layers/localAdsb.js';
import { createApplicationAwareness } from './layers/militaryAwareness.js';
import { createApplicationFirms } from './layers/firms.js';
import { createApplicationEarthquakes } from './layers/earthquakes.js';
import { createApplicationAirQuality } from './layers/airQuality.js';
import { createApplicationFirePerimeters } from './layers/perimeters.js';
import { createApplicationGnssIntegrity } from './layers/gnss.js';
import { createApplicationGhostMaps } from './layers/ghostMaps.js';
import { createApplicationDroneAirspace } from './layers/droneAirspace.js';
import { createApplicationCables } from './layers/submarineCables.js';
import { createOsmOverlayLayers } from '../data/osmOverlays.js';
import { createApplicationStreetLevel } from './layers/streetLevel.js';
import { createInfrastructureLayers } from '../data/infrastructure.js';
import { localGeoJsonServices } from './localGeojsonServices.js';
import { createBhoteKoshiEventLayer } from '../data/bhoteKoshiEvent.js';
import { createBhoteKoshiLocatorLayer } from '../data/bhoteKoshiLocator.js';

=======
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

>>>>>>> theirs
/**
 * Hardware-local layers are registered like any other but never enter share
 * links or stored layer state: another browser cannot have this receiver.
 */
export const LOCAL_ONLY_LAYER_METADATA = Object.freeze([
  Object.freeze({ id: 'local-adsb', disposition: 'local-only' }),
  // Voice search results belong to this session, like a receiver to this machine.
  Object.freeze({ id: 'osm-places', disposition: 'local-only' }),
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
<<<<<<< ours
  streetLevelProviders,
=======
  deferRest = false,
>>>>>>> theirs
}) {
  if (!signal?.addEventListener)
    throw new TypeError('An application lifetime signal is required');
  signal.throwIfAborted();
  if (!surface?.groundFloor || !surface?.terrain)
    throw new TypeError('Application surface services are required');

<<<<<<< ours
  const sourceComposition = resolveCatalogSources(sources);
  sources = sourceComposition.sources;
=======
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
>>>>>>> theirs
  const militaryRegistry = createMilitaryRegistry();
  const weatherClock = createWeatherClock();
  const dispose = () => {
    signal.removeEventListener('abort', dispose);
    militaryRegistry.dispose();
    weatherClock.destroy();
  };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    if (sourceComposition.isConfigured('military'))
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
        createApplicationAirQuality({ source: sources['air-quality'] }),
        createApplicationFirePerimeters({
          source: sources['fire-perimeters'],
        }),
        createApplicationGnssIntegrity({
          source: sources['gnss-integrity'],
          windowMs: sources['gnss-integrity'].windowMs,
        }),
        createApplicationGhostMaps({ source: sources['s2-ghostmaps'] }),
        createApplicationDroneAirspace({
          source: sources['drone-airspace'],
        }),
        createApplicationAlpr({ surface, source: sources.alpr }),
        createApplicationStreetLevel({
          surface,
          sources: { mapillary: sources.mapillary },
          providers: streetLevelProviders,
        }),
        satellites,
        createApplicationLaunches({ source: sources.launches, satellites }),
        createApplicationTraffic({ source: sources.traffic, surface }),
        createApplicationCctv({ surface, source: sources.cctv }),
        createApplicationRadio({ surface, source: sources.radio }),
        createApplicationTransit({ surface, source: sources.transit }),
        createApplicationBikeshare({ source: sources.bikeshare }),
        createApplicationDirections({ source: sources.directions }),
        createApplicationRecentImagery({ source: sources['recent-imagery'] }),
        createApplicationOsmPlaces(),
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
        ...createOsmOverlayLayers(),
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
<<<<<<< ours
      ],
      metadata,
    );
    return Object.freeze({
      ...catalog,
      getSourceAvailability: sourceComposition.createAvailabilityLookup(
        catalog.layers,
      ),
      militaryRegistry,
      surface,
      weatherClock,
=======
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
>>>>>>> theirs
    });
    return attachCatalogServices(catalog, services);
  } catch (error) {
    dispose();
    throw error;
  }
}
