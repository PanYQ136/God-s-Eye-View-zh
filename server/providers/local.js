import { openSkyProxy } from './aircraft/opensky.js';
import { celestrakProxy, rocketLaunchesProxy } from './space.js';
import { tomtomProxy } from './traffic.js';
import { firmsProxy } from './firms.js';
import { earthquakesProxy } from './earthquakes.js';
import { imageryProxy } from './imagery.js';
import { terrainHeightsProxy } from './terrain.js';
import { adsbdbProxy } from './aircraft/enrichment.js';
import { overpassProxy } from './overpass.js';
import { militaryInstallationsProxy } from './military-installations.js';
import { regionalBriefProxy } from './regional/briefing.js';
import { geocodeProxy } from './regional/place.js';
import { weatherEffectsProxy } from './regional/weather-effects.js';
import { cctvProxy } from './cctv.js';
import { defaultSourceRoot } from './common/source-root.js';
import { radioBrowserProxy } from './radio.js';
import { gbfsProxy } from './gbfs.js';
import { localReceiversProxy } from './local-receivers.js';
import { transitProxy } from './transit.js';
import { adsbLolProxy } from './aircraft/adsb-lol.js';
import { aircraftPhotoProxy } from './aircraft/photo.js';
import { aisLiveProxy } from './vessels/ais-live.js';
import { trackBackfillProxies } from './aircraft/tracks.js';
import { openAiRealtimeProxy } from './openai.js';
import { googlePlacesContextProxy } from './places.js';
import { keySetupEndpoint } from '../standalone/key-setup.js';
import { weatherProxy } from './weather.js';
import { firePerimetersProxy } from './firePerimeters.js';
import { cycloneProxy } from './cyclones.js';
import { windProxy } from './wind.js';
import { infraStaticProxy } from './infra-static.js';
import { trafficFlowProxy } from './traffic-flow.js';
import { miniFlightsProxy } from './mini-flights.js';
import { miniGeocodeProxy } from './mini-geocode.js';
import { miniSourcesProxy } from './mini-sources.js';
import { cnLiveProxy } from './cn-live.js';

/** Construct the local provider plugins in their established order. */
/**
 * 让所有 provider 的 JSON 响应自动 gzip：把补丁挂到「第一个 provider 的
 * configureServer 之前」，这样它是 connect 栈里的第一层，能拿到完整的 res 和 req.url。
 * （各自用 middlewares.use 注册会排到最后，那时 provider 的 mount 已经把 /api 前缀剥掉了。）
 */
function withGzipPatch(plugin) {
  /*
   * ⛔ 已停用（2026-10-20）。
   * 无差别劫持 res.writeHead/res.end 会毁掉一部分响应：实测 /api/setup/status
   * 在带 Accept-Encoding: gzip 时，客户端收到的**连状态行都没有**，
   * 只有裸 JSON —— 浏览器 ERR_INVALID_HTTP_RESPONSE，整站打不开，curl 却看着正常。
   * 现在压缩只在 sendJson() 里显式做（自己控制头，不碰别人的 res）。
   * 保留函数是为了留一条明确的“不要这么干”的记录。
   */
  if (true) return plugin;
}

function localProviderPlugins() {
  return [
    withGzipPatch(openSkyProxy()),
    celestrakProxy(),
    tomtomProxy(),
    firmsProxy(),
    earthquakesProxy(),
    imageryProxy(),
    rocketLaunchesProxy(),
    terrainHeightsProxy(),
    adsbdbProxy(),
    aircraftPhotoProxy(),
    overpassProxy(),
    militaryInstallationsProxy(),
    regionalBriefProxy(),
    geocodeProxy(),
    weatherEffectsProxy(),
    cctvProxy({ sourceRoot: defaultSourceRoot }),
    radioBrowserProxy(),
    gbfsProxy(),
    localReceiversProxy(),
    transitProxy(),
    adsbLolProxy(),
    aisLiveProxy(),
    trackBackfillProxies(),
    openAiRealtimeProxy(),
    googlePlacesContextProxy(),
    windProxy(),
    infraStaticProxy(),
    trafficFlowProxy(),
    miniFlightsProxy(),
    miniGeocodeProxy(),
    cnLiveProxy(),
    miniSourcesProxy(),
    weatherProxy(),
    cycloneProxy(),
    firePerimetersProxy(),
    keySetupEndpoint(),
  ];
}

export { localProviderPlugins };

export {
  CCTV_FRAME_FETCH_TIMEOUT_MS,
  fetchCctvImageFromUpstream,
} from './cctv.js';
export {
  createRadioProxyMiddleware,
  isPublicRadioAddress,
  normalizeRadioBrowserStation,
  publicRadioStation,
  publicRadioHttpsUrl,
} from './radio.js';
export { LL2_CACHE_TTL_MS, launchLibraryRequestHeaders } from './space.js';
export { googlePlacesContextProxy } from './places.js';
export { googleServerApiKey } from './places.js';
export { keylessGooglePlacesResponse } from './places.js';
export { adsbLolFallbackAnchor } from './aircraft/opensky.js';
export { readResponseTextCapped } from './common/http.js';
export { readResponseJsonCapped } from './common/http.js';
export { coalesceProxyRequest } from './common/http.js';
export { requiredFiniteQueryNumber } from './common/query.js';
export { isOverpassBoundaryQuery } from './overpass/query.js';
export { simplifyOverpassPayloadBody } from './overpass/geometry.js';
export { readOverpassDisk } from './overpass/cache.js';
export { resolveOverpassPreflight } from './overpass/cache.js';
export { overpassPayloadIsData } from './overpass/transport.js';
export { fetchOverpassPayload } from './overpass/transport.js';
export { openAiRealtimeProxy } from './openai.js';
export { MILITARY_INSTALLATION_ELEMENT_CAP } from './military-installations/constants.js';
export { quantizeMilitaryInstallationBox } from './military-installations/query.js';
export { militaryInstallationCacheKey } from './military-installations/query.js';
export { resolveMilitaryInstallationTier } from './military-installations/cache.js';
export { migrateMilitaryInstallationEntry } from './military-installations/cache.js';
export { militaryInstallationDiskFresh } from './military-installations/cache.js';
export { militaryInstallationDiskPath } from './military-installations/cache.js';
export { readMilitaryInstallationDisk } from './military-installations/cache.js';
export { writeMilitaryInstallationDisk } from './military-installations/cache.js';
export { validMilitaryInstallationBox } from './military-installations/query.js';
export { militaryInstallationFailureReason } from './military-installations/query.js';
export { validRegionalPoint } from './regional/query.js';
export { regionalBriefHasAnySource } from './regional/briefing.js';
