const clean = (value) => String(value || '').trim();

// GEV (owner 2026-09-28): Google 3D tiles need a network path to Google/ion.
// In CN (or on a phone behind a blocked path) the request can stall forever with
// no error, hanging the startup await at "Loading Google 3D Tiles...". Bound each
// provider attempt so a dead path falls through to the keyless globe instead.
const TILE_TIMEOUT_MS = 12000;
const withTimeout = (promise, ms, label) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

/**
 * Decide which map provider can deliver the best startup experience.
 * @param {{googleApiKey?: string, cesiumToken?: string}} credentials
 * @returns {'google-direct'|'google-ion'|'osm'}
 */
export function selectMapStartupRoute({
  googleApiKey = '',
  cesiumToken = '',
} = {}) {
  if (clean(googleApiKey)) return 'google-direct';
  if (clean(cesiumToken)) return 'google-ion';
  return 'osm';
}

/**
 * Load Google Photorealistic 3D Tiles through direct Google access when
 * configured, otherwise through Cesium ion's hosted Google asset. If the
 * direct request fails and an ion token is available, ion is the recovery path.
 *
 * @param {object} Cesium
 * @param {{googleApiKey?: string, cesiumToken?: string}} credentials
 * @returns {Promise<{tileset: object|null, route: 'google-direct'|'google-ion'|'osm', errors: Error[]}>}
 */
export async function loadPhotorealisticTileset(
  Cesium,
  { googleApiKey = '', cesiumToken = '' } = {},
) {
  const googleKey = clean(googleApiKey);
  const ionToken = clean(cesiumToken);
  const errors = [];

  const attempts = [];
  if (googleKey) attempts.push({ route: 'google-direct', googleKey });
  if (ionToken) attempts.push({ route: 'google-ion', googleKey: undefined });

  for (const attempt of attempts) {
    try {
      const tileset = attempt.googleKey
        ? await withTimeout(
            createGoogleDirectTileset(Cesium, attempt.googleKey),
            TILE_TIMEOUT_MS,
            'Google 3D direct',
          )
        : await withTimeout(
            createGoogleIonTileset(Cesium, ionToken),
            TILE_TIMEOUT_MS,
            'Google 3D ion',
          );
      return { tileset, route: attempt.route, errors };
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  return { tileset: null, route: 'osm', errors };
}

/** Pass credentials to the source instead of changing SDK-wide defaults. */
export function createGoogleDirectTileset(Cesium, key) {
  key = clean(key);
  if (!key) throw new Error('Google 3D requires an explicit browser key');
  // Tiles keep drawing their own texture while draped weather loads.
  // GEV perf 2026-10-24: direct 路由此前没设显存/缓存（用 Cesium 默认 256/512MB），
  // 与 ion 路由对齐到 1536MB 缓存 + 1400MB 上限，减少 3D 飞越时的瓦片卸载/重载抖动。
  return Cesium.createGooglePhotorealistic3DTileset(
    { key, onlyUsingWithGoogleGeocoder: true },
    { asynchronouslyLoadImagery: true },
  ).then((tileset) => {
    try {
      tileset.cacheBytes = 1536 * 1024 * 1024;
      tileset.maximumCacheOverflowBytes = 1024 * 1024 * 1024;
      tileset.maximumMemoryUsage = 1400;
    } catch (e) {}
    return tileset;
  });
}

export async function createGoogleIonTileset(
  Cesium,
  accessToken,
  { signal } = {},
) {
  accessToken = clean(accessToken);
  if (!accessToken)
    throw new Error('Google 3D through ion requires an explicit token');
  signal?.throwIfAborted();
  const resource = await Cesium.IonResource.fromAssetId(2275207, {
    accessToken,
  });
  signal?.throwIfAborted();
  // Match the installed SDK's Google helper rendering/cache defaults.
  return Cesium.Cesium3DTileset.fromUrl(resource, {
    cacheBytes: 1536 * 1024 * 1024,
    maximumCacheOverflowBytes: 1024 * 1024 * 1024,
    enableCollision: true,
    // Tiles keep drawing their own texture while draped weather loads.
    asynchronouslyLoadImagery: true,
  });
}
