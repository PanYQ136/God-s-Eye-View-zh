import {
  CCTV_SOURCE_FETCH_TIMEOUT_MS,
  DEFAULT_VEGVESEN_CCTV_URL,
  DEFAULT_VEGVESEN_MAX_SOURCES,
  KARTVERKET_CATALOG_WAIT_MS,
  KARTVERKET_CONCURRENCY,
  KARTVERKET_FAILURE_BACKOFF_MS,
  KARTVERKET_HEIGHT_RANGE_M,
  KARTVERKET_HEIGHT_URL,
  KARTVERKET_LOOKUP_TIMEOUT_MS,
  KARTVERKET_MAX_BACKOFF_MS,
  KARTVERKET_MAX_POINTS,
  KARTVERKET_MAX_RESPONSE_BYTES,
  KARTVERKET_NULL_TTL_MS,
  KARTVERKET_REQUEST_TIMEOUT_MS,
  KARTVERKET_USER_AGENT,
  KARTVERKET_WAIT_MISSING_SHARE,
  NORWAY_ANCHORS,
  VEGVESEN_IMAGE_ORIGIN,
  VEGVESEN_MAX_CATALOG_BYTES,
  VEGVESEN_VIDEO_URL,
} from './constants.js';
import {
  cameraDisplayCode,
  fallbackHeadingFromId,
  isLikelyNorwayCoordinate,
  prioritizeSources,
  toFiniteNumber,
} from './normalize.js';
import { readResponseJsonCapped } from '../common/http.js';

/**
 * Norway — Statens vegvesen cameras plus the Kartverket terrain heights that
 * give them a ground prior.
 *
 * Extracted verbatim out of `sources.js` (which carried 22 data sources in one
 * 3,900-line file). `sources.js` re-exports every public name below, so the
 * catalog and its tests are unchanged.
 */

export function vegvesenCameraToSource(feature) {
  if (!feature || typeof feature !== 'object') return null;
  const props = feature.properties;
  if (!props || typeof props !== 'object') return null;
  const availability = String(
    props['status.stillImageAvailability'] ?? '',
  ).trim();
  if (availability && availability !== 'videoOrImagesAvailable') return null;

  const coordinates = feature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lon = toFiniteNumber(coordinates[0]);
  const lat = toFiniteNumber(coordinates[1]);
  if (!isLikelyNorwayCoordinate(lat, lon)) return null;

  const rawId = String(props.cameraId ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(rawId)) return null;
  let image;
  try {
    image = new URL(String(props.stillImageUrl ?? ''));
  } catch {
    return null;
  }
  if (image.username || image.password) return null;
  const imageUrl = image.href;
  if (imageUrl !== `${VEGVESEN_IMAGE_ORIGIN}${rawId}`) return null;

  const cameraId = `no-vegvesen-${rawId.toLowerCase()}`;
  const place = String(props.description ?? '').trim() || `Kamera ${rawId}`;
  const towards = String(props.orientationDescription ?? '').trim();
  const road = String(props.roadNumber ?? '').trim();
  const name = towards && towards !== place ? `${place} → ${towards}` : place;
  // Live video when the camera publishes HLS on the agency's own host; the
  // still stays the snapshot fallback. CCTV_VEGVESEN_VIDEO=0 keeps stills only.
  const videoUrl =
    String(process.env.CCTV_VEGVESEN_VIDEO || '1').trim() !== '0' &&
    Number(props.videoServiceLevel) > 0 &&
    String(props.videoEncodingStandard ?? '').toLowerCase() === 'hls' &&
    String(props.videoUrl ?? '').trim() === VEGVESEN_VIDEO_URL(rawId)
      ? VEGVESEN_VIDEO_URL(rawId)
      : '';

  return {
    id: cameraId,
    name: road ? `${road} ${name}` : name,
    // One country-wide category in the camera picker, like Finland; the
    // place itself is already in the name.
    city: 'Norway',
    cityId: 'norway',
    provider: 'Statens vegvesen',
    lat,
    lon,
    headingDeg: fallbackHeadingFromId(cameraId),
    headingConfidence: 'low',
    pitchDeg: -18,
    fovDeg: 44,
    rangeM: 145,
    mountHeightM: 8,
    // The feed's coordinates are 2D. The loader replaces this flat prior with
    // Kartverket's terrain height for each camera (applyVegvesenGroundHeights);
    // it only survives when that lookup fails, and then a mountain-pass camera
    // can sit below the terrain on a stack without 3D tiles, the same risk the
    // Caltrans pack documents.
    groundElevationM: 150,
    feedType: videoUrl ? 'hls' : 'image',
    url: videoUrl || imageUrl,
    snapshotUrl: imageUrl,
    sourceKind: 'vegvesen-datex',
    license:
      'Contains data under the Norwegian licence for Open Government data (NLOD) distributed by Statens vegvesen',
    code: cameraDisplayCode(place.toUpperCase()),
  };
}

