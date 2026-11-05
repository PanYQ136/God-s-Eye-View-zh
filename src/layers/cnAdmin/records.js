/**
 * 校验并归一化 `/api/cn/admin` 的行政区划快照。
 *
 * 坐标系（见反向移植清单 §4-2）：`cityBoundary.polyline` / `districts[].polyline`
 * 是高德原始 GCJ-02，逐点 GCJ02→WGS84 后才能投 Cesium；不转会整体偏约 500m。
 */
export function normalizeCnAdminSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const cityBoundary = payload.cityBoundary;
  if (cityBoundary && typeof cityBoundary !== 'object') return null;
  const districts = payload.districts;
  if (districts != null && !Array.isArray(districts)) return null;
  return {
    source: typeof payload.source === 'string' ? payload.source : null,
    at: Number.isFinite(Number(payload.at)) ? Number(payload.at) : null,
    city: typeof payload.city === 'string' ? payload.city : null,
    province: typeof payload.province === 'string' ? payload.province : null,
    cityBoundary: cityBoundary
      ? {
          name:
            typeof cityBoundary.name === 'string' ? cityBoundary.name : null,
          adcode:
            typeof cityBoundary.adcode === 'string'
              ? cityBoundary.adcode
              : null,
          center: Array.isArray(cityBoundary.center)
            ? cityBoundary.center.map(Number)
            : null,
          polyline:
            typeof cityBoundary.polyline === 'string'
              ? cityBoundary.polyline
              : '',
        }
      : null,
    districts: Array.isArray(districts)
      ? districts
          .map((d) => ({
            name: typeof d?.name === 'string' ? d.name : null,
            adcode: typeof d?.adcode === 'string' ? d.adcode : null,
            polyline: typeof d?.polyline === 'string' ? d.polyline : '',
          }))
          .filter((d) => d.polyline)
      : [],
    note: typeof payload.note === 'string' ? payload.note : null,
  };
}
