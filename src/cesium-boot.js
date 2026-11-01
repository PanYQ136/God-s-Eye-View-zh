/* ============================================================================
   src/cesium-boot.js —— Cesium 求值的唯一闸门（Phase7A3）
   ----------------------------------------------------------------------------
   为什么要有它：建置期 vite-plugin-cesium 会把 5.73MB 的 `/cesium/Cesium.js`
   作为 **classic script** 注入 head。classic defer 与 module 脚本按文档顺序
   执行 —— 它排在所有 module 之前时，卡壳/LC 必须先等它下载（约 4.7s）+ 求值
   （约 3s），这就是「卡片可点 4.3–8.2s」的根因。

   现在：head 里只留 `<link rel="preload" as="script">`（下载照常并行，**不执行**），
   真正的 `<script>` 由就绪门在「卡片已挂载 + 输入已放行」之后注入 → LC 先跑，
   Cesium 的求值挪出首屏关键路径。

   dev 不需要这个闸门：vite 的 `cesium` 是普通 ESM，由应用图自己的 import 解析。
   ========================================================================== */

const EVENT = 'gev:cesium-ready';
let promise = null;

function dispatchReady(how) {
  try {
    document.dispatchEvent(new CustomEvent(EVENT, { detail: { how } }));
    window.dispatchEvent(new CustomEvent(EVENT, { detail: { how } }));
  } catch (_) {}
}

/** prod：注入 classic script 并等它求值完成；dev：立即就绪。 */
export function startCesium(how = 'inject') {
  if (promise) return promise;
  promise = new Promise((resolve) => {
    if (
      !import.meta.env.PROD ||
      typeof window === 'undefined' ||
      window.Cesium
    ) {
      dispatchReady(window.Cesium ? 'already-loaded' : 'dev-esm');
      resolve(true);
      return;
    }
    const done = (ok) => {
      dispatchReady(ok ? how : 'failed');
      resolve(ok);
    };
    const s = document.createElement('script');
    s.src = '/cesium/Cesium.js';
    s.async = false;
    s.onload = () => done(true);
    s.onerror = () => done(false);
    (document.head || document.documentElement).appendChild(s);
  });
  return promise;
}

/** 应用入口用：等 `window.Cesium` 就绪（prod 由就绪门触发注入）。 */
export function whenCesiumReady() {
  if (!import.meta.env.PROD || typeof window === 'undefined' || window.Cesium)
    return Promise.resolve(true);
  if (promise) return promise;
  /* 兜底：就绪门没被触发（LC 崩了/极慢）也不能让应用永不启动。 */
  const wait = new Promise((resolve) => {
    const on = () => resolve(true);
    document.addEventListener(EVENT, on, { once: true });
    window.addEventListener(EVENT, on, { once: true });
  });
  const timer = new Promise((resolve) =>
    setTimeout(() => resolve(startCesium('main-fallback')), 6000),
  );
  return Promise.race([wait, timer]).then(() =>
    window.Cesium ? true : startCesium('main-fallback'),
  );
}

export const CESIUM_READY_EVENT = EVENT;
