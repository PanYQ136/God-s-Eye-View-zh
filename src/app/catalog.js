import { createPendingLayerHandle } from './pendingLayer.js';

const CONTROL_LAYER_IDS = Object.freeze({
  trafficLayer: 'traffic',
  flightsLayer: 'flights',
  militaryFlightsLayer: 'military',
  satellitesLayer: 'satellites',
  cctvLayer: 'cctv',
  radioLayer: 'radio',
  bikeshareLayer: 'bikeshare',
  transitLayer: 'transit',
  aisLiveVesselsLayer: 'ais-live-vessels',
  militaryAwarenessLayer: 'military-awareness',
  militaryInstallationsLayer: 'military-installations',
  rocketLaunchesLayer: 'rocket-launches',
  localAdsbLayer: 'local-adsb',
});

function freezeMetadata(metadata) {
  return Object.freeze(metadata.map((entry) => Object.freeze({ ...entry })));
}

function indexMetadata(metadata) {
  const ids = new Set();
  for (const entry of metadata) {
    if (typeof entry?.id !== 'string' || !entry.id || ids.has(entry.id))
      throw new TypeError(
        `Unmatched or duplicate catalog metadata: ${entry?.id}`,
      );
    ids.add(entry.id);
  }
  return ids;
}

/** Capture the ordered application instances and their serialization metadata. */
export function createLayerCatalog(layers, metadata) {
  if (!Array.isArray(layers) || !Array.isArray(metadata))
    throw new TypeError(
      'Layer instances and serialization metadata are required',
    );
  const byId = new Map();
  for (const layer of layers) {
    if (typeof layer?.id !== 'string' || !layer.id || byId.has(layer.id))
      throw new TypeError(`Invalid or duplicate catalog layer: ${layer?.id}`);
    byId.set(layer.id, layer);
  }
  const ids = indexMetadata(metadata);
  for (const entry of metadata) {
    if (!byId.has(entry?.id))
      throw new TypeError(
        `Unmatched or duplicate catalog metadata: ${entry?.id}`,
      );
  }
  if (ids.size !== byId.size)
    throw new TypeError('Catalog metadata is incomplete');
  return Object.freeze({
    layers: Object.freeze([...layers]),
    metadata: freezeMetadata(metadata),
    get: (id) => byId.get(id),
  });
}

/**
 * Append-only catalog for layer factories that arrive after first paint.
 *
 * Phase8E2（t_1ad4e981）：`metadata` 是静态的序列化注册表（33 条），所以
 * 「图层集合」在实例存在之前就已确定——后置注册只补实例，不动集合语义：
 *
 *   · `layers` / `metadata` / `get` 与 `createLayerCatalog` 同义；`layers`
 *     每次读取给出「当前已注册实例」的冻结快照（顺序 = 注册顺序 = 一次性
 *     构造时的顺序）。
 *   · `pendingLayerIds` 是尚未注册的 id；`complete` 表示全部到齐。
 *   · `resolve(id)` 为未注册的 id 返回稳定句柄（见 pendingLayer.js），让启动期
 *     就捕获引用的控制面板在实例到齐后自动转发。
 *   · `add(layer)` 只接受注册表内、尚未注册的实例；`subscribeLayers(fn)`
 *     通知后置注册。
 *   · `hydrate()` 由构造方注入：拉取剩余工厂、构造、逐个 `add`。单飞，失败
 *     后可重试。
 */
export function createDeferredLayerCatalog(
  layers,
  metadata,
  { hydrate: produceLayers } = {},
) {
  if (!Array.isArray(layers) || !Array.isArray(metadata))
    throw new TypeError(
      'Layer instances and serialization metadata are required',
    );
  if (produceLayers !== undefined && typeof produceLayers !== 'function')
    throw new TypeError('Deferred catalog hydration must be a function');
  const ids = indexMetadata(metadata);
  const registered = new Map();
  const order = [];
  const pending = new Set(ids);
  const handles = new Map();
  const addedListeners = new Set();
  let hydration = null;

  const add = (layer) => {
    const id = layer?.id;
    if (typeof id !== 'string' || !id)
      throw new TypeError(`Invalid or duplicate catalog layer: ${id}`);
    if (!ids.has(id))
      throw new TypeError(`Catalog metadata is incomplete: ${id}`);
    if (registered.has(id))
      throw new TypeError(`Invalid or duplicate catalog layer: ${id}`);
    registered.set(id, layer);
    order.push(layer);
    pending.delete(id);
    handles.get(id)?.materialize(layer);
    for (const listener of [...addedListeners]) {
      try {
        listener(layer, catalog);
      } catch (error) {
        console.warn('[catalog] deferred layer listener failed:', error);
      }
    }
    return layer;
  };

  for (const layer of layers) add(layer);

  const catalog = Object.freeze({
    get layers() {
      return Object.freeze([...order]);
    },
    metadata: freezeMetadata(metadata),
    get: (id) => registered.get(id),
    resolve(id) {
      const layer = registered.get(id);
      if (layer) return layer;
      if (!pending.has(id)) return undefined;
      let handle = handles.get(id);
      if (!handle) {
        handle = createPendingLayerHandle(id, () => registered.get(id));
        handles.set(id, handle);
      }
      return handle;
    },
    get pendingLayerIds() {
      return Object.freeze([...pending]);
    },
    get complete() {
      return pending.size === 0;
    },
    add,
    subscribeLayers(listener) {
      if (typeof listener !== 'function')
        throw new TypeError('Expected a layer listener');
      addedListeners.add(listener);
      return () => addedListeners.delete(listener);
    },
    /** Pull the remaining factories and register their instances. Single-flight. */
    hydrate() {
      if (!produceLayers) return Promise.resolve(catalog);
      if (pending.size === 0) return Promise.resolve(catalog);
      hydration ||= Promise.resolve()
        .then(() => produceLayers())
        .then((produced) => {
          for (const layer of produced) add(layer);
          return catalog;
        })
        .catch((error) => {
          hydration = null;
          throw error;
        });
      return hydration;
    },
  });

  return catalog;
}

/** Bind the current control surface to the exact instances registered by the app. */
export function catalogControlServices(catalog) {
  if (!catalog?.get)
    throw new TypeError('An application layer catalog is required');
  return Object.fromEntries(
    Object.entries(CONTROL_LAYER_IDS).map(([role, id]) => {
      // A deferred catalog hands out a stable pending handle for layers whose
      // factory chunk has not arrived yet; the eager catalog resolves to the
      // registered instance so identity comparisons keep working.
      const layer = catalog.resolve ? catalog.resolve(id) : catalog.get(id);
      if (!layer)
        throw new TypeError(`Control layer missing from catalog: ${id}`);
      return [role, layer];
    }),
  );
}
