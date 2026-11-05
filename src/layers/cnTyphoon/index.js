import { Cesium } from '../../cesium.js';
import { gradeColor, mapCnTyphoonRecord } from './model.js';

/**
 * 中央气象台台风图层：每个台风分别画「实况路径 + 官方预报点」，按六级强度配色。
 * 默认关闭（非默认图层）。WGS-84，不转换。
 */
export function createCnTyphoonLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('cnTyphoon requires a snapshot source');
  let _viewer = null;
  let _dataSource = null;
  let _request = null;
  let _count = 0;
  let _lastUpdate = null;
  let _lastError = null;
  let _enabled = false;

  const layer = {
    id: 'cn-typhoon',
    name: 'China Typhoons (NMC)',
    icon: '🌀',
    source: 'NMC',
    updateInterval: 600000, // 服务端 TTL 30min，600s 刷新

    init(viewer) {
      if (_viewer) throw new Error('cnTyphoon layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('cnTyphoon');
      _dataSource.show = false;
      viewer.dataSources.add(_dataSource);
      _count = 0;
      _lastUpdate = null;
      _lastError = null;
      _enabled = false;
      console.log('[Data:CnTyphoon] Initialized');
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
        const storms = await source.getSnapshot({ signal: request.signal });
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        _dataSource.entities.removeAll();
        let count = 0;
        for (const storm of storms) {
          count += renderStorm(_dataSource, storm);
        }
        _count = count;
        _lastUpdate = Date.now();
        _lastError = null;
        console.log(`[Data:CnTyphoon] Updated: ${storms.length} storms`);
        return true;
      } catch (e) {
        if (request.signal.aborted || _request !== request || !_enabled)
          return false;
        console.warn('[Data:CnTyphoon] Fetch error:', e);
        _lastError = e?.message || 'cnTyphoon source unavailable'; /* i18n-ignore */
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
        if (!p?.lng?.getValue) continue;
        result.push(
          mapCnTyphoonRecord(
            {
              id: p.id?.getValue?.(),
              lng: carto ? Cesium.Math.toDegrees(carto.longitude) : null, // prettier-ignore
              lat: carto ? Cesium.Math.toDegrees(carto.latitude) : null,
              grade: p.grade?.getValue?.(), // prettier-ignore
              pressure: p.pressure?.getValue?.(), // prettier-ignore
              wind: p.wind?.getValue?.(), // prettier-ignore
              ms: p.ms?.getValue?.(), // prettier-ignore
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

/** 渲染单个台风：实况路径（实线）+ 预报点（虚线），返回新增实体数。 */
function renderStorm(dataSource, storm) {
  let added = 0;
  const label = storm.nameCn || storm.nameEn || storm.id;
  const trackPositions = storm.points.map((p) =>
    Cesium.Cartesian3.fromDegrees(Number(p.lng), Number(p.lat)),
  );
  if (trackPositions.length >= 2) {
    dataSource.entities.add(
      new Cesium.Entity({
        polyline: {
          positions: trackPositions,
          width: 2,
          material: Cesium.Color.WHITE.withAlpha(0.9),
          clampToGround: true,
        },
      }),
    );
    added++;
  }
  for (const p of storm.points) {
    const color = gradeColor(p.grade);
    dataSource.entities.add(
      new Cesium.Entity({
        position: Cesium.Cartesian3.fromDegrees(Number(p.lng), Number(p.lat)),
        point: {
          pixelSize: 7, // prettier-ignore
          color,
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
        },
        properties: {
          id: `${storm.id}:live`,
          lng: Number(p.lng),
          lat: Number(p.lat),
          grade: p.grade,
          pressure: p.pressure,
          wind: p.wind,
          ms: p.ms,
        },
      }),
    );
    added++;
  }
  const fcPositions = storm.forecast.map((p) =>
    Cesium.Cartesian3.fromDegrees(Number(p.lng), Number(p.lat)),
  );
  if (fcPositions.length >= 2) {
    dataSource.entities.add(
      new Cesium.Entity({
        polyline: {
          positions: fcPositions,
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.CYAN.withAlpha(0.9),
          }),
          clampToGround: true,
        },
      }),
    );
    added++;
  }
  for (const p of storm.forecast) {
    const color = gradeColor(p.grade);
    dataSource.entities.add(
      new Cesium.Entity({
        position: Cesium.Cartesian3.fromDegrees(Number(p.lng), Number(p.lat)),
        point: {
          pixelSize: 6,
          color,
          outlineColor: Cesium.Color.CYAN,
          outlineWidth: 1,
        },
        properties: {
          id: `${storm.id}:fc`,
          lng: Number(p.lng),
          lat: Number(p.lat),
          grade: p.grade,
          pressure: p.pressure,
          wind: p.wind,
          ms: p.ms,
        },
      }),
    );
    added++;
  }
  if (trackPositions.length) {
    const head = trackPositions[trackPositions.length - 1];
    dataSource.entities.add(
      new Cesium.Entity({
        position: head,
        label: {
          text: label,
          font: '12px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BELOW,
          pixelOffset: new Cesium.Cartesian2(0, 8),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    );
    added++;
  }
  return added;
}
