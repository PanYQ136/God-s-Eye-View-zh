import { Cesium } from '../../cesium.js';
import { normalizeCnTyphoonSnapshot } from './records.js';

/**
 * 中央气象台六级强度配色（按 CMA 英文等级代码）：
 * TD 热带低压 / TS 热带风暴 / STS 强热带风暴 / TY 台风 / STY 强台风 / SuperTY 超强台风。
 */
export const GRADE_COLOR = Object.freeze({
  TD: Cesium.Color.LIMEGREEN,
  TS: Cesium.Color.GOLD,
  STS: Cesium.Color.ORANGE,
  TY: Cesium.Color.ORANGERED,
  STY: Cesium.Color.RED,
  SuperTY: Cesium.Color.MAGENTA,
});

/** 按台风等级返回配色；未知等级回退为白色。 */
export function gradeColor(grade) {
  return GRADE_COLOR[String(grade || '').trim()] || Cesium.Color.WHITE;
}

/** analyst 查询记录（实况路径点）。 */
export function mapCnTyphoonRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    id: String(raw?.id || `CNTYPHOON-${String(index).padStart(4, '0')}`),
    lng: num(raw?.lng),
    lat: num(raw?.lat),
    grade: typeof raw?.grade === 'string' ? raw.grade : null,
    pressure: num(raw?.pressure),
    wind: num(raw?.wind),
    timeMs: num(raw?.ms),
  };
}

export { normalizeCnTyphoonSnapshot };
