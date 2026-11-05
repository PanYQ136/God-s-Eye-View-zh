import { Cesium } from '../../cesium.js';
import { parseAmapPolyline } from './model.js';

/**
 * 行政区边界图层：把 `/api/cn/admin` 的市界 + 区县界渲染为多边形。
 * 默认关闭（非默认图层）。坐标系：polyline 原始 GCJ-02，由 model.parseAmapPolyline 逐点转 WGS-84。
 */
export function createCnAdminLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('cnAdmin requires a snapshot source');
  let _viewer = null;
  let _dataSource = null;
  let _request = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'cn-admin',
    name: 'China Admin Boundaries',
    icon: '🗺️',
    source: 'AMap',
    updateInterval: 86400000, // 行政区几乎不变，24h

    init(viewer) {
      if (_viewer) throw new Error('cnAdmin layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('cnAdmin');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      console.log('[Data:CnAdmin] Initialized');
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
      // 以一个稳定的中国中心点取行政区（如未授权相机定位，则回退到北京）。
      const center = currentCenter(viewer) || [116.4074, 39.9042];
      _request?.abort();
      const request = new AbortController();
      _request = request;
      try {
        const snapshot = await source.getSnapshot({
          signal: request.signal,
          lat: center[1],
          lng: center[0],
        });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _dataSource.entities.removeAll();
        let count = 0;
        if (snapshot) {
          if (snapshot.cityBoundary?.polyline) {
            count += addRings(
              _dataSource,
              parseAmapPolyline(snapshot.cityBoundary.polyline),
              Cesium.Color.CORNFLOWERBLUE.withAlpha(0.12),
              Cesium.Color.CORNFLOWERBLUE,
              snapshot.cityBoundary.name || snapshot.city || 'City',
            );
          }
          for (const d of snapshot.districts) {
            count += addRings(
              _dataSource,
              parseAmapPolyline(d.polyline),
              Cesium.Color.GOLD.withAlpha(0.08),
              Cesium.Color.GOLD,
              d.name || 'District',
            );
          }
        }
        _count = count;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:CnAdmin] Updated: ${_count} regions`);
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:CnAdmin] Fetch error:', e);
        _lastError = e?.message || 'cnAdmin source unavailable';
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

    getStats() {
      return { count: _count, lastUpdate: _lastUpdate, error: _lastError };
    },
  };
  return layer;
}

/** 取当前相机视口中心（WGS-84）；未就绪返回 null。 */
function currentCenter(viewer) {
  const camera = viewer?.camera;
  if (!camera?.computeViewRectangle) return null;
  const ellipsoid = viewer?.scene?.globe?.ellipsoid || Cesium.Ellipsoid.WGS84;
  const rect = camera.computeViewRectangle(ellipsoid);
  if (!rect) return null;
  const lng = Cesium.Math.toDegrees((rect.west + rect.east) / 2);
  const lat = Cesium.Math.toDegrees((rect.south + rect.north) / 2);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}

/** 把环数组渲染为多边形实体，返回新增实体数。 */
function addRings(dataSource, rings, fill, outline, label) {
  if (!Array.isArray(rings) || !rings.length) return 0;
  let added = 0;
  const allPositions = [];
  for (const ring of rings) {
    const positions = ring.map(([lng, lat]) =>
      Cesium.Cartesian3.fromDegrees(lng, lat),
    );
    if (positions.length < 3) continue;
    dataSource.entities.add(
      new Cesium.Entity({
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: fill,
          outline: true,
          outlineColor: outline,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      }),
    );
    added++;
    for (const p of positions) allPositions.push(p);
  }
  if (allPositions.length && label) {
    const center = Cesium.BoundingSphere.fromPoints(allPositions).center;
    dataSource.entities.add(
      new Cesium.Entity({
        position: center,
        label: {
          text: label,
          font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    );
  }
  return added;
}
