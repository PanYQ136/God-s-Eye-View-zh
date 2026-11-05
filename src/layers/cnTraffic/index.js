import { Cesium } from '../../cesium.js';
import { gradeColor, mapCnTrafficRecord } from './model.js';

/** 取当前相机视口的 WGS-84 地理矩形；视口未就绪时返回 null。 */
function currentBbox(viewer) {
  const camera = viewer?.camera;
  if (!camera?.computeViewRectangle) return null;
  const ellipsoid = viewer?.scene?.globe?.ellipsoid || Cesium.Ellipsoid.WGS84;
  const rect = camera.computeViewRectangle(ellipsoid);
  if (!rect) return null;
  const west = Cesium.Math.toDegrees(rect.west);
  const south = Cesium.Math.toDegrees(rect.south);
  const east = Cesium.Math.toDegrees(rect.east);
  const north = Cesium.Math.toDegrees(rect.north);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  return [west, south, east, north];
}

/**
 * 国内实时路况图层：把 `/api/cn/traffic` 的网格采样渲染为按等级着色的格 + 中文文案标签。
 * 默认关闭（非默认图层）。坐标系：格心与传入 bbox 一致（WGS-84），不再逆变换。
 */
export function createCnTrafficLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('cnTraffic requires a snapshot source');
  let _viewer = null;
  let _dataSource = null;
  let _request = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'cn-traffic',
    name: 'China Traffic (Realtime)',
    icon: '🚦',
    source: 'AMap',
    updateInterval: 180000, // 服务端 TTL 3min，180s 刷新

    init(viewer) {
      if (_viewer) throw new Error('cnTraffic layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('cnTraffic');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      console.log('[Data:CnTraffic] Initialized');
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
      const bbox = currentBbox(viewer);
      if (!bbox) return false; // 视口未就绪，跳过本轮
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const rows = await source.getSnapshot({
          signal: request.signal,
          bbox,
          grid: 2,
        });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _dataSource.entities.removeAll();
        for (const row of rows) {
          const color = gradeColor(row.level);
          _dataSource.entities.add(
            new Cesium.Entity({
              id: `cnTraffic:${row.stableId}`,
              position: Cesium.Cartesian3.fromDegrees(row.lng, row.lat),
              ellipse: {
                semiMajorAxis: row.radius,
                semiMinorAxis: row.radius,
                material: color.withAlpha(0.55),
                outline: true,
                outlineColor: color.withAlpha(0.9),
                outlineWidth: 1,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              label: row.label
                ? {
                    text: row.label,
                    font: '11px sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    verticalOrigin: Cesium.VerticalOrigin.CENTER,
                    horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
                    pixelOffset: new Cesium.Cartesian2(0, 0),
                    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                  }
                : undefined,
              properties: {
                level: row.level,
                label: row.label,
                expedite: row.expedite,
                congested: row.congested,
                blocked: row.blocked,
              },
            }),
          );
        }
        _count = rows.length;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:CnTraffic] Updated: ${_count} cells`);
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:CnTraffic] Fetch error:', e);
        _lastError = e?.message || 'cnTraffic source unavailable'; /* i18n-ignore */
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
          mapCnTrafficRecord(
            {
              stableId: p?.id?.getValue?.(),
              lat: carto ? Cesium.Math.toDegrees(carto.latitude) : null,
              lng: carto ? Cesium.Math.toDegrees(carto.longitude) : null,
              level: p?.level?.getValue?.(),
              label: p?.label?.getValue?.(),
              expedite: p?.expedite?.getValue?.(),
              congested: p?.congested?.getValue?.(),
              blocked: p?.blocked?.getValue?.(),
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
