<<<<<<< ours
import { createStandaloneApplication } from './standalone/application.js';
import { describeError } from './standalone/errors.js';
import { t } from './i18n/index.js';

// The Vite boundary exposes only undefined, null, or a validated URL.
const photonSetting = import.meta.env.PHOTON_URL;

const application = createStandaloneApplication({
  googleApiKey: import.meta.env.GOOGLE_MAPS_API_KEY,
  cesiumToken: import.meta.env.CESIUM_ION_TOKEN,
  geospatial:
    photonSetting === undefined ? {} : { endpoints: { photon: photonSetting } },
  allowQaRegistration: import.meta.env.DEV,
});

application.start().catch((error) => {
  console.error("God's Eye View initialization failed:", error);
  const loaderStatus = document.querySelector('#loading-screen .loader-status');
  loaderStatus.textContent = t('Error: {message}', {
    message: describeError(error),
  });
  loaderStatus.style.color = '#ff4444';
});
=======
/* ============================================================================
   src/main.js —— Phase7A3：薄启动壳（不再静态 import Cesium / 应用图）
   ----------------------------------------------------------------------------
   改前：body 里的 `<script type="module" src="/src/main.js">` 静态 import
         `cesium` + 整个应用图 → 模块求值必须排在建置期注入的 classic
         `/cesium/Cesium.js`（5.73MB）之后，于是 `src/lc`（卡壳/LC）只能等
         Cesium 求值完（+ App 注入 panelApi）才 mount —— 卡片可点实测 4.3–8.2s。
   改后：LC 与就绪门提到 <head>（先于 Cesium），Cesium 由 `cesium-boot.js`
         在「卡片已挂载 + 输入已放行」之后注入求值；本文件只等就绪事件再
         **动态** import 应用图（`src/bootstrap.js`，即旧 main.js 的内容）。
         结果：卡片可点 ≈0.5–1.5s，Cesium/App 在后台继续推进。
   回滚：把本文件换回静态 import 版本，并恢复 index.html 的脚本顺序。
   ========================================================================== */
import * as timeline from './boot-timeline.js';
import { whenCesiumReady } from './cesium-boot.js';

timeline.mark('main:entry');

/* 应用图动态装载：模块求值 = 旧 main.js 的模块求值（primeBaseTiles / ion 预热 /
   createStandaloneApplication / application.start()），只是时机挪到 Cesium 就绪后。 */
function loadApplication() {
  import('./bootstrap.js').catch((error) => {
    console.error("God's Eye View initialization failed:", error);
    const loaderStatus = document.querySelector(
      '#loading-screen .loader-status',
    );
    if (loaderStatus) {
      loaderStatus.textContent = `Error: ${error && error.message ? error.message : error}`;
      loaderStatus.style.color = '#ff4444';
    }
  });
}
>>>>>>> theirs

whenCesiumReady().then(loadApplication, loadApplication);
