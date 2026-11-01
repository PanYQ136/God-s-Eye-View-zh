/**
 * 语音动作词汇表与纯工具（问题清单 #17 · Phase8E）
 *
 * 从 `src/voice/gevActions.js`（4,480 行）里切出来的**纯常量 / 纯函数**部分：
 * 样式白名单、面板别名、上下文模式字段、机舱动作别名、图层/城市/栈别名、
 * 可跟踪族、取景目标、服务级缓存工具、可见实体短名单。
 *
 * 只搬「不碰运行状态」的东西：没有一个函数读写 runner 的实例状态，所以搬出去后
 * `gevActions.js` 的行为逐行不变（同一个常量对象/WeakMap 实例被 import 回原处）。
 * 状态迁移（runner 内部字段）留给后续批次，避免一次性重写。
 *
 * 回滚：把本文件内容粘回 `gevActions.js` 顶部、删掉那边的 import 即可。
 */
import { contextModeWord } from '../../contextModePolicy.js';

export const ALLOWED_STYLES = new Set([
  'normal',
  'retro',
  'surveillance',
  'thermal',
  'anime',
  'noir',
  'snow',
]);
export const PANEL_ALIASES = new Map([
  ['data', 'data-panel'],
  ['data layers', 'data-panel'],
  ['layers', 'data-panel'],
  ['layer menu', 'data-panel'],
  ['data layer menu', 'data-panel'],
  ['locations', 'location-bar'],
  ['location', 'location-bar'],
  ['styles', 'control-panel'],
  ['filters', 'control-panel'],
  ['visual styles', 'control-panel'],
  ['cctv', 'cctv-panel'],
  ['cameras', 'cctv-panel'],
  ['radio', 'radio-panel'],
  ['internet radio', 'radio-panel'],
  ['radio stations', 'radio-panel'],
  ['context', 'global-context-panel'],
  ['context panel', 'global-context-panel'],
  ['global context', 'global-context-panel'],
  ['right context', 'global-context-panel'],
  ['context right panel', 'global-context-panel'],
  ['scenes', 'scene-panel'],
  ['scene', 'scene-panel'],
  ['post processing', 'pp-toggles'],
  ['hud controls', 'pp-toggles'],
  ['map stack', 'control-panel'],
  ['stack', 'control-panel'],
  ['basemap', 'control-panel'],
  ['map sources', 'control-panel'],
  ['sources', 'control-panel'],
]);

export const PANEL_IDS = new Set([
  'data-panel',
  'location-bar',
  'control-panel',
  'cctv-panel',
  'radio-panel',
  'global-context-panel',
  'scene-panel',
  'pp-toggles',
]);
export const CONTEXT_MODE_ALIASES = new Map([
  ['off', 'off'],
  ['none', 'off'],
  ['clear', 'off'],
  ['contacts', 'flights'],
  ['contact', 'flights'],
  ['flights', 'flights'],
  ['space missions', 'space-missions'],
  ['space-mission', 'space-missions'],
  ['space mission', 'space-missions'],
  ['space-missions', 'space-missions'],
  ['missions', 'space-missions'],
]);
/**
 * Every model-readable field that carries a context-mode id, and what an
 * absent value means for each.
 *
 * `mode` always names a mode, so nothing is 'off'. `entering` and `priorMode`
 * are absent when there is no such mode at all — calling those 'off' would
 * assert a state that does not exist.
 */
export const CONTEXT_MODE_RESULT_FIELDS = Object.freeze([
  { field: 'mode', emptyAs: 'off' },
  { field: 'entering', emptyAs: null },
  { field: 'priorMode', emptyAs: null },
]);

/** Nested results that are themselves context-mode payloads the model reads. */
export const NESTED_CONTEXT_RESULT_FIELDS = Object.freeze([
  'context',
  'contextRollback',
]);

