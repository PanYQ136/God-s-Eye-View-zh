<<<<<<< ours
import { msg, t } from '../../i18n/index.js';
import { STATUS_POLL_MS } from './policy.js';
=======
import {
  STATUS_POLL_MS,
  RENDER_LIMIT_MIN,
  RENDER_LIMIT_MAX,
} from './policy.js';
>>>>>>> theirs

export function createControls({ state: layerState, services, parts, source }) {
  const governorRequestRender = services.render?.governorRequestRender;
  const methods = {
    id: 'bikeshare',

    name: 'Bikeshare',

    icon: '🚲',

    source: 'GBFS',

    updateInterval: STATUS_POLL_MS,

    /**
     * Live layer params.
     * `renderLimit` (0–999) keeps only the stations nearest the camera
     * rendered; 999 means unlimited (the default) and 0 renders nothing but a
     * selected station.
     * @param {{renderLimit?: number}} params
     * @returns {boolean} Always true.
     */
    setParams(params = {}) {
      if (Number.isFinite(params.renderLimit)) {
        const limit = Math.max(
          RENDER_LIMIT_MIN,
          Math.min(RENDER_LIMIT_MAX, Math.floor(params.renderLimit)),
        );
        if (limit !== layerState._renderLimit) {
          layerState._renderLimit = limit;
          // Re-rank the stations already in hand and repaint — no GBFS request,
          // no city re-activation, so the limit lands immediately.
          parts.rendering.applyRenderLimit();
          if (typeof governorRequestRender === 'function')
            governorRequestRender('bikeshare-render-limit');
          else layerState._viewer?.scene?.requestRender?.();
        }
      }
      return true;
    },

    getParams() {
      return { renderLimit: layerState._renderLimit };
    },

    /**
     * Return a sampled array of detectable station objects for HUD overlay rendering.
     * @param {Object} [options] - Sampling options (maxCount, seed).
     * @returns {Array<{ position: Cesium.Cartesian3, id: string, type: string, skipLabel: boolean }>}
     */
    getDetectableObjects(options = {}) {
      return parts.queries.collectDetectableStations(options);
    },

    /**
     * Snapshot loaded bikeshare stations as plain JSON-safe records for the analyst
     * query engine. On demand only (once per spoken query); [] while the
     * layer is off.
     * @param {number} [maxCount=Infinity] Most records to return.
     * @returns {Array<Object>} {id, name, city, lat, lon, bikesAvailable, docksAvailable, capacity, renting}.
     */
    getAnalystRecords(maxCount = Infinity) {
      if (!layerState._enabled) return [];
      const num = (v) => (Number.isFinite(v) ? v : null);
      const result = [];
      for (const record of layerState._stationRenderMap.values()) {
        if (result.length >= maxCount) break;
        const info = layerState._stationInfoCache
          .get(record.cityId)
          ?.get(record.stationId);
        if (!Number.isFinite(info?.lat) || !Number.isFinite(info?.lon))
          continue;
        result.push({
          id: record.stationName || `Dock ${record.stationId}`,
          name: record.stationName || null,
          city: record.cityId || null,
          lat: info.lat,
          lon: info.lon,
          bikesAvailable: num(record.bikesAvailable),
          docksAvailable: num(record.docksAvailable),
          capacity: num(record.capacity),
          renting: record.isRenting !== false,
        });
      }
      return result;
    },

    /**
     * Return current layer statistics for the UI status display.
     * @returns {{ count: number, lastUpdate: number|null, loading: boolean, loadingLabel?: string, error?: string, degraded?: boolean, stale?: boolean }}
     */
    getStats() {
      const stats = {
        count: layerState._count,
        lastUpdate: layerState._lastUpdate,
        loading: layerState._loading,
      };
      if (layerState._loading) {
        stats.loadingLabel =
          layerState._activeCityIds.size > 0
            ? t('syncing {count} city feeds...', {
                count: layerState._activeCityIds.size,
              })
            : t('scanning nearby systems...');
      }
      // A failed city is only the layer's failure when it left nothing on the
      // map. While other cities still render, the partial failure reads
      // DEGRADED; when every in-range city failed and only previously drawn
      // points remain, they read STALE.
      if (layerState._failedCityIds.size > 0) {
        if (layerState._stationRenderMap.size === 0) {
          stats.error = msg('GBFS fetch error');
        } else {
          stats.degraded = true;
          const allFailed = Array.from(layerState._activeCityIds).every(
            (cityId) => layerState._failedCityIds.has(cityId),
          );
          if (allFailed) stats.stale = true;
        }
      }
      return stats;
    },
  };

  return { methods };
}
