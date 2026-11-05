/* ============================================================================
   src/boot-defer.js —— Phase7A-A：首屏非关键入口的「并行但不阻塞」装载
   ----------------------------------------------------------------------------
   改前：index.html 里 12 个 <script type="module"> 入口被 Rollup 合成**一个**
         2.67MB chunk，下载+解析+求值全排在首帧之前（架构审查 §3：prod 实测
         index chunk 2856ms）。
   改后：这里对非首屏入口改用动态 import —— 各自成 chunk，浏览器在主 chunk
         求值的同时并行拉取，但**不参与**首帧/卡片可交互的前置条件。
   判定依据（架构审查 §1）：这些模块只在用户主动打开对应面板/抽屉/拖拽时才
   产生可见效果；首屏可见的是底图 + 卡片玻璃皮 + 顶栏 + 加载遮罩。
   回滚：删掉本文件 + index.html 里对应那一行，把 6 个入口改回静态 script 即可。
   ========================================================================== */

const DEFERRED = [
  () => import('./gev-dossier.js'),
  () => import('./gev-perf.js'),
  () => import('./gev-layer-limits.js'),
  () => import('./gev-graphics.js'),
  () => import('./ui/mobile-ui.js'),
  () => import('./gev-panel-win.js'),
  () => import('./gev-cn-weather.js'),
  () => import('./gev-cn-health.js'),
];

/* 立刻发起（并行下载），失败不影响首屏：每个入口自己 console.error。 */
for (const load of DEFERRED) {
  try {
    Promise.resolve(load()).catch((error) => {
      console.error('[boot-defer] entry failed:', error);
    });
  } catch (error) {
    console.error('[boot-defer] entry threw:', error);
  }
}
