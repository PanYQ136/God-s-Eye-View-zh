/**
 * 首屏默认图层工厂组（问题清单 #16 · Phase8E）
 *
 * 这个模块只装「打开就要有」的东西：默认开启的航班/军机/本地 ADS-B，以及
 * 与它们同生命周期的基础设施（军机身份分类、天气时钟、两条 Bhote Koshi 洪水层）。
 * 它由 `src/app/constructCatalog.js` 用 `await import()` 拉取 —— 是**波次 1**。
 *
 * 为什么要分波次：这之前 `constructCatalog.js` 用 30 条静态 import 把 24 个图层的
 * 285 个文件和入口图绑死，首屏 chunk 里必然包含全部图层代码。拆波后
 *   波次 1（本文件） → 默认图层，先评估；
 *   波次 2（`catalogFactoriesRest.js`）→ 22 个非默认图层，独立 chunk，单独请求。
 * 两个 chunk 都由 Vite 的 `import()` 生成，构建时自动带 modulepreload 依赖图，
 * 首屏入口（`index-*.js` / `bootstrap-*.js`）不再包含这两组图层模块。
 *
 * 不改变构造语义：同一批工厂、同一个调用顺序、同一个 catalog 冻结时机。
 */
export { createMilitaryRegistry } from '../layers/aircraft/classification.js';
export { createWeatherClock } from '../layers/weather/clock.js';
export { createApplicationFlights } from './layers/flights.js';
export { createApplicationMilitary } from './layers/militaryFlights.js';
export { createApplicationLocalAdsb } from './layers/localAdsb.js';
export { createBhoteKoshiEventLayer } from '../data/bhoteKoshiEvent.js';
export { createBhoteKoshiLocatorLayer } from '../data/bhoteKoshiLocator.js';
