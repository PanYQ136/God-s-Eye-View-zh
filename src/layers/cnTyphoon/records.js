/**
 * 校验并归一化 `/api/cn/typhoon` 的中央气象台台风数据。
 * WGS-84 坐标，无需转换（见反向移植清单 §4-2）。
 */
export function normalizeCnTyphoonSnapshot(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const storms = payload.storms;
  if (!Array.isArray(storms)) return null;
  const out = [];
  for (const s of storms) {
    if (!s || typeof s !== 'object') return null;
    const points = Array.isArray(s.points)
      ? s.points.filter(
          (p) =>
            p &&
            Number.isFinite(Number(p.lng)) &&
            Number.isFinite(Number(p.lat)),
        )
      : [];
    const forecast = Array.isArray(s.forecast)
      ? s.forecast.filter(
          (p) =>
            p &&
            Number.isFinite(Number(p.lng)) &&
            Number.isFinite(Number(p.lat)),
        )
      : [];
    if (!points.length) continue; // 无实况路径的台风跳过
    out.push({
      id: String(s.id != null ? s.id : ''),
      nameEn: typeof s.nameEn === 'string' ? s.nameEn : '',
      nameCn: typeof s.nameCn === 'string' ? s.nameCn : '',
      year: typeof s.year === 'string' ? s.year : '',
      points,
      forecast,
    });
  }
  return out;
}
