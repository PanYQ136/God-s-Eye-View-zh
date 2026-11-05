/**
 * 校验并归一化 `/api/cn/quakes` 的 CENC 地震目录。
 * WGS-84 坐标，无需转换（见反向移植清单 §4-2）。
 */
export function normalizeCnQuakesSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const quakes = payload.quakes;
  if (!Array.isArray(quakes)) return null;
  const rows = [];
  const ids = new Set();
  for (const [index, q] of quakes.entries()) {
    if (!q || typeof q !== 'object') return null;
    const lat = Number(q.lat);
    const lng = Number(q.lng);
    const magnitude = Number(q.magnitude);
    if (
      !Number.isFinite(lat) ||
      Math.abs(lat) > 90 ||
      !Number.isFinite(lng) ||
      Math.abs(lng) > 180 ||
      !Number.isFinite(magnitude) ||
      magnitude <= 0
    ) {
      continue; // 跳过缺坐标/缺震级的记录
    }
    const id = String(q.id != null && q.id !== '' ? q.id : `cnq-${index}`);
    if (ids.has(id)) return null;
    ids.add(id);
    rows.push({
      id,
      lat,
      lng,
      magnitude,
      depth: Number.isFinite(Number(q.depth)) ? Number(q.depth) : null,
      intensity: Number.isFinite(Number(q.intensity))
        ? Number(q.intensity)
        : null,
      place: typeof q.place === 'string' ? q.place : null,
      time: Number.isFinite(Number(q.ms)) ? Number(q.ms) : null,
      type: typeof q.type === 'string' ? q.type : null,
    });
  }
  return rows;
}
