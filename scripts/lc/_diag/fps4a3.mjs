#!/usr/bin/env node
/* Phase4A 关键对照：Cesium 连续渲染（requestRenderMode=false, targetFrameRate=60）下
   折射 pass 打开 / 关闭的端到端帧率 —— 这才是「开折射的代价」的真实口径。
   跑法: node scripts/lc/_diag/fps4a3.mjs [stripsOn|stripsOff] */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = process.env.LC_URL || 'http://127.0.0.1:4173/';
const W = 1536, H = 730;
const MODE = process.argv[2] || 'stripsOn';
mkdirSync('.gev-logs/lc', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  const ready = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ready) break;
  await sleep(400);
}
await sleep(12000);

/* 强制连续渲染（等价于用户一直拖地图/飞机在动） */
await page.evaluate(() => {
  const v = window.__gevViewer;
  v.scene.requestRenderMode = false;
  v.targetFrameRate = 60;
  if (typeof v.resize === 'function') v.resize();
  window.__gevEdge.set({ strips: true });
});
await sleep(2500);

const info = await page.evaluate(() => ({
  renderer: window.__gevEdge.stats().renderer,
  targetFrameRate: window.__gevViewer.targetFrameRate,
  requestRenderMode: window.__gevViewer.scene.requestRenderMode,
  resolutionScale: window.__gevViewer.resolutionScale,
  cesium: [window.__gevViewer.canvas.width, window.__gevViewer.canvas.height],
  lens: window.__gevEdge.stats().canvas,
  count: window.__gevEdge.stats().count,
}));
console.log('INFO ' + JSON.stringify(info) + ' MODE=' + MODE);

async function sample(tag, ms = 8000) {
  const r = await page.evaluate(async (ms) => {
    const e0 = window.__gevEdge.stats();
    let post = 0; const h = () => { post++; };
    window.__gevViewer.scene.postRender.addEventListener(h);
    const ts = [];
    const t0 = performance.now();
    await new Promise((res) => { const f = (x) => { ts.push(x); if (x - t0 < ms) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    window.__gevViewer.scene.postRender.removeEventListener(h);
    const g = []; for (let i = 1; i < ts.length; i++) g.push(+(ts[i] - ts[i - 1]).toFixed(2));
    const s = g.slice().sort((a, b) => a - b);
    const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
    const avg = g.length ? g.reduce((a, b) => a + b, 0) / g.length : 0;
    const e1 = window.__gevEdge.stats();
    const long = g.filter((x) => x > 20).length;
    return {
      ms, frames: g.length, avgFps: avg ? +(1000 / avg).toFixed(1) : 0, p50: q(0.5), p95: q(0.95), max: s[s.length - 1], over20ms: long,
      cesiumPost: post, cesiumFps: +(post / (ms / 1000)).toFixed(1),
      edgeDraws: e1.frames - e0.frames, edgeFps: e1.fps, edgeDrawFps: e1.drawFps, edgeDrawP95: e1.drawP95,
      tex: e1.tex, count: e1.count, err: e1.err,
    };
  }, ms);
  console.log(tag.padEnd(16) + JSON.stringify(r));
  return { tag, ...r };
}

const rows = [];
rows.push(await sample('cont-lens-on'));
rows.push(await sample('cont-lens-on#2'));
await page.evaluate(() => window.__gevEdge.off());
await sleep(500);
rows.push(await sample('cont-lens-off'));
rows.push(await sample('cont-lens-off#2'));
await page.evaluate(() => window.__gevEdge.on());
await sleep(500);
rows.push(await sample('cont-lens-on#3'));

/* 拖地图（真实相机运动）：折射必须跟着，且不能掉帧 */
rows.push(await (async () => {
  await page.mouse.move(W / 2, H / 2);
  await page.mouse.down();
  const p = (async () => { for (let i = 0; i < 40; i++) { await page.mouse.move(W / 2 + Math.sin(i / 4) * 320, H / 2 + Math.cos(i / 5) * 160); await sleep(20); } })();
  const r = await sample('drag-camera', 1500);
  await p;
  await page.mouse.up();
  return r;
})());

writeFileSync('.gev-logs/lc/fps4a3-' + MODE + '.json', JSON.stringify({ info, rows, errs }, null, 2));
console.log('ERRS ' + JSON.stringify(errs.slice(0, 6)));
await browser.close();