/**
 * Fetch Statens vegvesen (Norway) road cameras from the keyless OGC API
 * Features view of the DATEX 3.1 CCTV table. Frames are stills on
 * kamera.atlas.vegvesen.no.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadVegvesenSourcesFromOpenData() {
  const startedAt = Date.now();
  try {
    const endpoint = process.env.CCTV_VEGVESEN_URL || DEFAULT_VEGVESEN_CCTV_URL;
    const resp = await fetch(endpoint, {
      headers: { Accept: 'application/geo+json,application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    const discard = async () => {
      try {
        await resp.body?.cancel();
      } catch {
        /* no-op */
      }
      return [];
    };
    if (resp.status >= 300 && resp.status < 400) {
      console.warn(
        '[CCTV] Vegvesen catalog redirected; redirects are not followed',
      );
      return discard();
    }
    if (!resp.ok) {
      console.warn('[CCTV] Vegvesen camera download failed:', resp.status);
      return discard();
    }
    const payload = await readResponseJsonCapped(
      resp,
      VEGVESEN_MAX_CATALOG_BYTES,
    );
    const features = Array.isArray(payload?.features) ? payload.features : [];
    const cameras = [];
    const seen = new Set();
    for (const feature of features) {
      const camera = vegvesenCameraToSource(feature);
      if (!camera || seen.has(camera.id)) continue;
      seen.add(camera.id);
      cameras.push(camera);
    }
    const maxRaw = Number(
      process.env.CCTV_VEGVESEN_MAX_SOURCES || DEFAULT_VEGVESEN_MAX_SOURCES,
    );
    const maxCount = Number.isFinite(maxRaw)
      ? Math.max(8, Math.min(1000, Math.floor(maxRaw)))
      : DEFAULT_VEGVESEN_MAX_SOURCES;
    const prioritized = prioritizeSources(cameras, maxCount, NORWAY_ANCHORS);
    await applyVegvesenGroundHeights(prioritized, {
      waitMs: Math.max(
        0,
        KARTVERKET_CATALOG_WAIT_MS - (Date.now() - startedAt),
      ),
    });
    console.log(
      `[CCTV] Loaded Vegvesen camera sources: ${cameras.length} (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn(
      '[CCTV] Vegvesen camera download error:',
      error?.message || error,
    );
    return [];
  }
}

/**
 * Kartverket answers by rounded position: `{z, expires}`, where z is metres or
 * null for "no height there". Heights never expire (camera positions barely
 * change); nulls expire after KARTVERKET_NULL_TTL_MS. The 15-minute catalog
 * refresh therefore only asks about new or moved cameras. Bounded well above
 * the ~900 cameras the pack can load.
 */
const kartverketHeightCache = new Map();
const KARTVERKET_CACHE_LIMIT = 5000;
/** The lookup in flight, so overlapping catalog loads never start a second. */
let kartverketPending = null;
/** No lookup starts before this time (epoch ms) after a transport failure. */
let kartverketBackoffUntil = 0;
/** Bumped by clearKartverketHeightCache, so a lookup started before a clear
 * can no longer write to the cache, the backoff or the pending slot. */
let kartverketGeneration = 0;

/** Cache key for one position, at the ~0.1 m precision the request sends. */
const kartverketKey = (lon, lat) => `${lon.toFixed(6)},${lat.toFixed(6)}`;

/** Statuses that say the service, not the request, is failing. */
const isKartverketTransportStatus = (status) =>
  status === 408 || status === 429 || status >= 500;

/** Forget cached heights, the backoff and any lookup in flight. Tests only. */
export function clearKartverketHeightCache() {
  kartverketGeneration += 1;
  kartverketHeightCache.clear();
  kartverketPending = null;
  kartverketBackoffUntil = 0;
}

/**
 * How long to back off after a failed request: the Retry-After the service
 * sent (seconds or an HTTP date), else the default, bounded to [1 min, 1 h].
 *
 * @param {?string} retryAfter - The Retry-After header, if any.
 * @param {number} now - Epoch ms.
 * @returns {number} Milliseconds.
 */
export function kartverketBackoffMs(retryAfter, now = Date.now()) {
  let ms = KARTVERKET_FAILURE_BACKOFF_MS;
  const text = String(retryAfter ?? '').trim();
  if (/^\d+$/.test(text)) ms = Number(text) * 1000;
  else if (text && Number.isFinite(Date.parse(text))) {
    ms = Date.parse(text) - now;
  }
  return Math.max(60 * 1000, Math.min(KARTVERKET_MAX_BACKOFF_MS, ms));
}

/**
 * Terrain heights above sea level (NN2000) from Kartverket's keyless
 * point-height API, KARTVERKET_MAX_POINTS points per request. Each answer is
 * matched back by the coordinates the API echoes, and only for points that
 * request asked about, then reported through `into.set(key, z)` as its
 * request lands, so a caller that stops waiting keeps what has arrived. `z` is
 * metres, or null when the API has no usable height there. A point a 200
 * answer leaves out is reported as null too, so it is not asked again on
 * every refresh.
 *
 * Over water `/punkt` returns the depth of the sea floor (`datakilde:
 * dybdekurver`, `terreng: Havflate`; −547 m under Nordhordlandsbrua). Either
 * marker counts as 0 m, the water surface. For the ~14 bridge cameras that is
 * below the deck, but far closer than the sea floor or a flat prior.
 *
 * The first transport failure (a 408, 429 or 5xx, a network error, a request
 * past KARTVERKET_REQUEST_TIMEOUT_MS, an unreadable or oversized body, or the
 * shared deadline) stops the lookup: no further requests start, and the
 * failure is returned so the caller can back off. Points in failed requests
 * are not reported, so they are asked again later. Any other 4xx rejects that
 * request's points, not the service: they are reported as null and the lookup
 * carries on.
 *
 * @param {Array<{lon:number, lat:number}>} points
 * @param {{into?: {set: Function}, timeoutMs?: number, requestTimeoutMs?: number}} [options]
 * @returns {Promise<{heights: Map<string, ?number>, failure: ?{status: ?number, retryAfter: ?string, deadline: boolean}}>}
 *   `heights` is `into` when it is a Map, else a Map of what was reported.
 *   `failure.deadline` is true when only the shared deadline ran out.
 */
export async function fetchKartverketHeights(
  points,
  {
    into = new Map(),
    timeoutMs = KARTVERKET_LOOKUP_TIMEOUT_MS,
    requestTimeoutMs = KARTVERKET_REQUEST_TIMEOUT_MS,
  } = {},
) {
  const heights = into instanceof Map ? into : new Map();
  const report = (key, z) => {
    if (heights !== into) heights.set(key, z);
    into.set(key, z);
  };
  const unique = Array.from(
    new Map(
      (points || [])
        .filter((p) => isLikelyNorwayCoordinate(p?.lat, p?.lon))
        .map((p) => [kartverketKey(p.lon, p.lat), p]),
    ).values(),
  );
  let failure = null;
  if (!unique.length) return { heights, failure };
  const batches = [];
  for (let i = 0; i < unique.length; i += KARTVERKET_MAX_POINTS) {
    batches.push(unique.slice(i, i + KARTVERKET_MAX_POINTS));
  }
  // AbortSignal.timeout() arms an unref'ed timer: if the hung upstream is the
  // only pending work — a unit test awaiting one lookup, or a short-lived
  // worker — the event loop can empty *before* the deadline fires, so the
  // promise never settles and the process exits mid-await. A ref'ed timer
  // keeps the loop alive for exactly as long as the deadline needs it, and the
  // `finally` below disarms it so a finished lookup never holds the process
  // open for the rest of the budget.
  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => {
    deadlineController.abort(
      new DOMException('The operation timed out', 'TimeoutError'),
    );
  }, timeoutMs);
  const deadline = deadlineController.signal;
  const fetchBatch = async (batch) => {
    const asked = new Set(batch.map((p) => kartverketKey(p.lon, p.lat)));
    const url = new URL(KARTVERKET_HEIGHT_URL);
    url.searchParams.set(
      'punkter',
      JSON.stringify(
        batch.map((p) => [Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))]),
      ),
    );
    url.searchParams.set('koordsys', '4258');
    const resp = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': KARTVERKET_USER_AGENT,
      },
      redirect: 'error',
      signal: AbortSignal.any([
        deadline,
        AbortSignal.timeout(requestTimeoutMs),
      ]),
    });
    if (!resp.ok) {
      try {
        await resp.body?.cancel();
      } catch {
        /* no-op */
      }
      if (!isKartverketTransportStatus(resp.status)) {
        console.warn(
          `[CCTV] Kartverket rejected ${asked.size} points: HTTP ${resp.status}`,
        );
        for (const key of asked) report(key, null);
        return;
      }
      const error = new Error(`HTTP ${resp.status}`);
      error.status = resp.status;
      error.retryAfter = resp.headers.get('retry-after');
      throw error;
    }
    const payload = await readResponseJsonCapped(
      resp,
      KARTVERKET_MAX_RESPONSE_BYTES,
    );
    for (const point of Array.isArray(payload?.punkter)
      ? payload.punkter
      : []) {
      const x = toFiniteNumber(point?.x);
      const y = toFiniteNumber(point?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const key = kartverketKey(x, y);
      // Only the points this request asked about: an odd answer can neither
      // grow the cache nor overwrite another camera.
      if (!asked.has(key)) continue;
      asked.delete(key);
      // `z: null` means no height there; Number(null) would read 0.
      const raw = point?.z;
      let z =
        raw === null || raw === undefined || raw === ''
          ? NaN
          : toFiniteNumber(raw);
      if (
        Number.isFinite(z) &&
        (point?.datakilde === 'dybdekurver' || point?.terreng === 'Havflate')
      ) {
        z = 0;
      }
      const usable =
        Number.isFinite(z) &&
        z >= KARTVERKET_HEIGHT_RANGE_M.min &&
        z <= KARTVERKET_HEIGHT_RANGE_M.max;
      report(key, usable ? z : null);
    }
    // A 200 that leaves a point out has no height for it either.
    for (const key of asked) report(key, null);
  };
  let next = 0;
  const worker = async () => {
    while (next < batches.length && !failure) {
      const batch = batches[next++];
      try {
        await fetchBatch(batch);
      } catch (error) {
        if (!failure) {
          failure = {
            status: Number.isFinite(error?.status) ? error.status : null,
            retryAfter: error?.retryAfter ?? null,
            deadline: deadline.aborted,
          };
          console.warn(
            '[CCTV] Kartverket height lookup failed:',
            error?.message || error,
          );
        }
      }
    }
  };
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(KARTVERKET_CONCURRENCY, batches.length) },
        worker,
      ),
    );
  } finally {
    clearTimeout(deadlineTimer);
  }
  return { heights, failure };
}

/**
 * Give each Vegvesen camera its own terrain height as the ground prior, in
 * place. Waits at most `waitMs` for positions it has no answer for, and only
 * when more than KARTVERKET_WAIT_MISSING_SHARE of the cameras are missing
 * (a cold cache); a few new cameras or expired misses are looked up in the
 * background. A lookup still running when the wait ends keeps filling the
 * cache for the next catalog refresh. Cameras without a height keep the flat
 * prior. After a transport failure no lookup starts until the backoff ends,
 * which outlasts the 15-minute catalog refresh, so a failing Kartverket costs
 * one attempt per backoff, not one per refresh. A lookup cut short only by its
 * shared deadline is resumed on the next refresh without a backoff. Cameras
 * without finite coordinates are skipped. Never throws.
 * CCTV_VEGVESEN_HEIGHTS=0 turns it off.
 *
 * @param {Array<object>} cameras - Sources from vegvesenCameraToSource().
 * @param {{waitMs?: number, now?: () => number, timeoutMs?: number}} [options]
 *   `timeoutMs` is the lookup's shared deadline.
 * @returns {Promise<number>} How many cameras got a terrain height.
 */
export async function applyVegvesenGroundHeights(
  cameras,
  {
    waitMs = KARTVERKET_CATALOG_WAIT_MS,
    now = Date.now,
    timeoutMs = KARTVERKET_LOOKUP_TIMEOUT_MS,
  } = {},
) {
  if (String(process.env.CCTV_VEGVESEN_HEIGHTS || '1').trim() === '0') return 0;
  const list = (Array.isArray(cameras) ? cameras : []).filter(
    (c) => Number.isFinite(c?.lon) && Number.isFinite(c?.lat),
  );
  const startedAt = now();
  const missing = list.filter((c) => {
    const entry = kartverketHeightCache.get(kartverketKey(c.lon, c.lat));
    return !entry || entry.expires <= startedAt;
  });
  if (
    missing.length &&
    !kartverketPending &&
    startedAt >= kartverketBackoffUntil
  ) {
    if (kartverketHeightCache.size + missing.length > KARTVERKET_CACHE_LIMIT) {
      kartverketHeightCache.clear();
    }
    const generation = kartverketGeneration;
    const current = () => generation === kartverketGeneration;
    const sink = {
      set: (key, z) => {
        if (!current()) return;
        kartverketHeightCache.set(key, {
          z,
          expires: z === null ? now() + KARTVERKET_NULL_TTL_MS : Infinity,
        });
      },
    };
    const pending = fetchKartverketHeights(missing, { into: sink, timeoutMs })
      .then(({ failure }) => {
        if (failure && !failure.deadline && current()) {
          kartverketBackoffUntil =
            now() + kartverketBackoffMs(failure.retryAfter, now());
        }
      })
      .catch((error) => {
        if (current()) {
          kartverketBackoffUntil = now() + KARTVERKET_FAILURE_BACKOFF_MS;
        }
        console.warn(
          '[CCTV] Kartverket height lookup error:',
          error?.message || error,
        );
      })
      .finally(() => {
        if (kartverketPending === pending) kartverketPending = null;
      });
    kartverketPending = pending;
  }
  const cold = missing.length > list.length * KARTVERKET_WAIT_MISSING_SHARE;
  if (cold && kartverketPending && waitMs > 0) {
    let timer;
    await Promise.race([
      kartverketPending,
      new Promise((resolve) => {
        timer = setTimeout(resolve, waitMs);
        timer.unref?.();
      }),
    ]);
    clearTimeout(timer);
  }
  let applied = 0;
  for (const camera of list) {
    const z = kartverketHeightCache.get(
      kartverketKey(camera.lon, camera.lat),
    )?.z;
    if (!Number.isFinite(z)) continue;
    camera.groundElevationM = Math.round(z * 10) / 10;
    applied += 1;
  }
  if (list.length) {
    console.log(
      `[CCTV] Kartverket ground heights: ${applied}/${list.length} Vegvesen cameras`,
    );
  }
  return applied;
}
