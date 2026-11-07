import { resolveCatalogSources } from './sourceComposition.js';
import { createLayerCatalog } from './catalog.js';
import { LAYER_STATE_REGISTRY } from '../data/layerState.js';

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
 * Load the two factory waves (问题清单 #16 · Phase8E · D2).
 *
 * Both `import()` calls start in the same tick, so the network sees two
 * parallel requests instead of one 1.8 MB entry module: `index-*.js` no longer
 * carries any layer code, and Vite emits one chunk per wave (`modulepreload`
 * edges come from the import graph, not from hand-written chunk rules).
 *
 * Construction order is unchanged. Both waves are awaited before the first
 * factory runs, so `catalog.layers` is the same array of the same instances —
 * the entry graph shrank, the catalog did not.
 */
async function loadCatalogFactories() {
  const [core, rest] = await Promise.all([
    import('./catalogFactoriesCore.js'),
    import('./catalogFactoriesRest.js'),
  ]);
  return Object.freeze({ ...core, ...rest });
}

/** Construct the current catalog without choosing any source provider.
 * Scene engines remain page-owned; layers and classification have this app's lifetime.
 * The manager owns layer destruction, while abort releases classification even if startup fails.
 * Asynchronous only because the factory waves are `import()`ed — see above.
 */
export async function createApplicationCatalog({
  surface,
  sources,
  signal,
  metadata = APPLICATION_LAYER_METADATA,
  vesselOptions,
  resolveAsset,
  nepalBoundaryResolver,
  streetLevelProviders,
}) {
  if (!signal?.addEventListener)
    throw new TypeError('An application lifetime signal is required');
  signal.throwIfAborted();
  if (!surface?.groundFloor || !surface?.terrain)
    throw new TypeError('Application surface services are required');

  const sourceComposition = resolveCatalogSources(sources);
  sources = sourceComposition.sources;
  const factories = await loadCatalogFactories();
  // The wave requests are the only suspension point: a lifetime that ended
  // while they were in flight must not leave a half-built catalog behind.
  signal.throwIfAborted();
  const {
    createMilitaryRegistry,
    createWeatherClock,
    createApplicationFlights,
    createApplicationMilitary,
    createApplicationLocalAdsb,
    createBhoteKoshiEventLayer,
    createBhoteKoshiLocatorLayer,
    createWeatherLayer,
    createCyclonesLayer,
    createWindLayer,
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
    createApplicationCnTraffic,
    createApplicationCnAdmin,
    createApplicationCnQuakes,
    createApplicationCnTyphoon,
    createApplicationAirQuality,
    createApplicationOsmPlaces,
    createApplicationGnssIntegrity,
    createApplicationGhostMaps,
    createApplicationDroneAirspace,
    createApplicationStreetLevel,
    createOsmOverlayLayers,
  } = factories;
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
    const catalog = createLayerCatalog(
      [
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
        // CN 反向移植图层（A1-A4）：中国实时交通/行政区划/地震/台风。
        createApplicationCnTraffic({ source: sources['cn-traffic'] }),
        createApplicationCnAdmin({ source: sources['cn-admin'] }),
        createApplicationCnQuakes({ source: sources['cn-quakes'] }),
        createApplicationCnTyphoon({ source: sources['cn-typhoon'] }),
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
    });
  } catch (error) {
    dispose();
    throw error;
  }
}
