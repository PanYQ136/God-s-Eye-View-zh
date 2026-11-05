import { Cesium } from '../../cesium.js';
import { magColor, mapCnQuakesRecord } from './model.js';

/**
 * 中国地震台网图层：把 CENC 地震目录渲染为按震级着色的点 + 标签。
 * 默认关闭（非默认图层）。WGS-84，不转换。
 */
export function createCnQuakesLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('cnQuakes requires a snapshot source');
  let _viewer = null;
  let _dataSource = null;
  let _request = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'cn-quakes',
    name: 'China Earthquakes (CENC)',
    icon: '🌐',
    source: 'CENC',
    updateInterval: 300000, // 服务端 TTL 5min，300s 刷新

    init(viewer) {
      if (_viewer) throw new Error('cnQuakes layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('cnQuakes');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      console.log('[Data:CnQuakes] Initialized');
    },

    enable(viewer) {
      _enabled = true;
      if (_dataSource) _dataSource.show = true;
    },

    disable(viewer) {
      _request?.abort();
      _request = null;
      _enabled = false;
      if (_dataSource) _dataSource.show = false;
    },

    async update(viewer) {
      if (!_enabled || !_dataSource) return false;
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const rows = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _dataSource.entities.removeAll();
        for (const row of rows) {
          const color = magColor(row.magnitude);
          const baseRadius = Math.pow(1.8, row.magnitude) * 1500;
          const isSignificant = row.magnitude >= 5.0;
          _dataSource.entities.add(
            new Cesium.Entity({
              id: `cnQuakes:${row.id}`,
              position: Cesium.Cartesian3.fromDegrees(row.lng, row.lat),
              ellipse: {
                semiMajorAxis: baseRadius,
                semiMinorAxis: baseRadius,
                material: color.withAlpha(isSignificant ? 0.4 : 0.28),
                outline: true,
                outlineColor: color.withAlpha(isSignificant ? 1.0 : 0.8),
                outlineWidth: isSignificant ? 3 : 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              label: isSignificant
                ? {
                    text: `M${row.magnitude.toFixed(1)}`,
                    font: '12px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.BELOW,
                    pixelOffset: new Cesium.Cartesian2(0, 8),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                  }
                : undefined,
              properties: {
                id: row.id,
                magnitude: row.magnitude,
                depth: row.depth,
                intensity: row.intensity,
                place: row.place,
                time: row.time,
                type: row.type,
              },
            }),
          );
        }
        _count = rows.length;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:CnQuakes] Updated: ${_count} events`);
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:CnQuakes] Fetch error:', e);
        _lastError =
          e?.message || 'cnQuakes source unavailable'; /* i18n-ignore */
        return false;
      } finally {
        if (_request === request) _request = null;
      }
    },

    destroy(viewer = _viewer) {
      _request?.abort();
      _request = null;
      _viewer = null;
      _enabled = false;
      if (_dataSource) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
    },

    getAnalystRecords(maxCount = 2000) {
      if (!_dataSource || !_dataSource.show) return [];
      const entities = _dataSource.entities.values;
      if (!entities.length) return [];
      const limit = Number.isFinite(maxCount)
        ? Math.max(1, Math.floor(maxCount))
        : 2000;
      const result = [];
      for (const entity of entities) {
        if (result.length >= limit) break;
        const c = entity.position?.getValue(Cesium.JulianDate.now());
        const carto = c ? Cesium.Cartographic.fromCartesian(c) : null;
        const p = entity.properties;
        result.push(
          mapCnQuakesRecord(
            {
              id: p?.id?.getValue?.(),
              magnitude: p?.magnitude?.getValue?.(),
              depth: p?.depth?.getValue?.(),
              intensity: p?.intensity?.getValue?.(),
              place: p?.place?.getValue?.(),
              time: p?.time?.getValue?.(),
              type: p?.type?.getValue?.(),
              lat: carto ? Cesium.Math.toDegrees(carto.latitude) : null,
              lng: carto ? Cesium.Math.toDegrees(carto.longitude) : null,
            },
            result.length,
          ),
        );
      }
      return result;
    },

    getStats() {
      return { count: _count, lastUpdate: _lastUpdate, error: _lastError };
    },
  };
  return layer;
}