/**
 * Report a context-mode payload in the tools' own vocabulary.
 *
 * `set_context_mode` accepts 'contacts' while the mode's internal id is
 * 'flights'. Reporting the internal id back made the model read
 * `mode:'flights'` as "Contacts is off" and refuse to answer from the Contacts
 * window counts sitting in the very same payload (owner field session
 * 2026-08-21). Secondary fields and nested transition/rollback results are
 * translated too — one leaked internal id is enough to recreate the confusion,
 * and a rollback result is exactly what the model reads when something went
 * wrong. Each internal id is kept alongside as `<field>Internal` for anything
 * reasoning about layers.
 * @param {object|null|undefined} state Any payload carrying context-mode fields.
 * @returns {object|null|undefined} The same payload, modes translated.
 */
export function withContextModeVocabulary(state) {
  if (!state || typeof state !== 'object') return state;
  let out = state;
  const mutable = () => {
    if (out === state) out = { ...state };
    return out;
  };
  for (const { field, emptyAs } of CONTEXT_MODE_RESULT_FIELDS) {
    if (!(field in state)) continue;
    const internal = state[field] ?? null;
    const target = mutable();
    target[field] = contextModeWord(internal, { emptyAs });
    target[`${field}Internal`] = internal;
  }
  for (const field of NESTED_CONTEXT_RESULT_FIELDS) {
    const nested = state[field];
    if (!nested || typeof nested !== 'object') continue;
    const translated = withContextModeVocabulary(nested);
    if (translated !== nested) mutable()[field] = translated;
  }
  return out;
}

export const COCKPIT_ACTION_ALIASES = new Map([
  ['next', 'next'],
  ['previous', 'previous'],
  ['prev', 'previous'],
  ['enter', 'enter'],
  ['exit', 'exit'],
  ['status', 'status'],
  ['state', 'status'],
  ['next military', 'next'],
  ['next military aircraft', 'next'],
  ['next helicopter', 'next'],
  ['next closest', 'next'],
  ['next closest helicopter', 'next'],
  ['next closest military', 'next'],
  ['go to next', 'next'],
]);
export const COCKPIT_TARGET_LAYERS = new Set([
  'flights',
  'military',
  'ais-live-vessels',
  'military-installations',
]);

export const LAYER_ALIASES = new Map([
  ['flights', 'flights'],
  ['planes', 'flights'],
  ['aircraft', 'flights'],
  ['military', 'military'],
  ['military flights', 'military'],
  ['earthquakes', 'earthquakes'],
  ['quakes', 'earthquakes'],
  ['satellites', 'satellites'],
  ['space mission', 'rocket-launches'],
  ['space missions', 'rocket-launches'],
  ['missions', 'rocket-launches'],
  ['traffic', 'traffic'],
  ['street traffic', 'traffic'],
  ['cctv', 'cctv'],
  ['cameras', 'cctv'],
  ['radio', 'radio'],
  ['internet radio', 'radio'],
  ['radio stations', 'radio'],
  ['bikeshare', 'bikeshare'],
  ['bikes', 'bikeshare'],
  ['ais', 'ais-live-vessels'],
  ['ships', 'ais-live-vessels'],
  ['vessels', 'ais-live-vessels'],
  ['live vessels', 'ais-live-vessels'],
  ['datacenters', 'local-datacenters'],
  ['data centers', 'local-datacenters'],
  ['data centres', 'local-datacenters'],
  ['dams', 'local-dams'],
  ['submarine cables', 'telegeography-submarine-cables'],
  ['cables', 'telegeography-submarine-cables'],
  ['telegeography', 'telegeography-submarine-cables'],
  ['fire perimeters', 'fire-perimeters'],
  ['perimeters', 'fire-perimeters'],
  ['wildfire perimeters', 'fire-perimeters'],
  ['firms', 'local-firms'],
  ['fires', 'local-firms'],
  ['active fires', 'local-firms'],
  ['alpr', 'alpr-cameras'],
  ['alpr cameras', 'alpr-cameras'],
  ['flock cameras', 'alpr-cameras'],
  ['license plate readers', 'alpr-cameras'],
  ['license plate cameras', 'alpr-cameras'],
  ['plate readers', 'alpr-cameras'],
  ['local-adsb', 'local-adsb'],
  ['local adsb', 'local-adsb'],
  ['local ads-b', 'local-adsb'],
  ['my receiver', 'local-adsb'],
  ['my antenna', 'local-adsb'],
  ['my sdr', 'local-adsb'],
]);

