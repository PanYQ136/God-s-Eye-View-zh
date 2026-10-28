#!/usr/bin/env node
/* 诊断 FPS：空载 vs 展开态、窗口可见性/焦点、Cesium canvas 宽度、rAF 间隔分布 */
import puppeteer from 'puppeteer';
const URL = 'http://127.0.0.1:4173/';
const W = 1536;
const H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  protocolTimeout: 300000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {}
});
await page.addScriptTag;
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break;
  await sleep(400);
}
await sleep(9000);

const fps = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const gaps = [];
        let last = performance.now();
        const t0 = last;
        const tick = (t) => {
          gaps.push(+(t - last).toFixed(1));
          last = t;
          if (t - t0 < 2000) requestAnimationFrame(tick);
          else {
            const g = gaps.slice(2).sort((a, b) => a - b);
            const p = (q) => g[Math.min(g.length - 1, Math.floor(g.length * q))];
            resolve({
              fps: +(gaps.length / ((t - t0) / 1000)).toFixed(1),
              p50: p(0.5),
              p90: p(0.9),
              max: Math.max(...gaps),
              frames: gaps.length,
            });
          }
        };
        requestAnimationFrame(tick);
      }),
  );

const env = await page.evaluate(() => {
  const c = document.querySelector('canvas.cesium-widget-canvas, #cesiumContainer canvas, canvas');
  const r = c ? c.getBoundingClientRect() : null;
  return {
    vis: document.visibilityState,
    focus: document.hasFocus(),
    dpr: window.devicePixelRatio,
    inner: [innerWidth, innerHeight],
    canvas: r ? [Math.round(r.width), Math.round(r.height)] : null,
    canvases: document.querySelectorAll('canvas').length,
    gpu: window.__gevGpu ? window.__gevGpu.tier() : null,
    cesium: !!window.Cesium,
    scene: (() => { try { return window.viewer && window.viewer.scene && window.viewer.scene.globe ? 'globe' : (window.cesiumWidget ? 'widget' : 'none'); } catch (e) { return 'err'; } })(),
  };
});
console.log('ENV', JSON.stringify(env));
console.log('IDLE-1', JSON.stringify(await fps()));
console.log('IDLE-2', JSON.stringify(await fps()));

await page.evaluate(() => window.__lc.api.dispatch({ type: 'ACTIVATE', id: 'cctv-panel' }));
await sleep(1200);
console.log('OPEN-1', JSON.stringify(await fps()));
console.log('OPEN-2', JSON.stringify(await fps()));
const after = await page.evaluate(() => {
  const c = document.querySelector('canvas.cesium-widget-canvas, #cesiumContainer canvas, canvas');
  const r = c ? c.getBoundingClientRect() : null;
  return { canvas: r ? [Math.round(r.width), Math.round(r.height)] : null, phase: window.__lc.api.phases()['cctv-panel'] };
});
console.log('AFTER', JSON.stringify(after));
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'cctv-panel' }));
await sleep(900);
console.log('CLOSED', JSON.stringify(await fps()));
console.log('ERRS', JSON.stringify(errs));
await browser.close();
