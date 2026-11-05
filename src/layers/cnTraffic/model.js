import { Cesium } from '../../cesium.js';
import { normalizeCnTrafficSnapshot } from './records.js';

/**
 * 高德交通态势四级配色：1 畅通 / 2 缓行 / 3 拥堵 / 4 严重拥堵。
 * 文案（cell.label）直接取自服务端，不自行造词。
 */
export const LEVEL_COLOR = Object.freeze({
  1: Cesium.Color.LIMEGREEN, // 畅通
  2: Cesium.Color.GOLD, // 缓行
  3: Cesium.Color.ORANGE, // 拥堵
  4: Cesium.Color.RED, // 严重拥堵
});

/** 按路况等级返回配色；未知等级回退为暗灰（不会出现在归一化结果里）。 */
export function gradeColor(level) {
  return LEVEL_COLOR[level] || Cesium.Color.DIMGRAY;
}

/**
 * 把一个路况格映射为 analyst 可查询的纯值记录（query 引擎接缝）。
 * @returns {{id:string,lat:number,lng:number,level:number,label:string|null}}
 */
export function mapCnTrafficRecord(raw, index = 0) {
  const num = (v) => (Number.isFinite(v) ? v : null);
  return {
    id: String(raw?.stableId || `CNTRAFFIC-${String(index).padStart(4, '0')}`),
    lat: num(raw?.lat),
    lng: num(raw?.lng),
    level: num(raw?.level),
    label: typeof raw?.label === 'string' && raw.label ? raw.label : null,
    expedite: num(raw?.expedite),
    congested: num(raw?.congested),
    blocked: num(raw?.blocked),
  };
}

export { normalizeCnTrafficSnapshot };
