/**
 * 校验并归一化 `/api/cn/traffic` 的网格快照为可渲染的路况格。
 *
 * 坐标系约定（见反向移植清单 §4-2）：`cells[].lat/lng` 是服务端按「前端传入的
 * bbox 等分算出的格心」，坐标系与传入 bbox 一致；前端传 WGS-84 即按 WGS-84 绘制，
 * 切勿再逆变换（再转会整体偏约 500m）。服务端已丢弃 `level=0` 的格，这里防御性跳过。
 */
export function normalizeCnTrafficSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const cells = payload.cells;
  if (!Array.isArray(cells)) return null;
  const rows = [];
  const ids = new Set();
  for (const [index, cell] of cells.entries()) {
    if (!cell || typeof cell !== 'object') return null;
    const lat = Number(cell.lat);
    const lng = Number(cell.lng);
    const level = Number(cell.level);
    if (
      !Number.isFinite(lat) ||
      Math.abs(lat) > 90 ||
      !Number.isFinite(lng) ||
      Math.abs(lng) > 180 ||
      !Number.isFinite(level)
    ) {
      return null;
    }
    if (level <= 0) continue; // level 0 视为「无数据」格，跳过
    const stableId = `cell-${index}`;
    if (ids.has(stableId)) return null;
    ids.add(stableId);
    rows.push({
      stableId,
      lat,
      lng,
      radius: Number.isFinite(Number(cell.radius)) ? Number(cell.radius) : 800,
      level,
      label: typeof cell.label === 'string' ? cell.label : null,
      expedite: Number(cell.expedite) || 0,
      congested: Number(cell.congested) || 0,
      blocked: Number(cell.blocked) || 0,
      sample: Number(cell.sample) || 0,
    });
  }
  return rows;
}
