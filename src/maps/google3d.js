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
 * @param {{googleApiKey?: string, cesiumToken?: string, warmEndpoint?: Promise<object|null>}} credentials
 * @returns {Promise<{tileset: object|null, route: 'google-direct'|'google-ion'|'osm', errors: Error[]}>}
 */
export async function loadPhotorealisticTileset(
  Cesium,
  { googleApiKey = '', cesiumToken = '', warmEndpoint = null } = {},
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
            createGoogleIonTileset(Cesium, ionToken, { warmEndpoint }),
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

/**
 * Build the ion Resource for the Google asset.
 *
 * Phase6C4 优化：`/v1/assets/<id>/endpoint` 是 `cache-control: no-cache`，
 * 每次冷启动都要 0.7–2.1 s，而且是 `root.json` 的前置串行依赖。这里在
 * `main:entry` 就把端点请求发出去（`warmIonAsset`），拿到 JSON 后直接用
 * `new IonResource(endpoint, endpointResource)` 构造 —— attribution/credit 走
 * 的还是 IonResource 自己的 `getCreditsFromEndpoint`，与 `fromAssetId` 完全一致，
 * 只是省掉一次往返。任何一步异常（老版本私有静态缺失、预热失败）都回落原路径。
 */
async function createIonResource(Cesium, accessToken, warmEndpoint) {
  const endpoint = await Promise.resolve(warmEndpoint).catch(() => null);
  if (endpoint && endpoint.options && Cesium.IonResource) {
    try {
      const endpointResource = Cesium.IonResource._createEndpointResource(
        2275207,
        { accessToken },
      );
      if (endpointResource) return new Cesium.IonResource(endpoint, endpointResource);
    } catch (_) {
      /* 私有静态不可用 → 回落 */
    }
  }
  return Cesium.IonResource.fromAssetId(2275207, { accessToken });
}

export async function createGoogleIonTileset(
  Cesium,
  accessToken,
  { signal, warmEndpoint = null } = {},
) {
  accessToken = clean(accessToken);
  if (!accessToken)
    throw new Error('Google 3D through ion requires an explicit token');
  signal?.throwIfAborted();
  const resource = await createIonResource(Cesium, accessToken, warmEndpoint);
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

/* ── 冷启动早期发起（main:entry）────────────────────────────────────────────
   Phase6C4 基线：`tileset:fetch` 2 573 ms 全部排在 `viewer:ready`（2 186 ms）
   之后 —— 先构造 Viewer，再 await tileset，纯串行。这里让 main:entry 就把
   「ion 端点 → root.json → Cesium3DTileset」这条链发出去，Viewer 构造与
   App 前段（约 0.5–0.8 s）与它并行；scene 只在需要 primitives.add 时才 await。

   行为等价：返回的仍是同一个 `{tileset, route, errors}`；失败/超时仍回落
   keyless globe（`loadPhotorealisticTileset` 自己吞掉每次尝试的异常）。 */
let bootLoad = null;

/** main:entry 调用 —— 提前开始加载（幂等，只发一次）。 */
export function primePhotorealTilesetLoad(Cesium, credentials) {
  if (!bootLoad) bootLoad = loadPhotorealisticTileset(Cesium, credentials);
  return bootLoad;
}

/** scene 调用 —— 用已经提前发出的那次请求；没提前发就现发。 */
export function loadPhotorealisticTilesetPrimed(Cesium, credentials) {
  return bootLoad || loadPhotorealisticTileset(Cesium, credentials);
}

