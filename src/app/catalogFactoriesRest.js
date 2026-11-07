/**
 * 非默认图层工厂组（问题清单 #16 · Phase8E · 波次 2）
 *
 * 22 个非默认开启的图层（卫星、CCTV、无线电、交通、船舶、地震、风场、气象、
 * 气旋、基础设施、海底光缆、FIRMS 火点……）。由 `constructCatalog.js` 在默认
 * 图层实例化之后 `await import()` 拉取，滚成一个独立 chunk：
 * 首屏入口 chunk 不再包含这些模块，它们在自己的请求里下载/评估。
 *
 * 只是把 import 边界挪到 `import()`；工厂签名、构造顺序、图层实例都不变
 * （`catalog.layers` 仍在 `createApplicationData` 注册前齐备）。
 */
export { createWeatherLayer } from '../layers/weather/index.js';
export { createCyclonesLayer } from '../layers/cyclones/index.js';
export { createWindLayer } from '../layers/wind/index.js';
export { createApplicationVessels } from './layers/aisLiveVessels.js';
export { createApplicationCctv } from './layers/cctv.js';
export { createApplicationRadio } from './layers/radio.js';
export { createApplicationTraffic } from './layers/traffic.js';
export { createApplicationBikeshare } from './layers/bikeshare.js';
export { createApplicationDirections } from './layers/directions.js';
export { createApplicationRecentImagery } from './layers/recentImagery.js';
export { createApplicationTransit } from './layers/transit.js';
export { createApplicationInstallations } from './layers/militaryInstallations.js';
export { createApplicationSatellites } from './layers/satellites.js';
export { createApplicationLaunches } from './layers/rocketLaunches.js';
export { createApplicationAlpr } from './layers/alprCameras.js';
export { createApplicationAwareness } from './layers/militaryAwareness.js';
export { createApplicationFirms } from './layers/firms.js';
export { createApplicationEarthquakes } from './layers/earthquakes.js';
export { createApplicationFirePerimeters } from './layers/perimeters.js';
export { createApplicationCables } from './layers/submarineCables.js';
export { createInfrastructureLayers } from '../data/infrastructure.js';
export { localGeoJsonServices } from './localGeojsonServices.js';
export { createApplicationAirQuality } from './layers/airQuality.js';
export { createApplicationOsmPlaces } from './layers/osmPlaces.js';
export { createApplicationGnssIntegrity } from './layers/gnss.js';
export { createApplicationGhostMaps } from './layers/ghostMaps.js';
export { createApplicationDroneAirspace } from './layers/droneAirspace.js';
export { createApplicationStreetLevel } from './layers/streetLevel.js';
export { createOsmOverlayLayers } from '../data/osmOverlays.js';
export { createApplicationCnTraffic } from './layers/cnTraffic.js';
export { createApplicationCnAdmin } from './layers/cnAdmin.js';
export { createApplicationCnQuakes } from './layers/cnQuakes.js';
export { createApplicationCnTyphoon } from './layers/cnTyphoon.js';
