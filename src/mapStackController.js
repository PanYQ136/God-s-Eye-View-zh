import { MapSourceController } from './maps/controller.js';
import { createDefaultMapSources } from './maps/defaultSources.js';
import { governorRequestRender } from './renderGovernor.js';
export { MAP_STACKS } from './maps/catalog.js';
export { photorealUnavailableReason } from './maps/availability.js';

/** Preserve the standalone entry point; applications can compose the source controller directly. */
export class MapStackController extends MapSourceController {
  constructor(viewer, options = {}) {
    const googleApiKey =
      typeof window !== 'undefined' ? window.__GOOGLE_MAPS_API_KEY__ : '';
    const registry = createDefaultMapSources({ ...options, googleApiKey });
    super(viewer, {
      registry,
      initialStack: options.googleTileset
        ? options.initialStack || 'photoreal'
        : registry.defaultId,
      ...options,
      requestRender: governorRequestRender,
    });
    this.googleTileset = options.googleTileset || null;
    this.cesiumToken = String(options.cesiumToken || '').trim();
  }
  _hasPhotorealCredentials() {
    const googleKey =
      typeof window !== 'undefined' ? window.__GOOGLE_MAPS_API_KEY__ : '';
    return (
      Boolean(String(googleKey || '').trim()) ||
      Boolean(String(this.cesiumToken || '').trim())
    );
  }

  /**
   * Phase7A · base-first：3D Tiles 在底图之后才解析完成，注册表构造时还拿不到。
   * 把迟到的 tileset 登记到 photoreal 源上（可用性同步打开），随后的
   * setStack('photoreal') 就能走正常切换路径（隐藏 globe / 移除 imagery / credit）。
   * 返回 false 表示老版本没有 photoreal 源，调用方自行 add + 隐藏 globe 兜底。
   */
  adoptPhotorealTileset(tileset) {
    if (!tileset) return false;
    this.googleTileset = tileset;
    const source = this._sources && this._sources.get('photoreal');
    if (!source) return false;
    source.tileset = tileset;
    source.available = true;
    source.unavailableReason = null;
    return true;
  }
}
