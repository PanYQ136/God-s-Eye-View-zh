import { Cesium } from '../../cesium.js';
import { normalizeCnQuakesSnapshot } from './records.js';

/** 按震级配色：<3 绿 / 3–5 黄 / 5–7 橙 / ≥7 红。 */
export function magColor(mag) {
  if (mag >= 7) return Cesium.Color.RED;
  if (mag >= 5) return Cesium.Color.ORANGE;
  if (mag >= 3) return Cesium.Color.GOLD;
  return Cesium.Color.LIMEGREEN;
}

/** analyst 查询记录。 */
export function mapCnQuakesRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    id: String(raw?.id || `CNQUAKE-${String(index).padStart(4, '0')}`),
    magnitude: num(raw?.magnitude),
    depthKm: num(raw?.depth),
    intensity: num(raw?.intensity),
    lat: num(raw?.lat),
    lng: num(raw?.lng),
    timeMs: num(raw?.time),
    place: typeof raw?.place === 'string' && raw.place ? raw.place : null,
  };
}

export { normalizeCnQuakesSnapshot };