export const CITY_ALIASES = new Map([
  ['new york', 'nyc'],
  ['new york city', 'nyc'],
  ['san francisco', 'sf'],
  ['washington', 'dc'],
  ['washington dc', 'dc'],
  ['washington d.c.', 'dc'],
]);

// Basemap stack vocabulary. Switching requires an explicit stack name
// ("Bing aerial", "road map", "OSM", "Google 3D") — any "satellite(s)"
// phrasing ALWAYS means the satellites DATA LAYER, never a basemap; the
// session instructions carry the decision table.
//
// Road phrasings resolve to OSM, the one shipped road basemap. Every alias
// must name a live `MAP_STACKS` id: an alias for a retired stack would resolve
// cleanly and then fail at the controller with "Unknown map stack", which reads
// to the operator as a broken command rather than a retired source.
export const STACK_ALIASES = new Map([
  ['photoreal', 'photoreal'],
  ['google 3d', 'photoreal'],
  ['google', 'photoreal'],
  ['3d', 'photoreal'],
  ['photorealistic', 'photoreal'],
  ['bing-aerial', 'bing-aerial'],
  ['bing aerial', 'bing-aerial'],
  ['bing-labels', 'bing-labels'],
  ['bing labels', 'bing-labels'],
  ['labels', 'bing-labels'],
  ['aerial with labels', 'bing-labels'],
  ['esri-imagery', 'esri-imagery'],
  ['esri', 'esri-imagery'],
  ['esri imagery', 'esri-imagery'],
  ['esri satellite', 'esri-imagery'],
  ['osm', 'osm'],
  ['openstreetmap', 'osm'],
  ['open street map', 'osm'],
  ['road', 'osm'],
  ['roads', 'osm'],
  ['road map', 'osm'],
  ['amap-satellite', 'amap-satellite'],
  ['amap satellite', 'amap-satellite'],
  ['amap', 'amap-satellite'],
  ['gaode', 'amap-satellite'],
  ['autonavi', 'amap-satellite'],
  ['amap-hybrid', 'amap-hybrid'],
  ['amap hybrid', 'amap-hybrid'],
]);

/** Search order for track_entity across entity layer families. */
export const TRACKABLE_FAMILIES = [
  { layerId: 'flights', kind: 'aircraft' },
  { layerId: 'military', kind: 'aircraft' },
  { layerId: 'ais-live-vessels', kind: 'vessel' },
  { layerId: 'satellites', kind: 'satellite' },
];

export const FRAME_TARGETS = new Map([
  ['flights', 'flights'],
  ['planes', 'flights'],
  ['aircraft', 'flights'],
  ['military', 'military'],
  ['military flights', 'military'],
  ['satellites', 'satellites'],
  ['vessels', 'ais-live-vessels'],
  ['ships', 'ais-live-vessels'],
]);

const serviceCaches = new WeakMap();
export function cachesFor(service) {
  service.signal?.throwIfAborted();
  let caches = serviceCaches.get(service);
  if (!caches) {
    caches = {
      reverseGeocodeCache: new Map(),
      reverseGeocodeInFlight: new Map(),
      nearbyPlacesCache: new Map(),
      nearbyPlacesInFlight: new Map(),
    };
    serviceCaches.set(service, caches);
    service.signal?.addEventListener(
      'abort',
      () => {
        for (const cache of Object.values(caches)) cache.clear();
      },
      { once: true },
    );
  }
  return caches;
}
export const VISIBLE_ENTITY_SHORTLIST = 64;
export const BASEMAP_CONTEXT_WAIT_MS = 1500;
export const viewTargetCache = new WeakMap();
