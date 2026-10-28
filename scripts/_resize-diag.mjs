#!/usr/bin/env node
/** _resize-diag.mjs —— 查「Cesium 渲染停止（Expected width > 0）」的触发源：
 *  记录每次 window resize 与 viewer.resize() 时地图容器的尺寸，以及错误面板出现时刻。 */
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--window-size=1560,860', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push('[c] ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('[pe] ' + String(e).slice(0, 300)));
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.removeItem('gev-liquid-cards:v2');
    localStorage.removeItem('gev-liquid-cards:v2:last');
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    window.__rz = [];
    window.__vr = [];
    window.__errAt = null;
    const size = () => {
      const c = document.querySelector('.cesium-widget');
      const cv = document.querySelector('.cesium-widget canvas');
      return {
        cw: c ? c.clientWidth : -1, ch: c ? c.clientHeight : -1,
        cvw: cv ? cv.width : -1, cvh: cv ? cv.height : -1,
        vw: innerWidth, vh: innerHeight,
      };
    };
    window.addEventListener('resize', () => {
      window.__rz.push(Object.assign({ t: Math.round(performance.now()), kind: 'win-resize' }, size()));
    }, true);
    const iv = setInterval(() => {
      if (window.__gevViewer && !window.__vrWrapped) {
        window.__vrWrapped = true;
        const v = window.__gevViewer;
        const orig = v.resize.bind(v);
        v.resize = function () {
          window.__vr.push(Object.assign({ t: Math.round(performance.now()), kind: 'viewer.resize' }, size()));
          try { return orig(); } catch (e) { window.__vr.push({ err: String(e.message || e) }); throw e; }
        };
      }
      const ep = document.querySelector('.cesium-widget-errorPanel');
      if (ep && !window.__errAt) window.__errAt = Object.assign({ t: Math.round(performance.now()) }, size());
    }, 120);
  } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?diag=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 120000 });
await new Promise((r) => setTimeout(r, 16000));

const HEAD = [
  ['data-panel', '#data-panel .panel-title'],
  ['scene-panel', '#scene-panel .panel-title'],
  ['pp-toggles', '#pp-toggles .pp-header-label'],
  ['cctv-panel', '#cctv-panel .panel-title'],
  ['global-context-panel', '#global-context-panel .panel-title'],
  ['location-bar', '#location-bar-toggle'],
  ['control-panel', '#control-panel-toggle'],
];
const pt = (sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const b = e.getBoundingClientRect();
  return { x: Math.round(b.x + Math.min(40, b.width / 2)), y: Math.round(b.y + b.height / 2) };
}, sel);
const mark = async (label) => {
  const s = await page.evaluate(() => ({ err: !!document.querySelector('.cesium-widget-errorPanel'), url: location.search.slice(0, 20) }));
  console.log(label, JSON.stringify(s));
  return s.err;
};
await mark('after-load');
// 同组切换序列（u3 harness 里出错的位置）：先开 A，再点同组 B
const PT = Object.fromEntries(HEAD);
const PAIRS = [
  ['data-panel', 'scene-panel'],
  ['pp-toggles', 'cctv-panel'],
  ['pp-toggles', 'global-context-panel'],
  ['location-bar', 'control-panel'],
];
const clickCard = async (id) => {
  const p = await pt(PT[id]);
  if (!p) { console.log('no point', id); return false; }
  await page.mouse.click(p.x, p.y, { delay: 30 });
  await new Promise((r) => setTimeout(r, 1300));
  return await mark('click ' + id);
};
for (const [a, b] of PAIRS) {
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 700));
  if (await clickCard(a)) break;
  if (await clickCard(b)) break;
  if (await clickCard(b)) break; // 再点一次收回
}
// 快速连点（420ms × 7）
for (const [id] of HEAD) {
  const p = await pt(PT[id]);
  if (!p) continue;
  await page.mouse.click(p.x, p.y, { delay: 20 });
  await new Promise((r) => setTimeout(r, 420));
  if (await mark('rapid ' + id)) break;
}
const dump = await page.evaluate(() => ({ rz: window.__rz.slice(-12), vr: window.__vr.slice(-12), errAt: window.__errAt }));
console.log('RESIZE', JSON.stringify(dump.rz, null, 1));
console.log('VIEWERRESIZE', JSON.stringify(dump.vr, null, 1));
console.log('ERRAT', JSON.stringify(dump.errAt));
console.log('ERRS', JSON.stringify(errs.slice(0, 4)));
await browser.close();
