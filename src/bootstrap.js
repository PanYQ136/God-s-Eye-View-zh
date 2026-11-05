/* ============================================================================
   src/bootstrap.js —— 旧 src/main.js 的全部内容（Phase7A3 搬家，逻辑零改动）
   ----------------------------------------------------------------------------
   本模块由 src/main.js 在 Cesium 全局就绪后**动态** import：模块求值即旧
   main:entry 之后的全部启动动作（底图预取 / ion 预热 / createApplication）。
   为了保持「模块求值 = 启动」的旧语义，这里不导出 start()，直接在求值时执行。
   ========================================================================== */
import { Cesium } from './cesium.js';
import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';
import {
  primePhotorealTilesetLoad,
  selectMapStartupRoute,
} from './mapStartup.js';
import { warmIonAsset } from './maps/tileWarmup.js';
import { primeBaseTiles } from './maps/baseTilePrefetch.js';
/* Phase7A3：这两个入口的顶部就引用 Cesium 全局（/cesium/Cesium.js 的 classic 全局），
   原先靠「classic defer 排在 module 之前」才成立。现在 Cesium 改为按需注入，
   它们必须跟应用图一起在 Cesium 就绪后求值 —— 顺序与旧 index.html 一致
   （autolocate 在应用构造之前；boot-defer 只是并行装载非首屏 chunk）。 */
import './gev-autolocate.js';
import './boot-defer.js';

/* Phase7A · base-first：底图瓦片在**模块求值**就按「上次位置/家」开始预取
   （WebMercator z1..z14 中心链 + 底图栈确定后的 z12/13/14 视野环）。
   实测底图要逐级走金字塔 2.2s，预取把每一级的网络往返换成缓存命中。 */
primeBaseTiles();

/* Phase6C4 · 冷启动关键路径提前（只搬运，不改任何判定/视觉）：
   ① ion 资产端点 `cache-control: no-cache`，原本排在 viewer:ready（≈2.2 s）之后
      才发起，0.7–2.1 s 纯等待 → 这里 main:entry 就发，与 Viewer 构造并行；
   ② 端点一回来就并行预取 root.json + 首批瓦片树进 HTTP 缓存（瓦片响应
      `private, max-age=14400`），Cesium 之后的同 URL 请求直接命中缓存。
   direct 路由（有 Google key）保持原样：它的 key 由 scene 在构造 Viewer 前写入
   全局，提前发起会改变时序。 */
{
  const bootCreds = {
    googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
    cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  };
  /* 诊断开关：`?tilewarm=0` 关掉本卡的提前发起 + 瓦片预取（用来做同时刻 A/B，
     不影响产品默认路径）。 */
  const warmOff =
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).get('tilewarm') === '0';
  if (!warmOff && selectMapStartupRoute(bootCreds) === 'google-ion') {
    const warmEndpoint = warmIonAsset({ accessToken: bootCreds.cesiumToken });
    primePhotorealTilesetLoad(Cesium, {
      ...bootCreds,
      warmEndpoint: warmEndpoint.promise,
    });
  }
}

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  allowQaRegistration: import.meta.env.DEV,
});

application.start().catch((error) => {
  console.error("God's Eye View initialization failed:", error);
  const loaderStatus = document.querySelector('#loading-screen .loader-status');
  loaderStatus.textContent = `Error: ${describeError(error)}`; /* i18n-ignore */
  loaderStatus.style.color = '#ff4444';
});

export { application };
