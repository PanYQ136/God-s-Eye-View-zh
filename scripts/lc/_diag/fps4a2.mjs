#!/usr/bin/env node
/* Phase4A 归因 v2：刷新率 / Cesium 帧率 / 折射 pass 帧率 三者分离 + 每帧耗时分解
   跑法: node scripts/lc/_diag/fps4a2.mjs */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = process.env.LC_URL || 'http://127.0.0.1:4173/';
const W = 1536, H = 730;
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

/* 刷新率：同浏览器空标签页量 rAF */
const blank = await browser.newPage();
await blank.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await blank.goto('about:blank');
const hz = await blank.evaluate(() => new Promise((res) => {
  const ts = []; const t = (x) => { ts.push(x); if (ts.length < 90) requestAnimationFrame(t); else {
    const g = []; for (let i = 1; i < ts.length; i++) g.push(ts[i] - ts[i - 1]);
    const s = g.slice().sort((a, b) => a - b);
    res({ p50: +s[Math.floor(s.length / 2)].toFixed(2), hz: +(1000 / s[Math.floor(s.length / 2)]).toFixed(1), screen: [screen.width, screen.height, screen.availWidth, devicePixelRatio] });
  } }; requestAnimationFrame(t);
}));
await blank.close();
console.log('REFRESH ' + JSON.stringify(hz));

await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  const ready = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ready) break;
  await sleep(400);
}
await sleep(12000);

const info = await page.evaluate(() => {
  const v = window.__gevViewer || {};
  let edgeGrab = null; try { edgeGrab = window.__gevEdge.stats(); } catch (e) {}
  return {
    targetFrameRate: v.targetFrameRate, useDefaultRenderLoop: v.useDefaultRenderLoop,
    requestRenderMode: v.scene && v.scene.requestRenderMode,
    maximumRenderTimeChange: v.scene && v.scene.maximumRenderTimeChange,
    resolutionScale: v.resolutionScale, cesiumCanvas: [v.canvas && v.canvas.width, v.canvas && v.canvas.height],
    dpr: devicePixelRatio, gfx: localStorage.getItem('gev.gfx'), perfMode: localStorage.getItem('gev.perfMode'),
    layers: (() => { try { return Array.from(document.querySelectorAll('[data-layer-id][aria-pressed="true"]')).map((e) => e.getAttribute('data-layer-id')); } catch (e) { return null; } })(),
    edgeCanvas: edgeGrab && edgeGrab.canvas, edgeCount: edgeGrab && edgeGrab.count, edgeFps: edgeGrab && edgeGrab.fps,
    statsPost: null,
  };
});
console.log('INFO ' + JSON.stringify(info));

async function run(tag, ms = 4000) {
  const r = await page.evaluate(async (ms) => {
    const v = window.__gevViewer;
    let post0 = 0; try { post0 = window.__gevEdge.stats().frames; } catch (e) {}
    let cpost = 0;
    const off = () => {};
    /* Cesium postRender 计数 */
    let n = 0;
    const h = () => { n++; };
    v.scene.postRender.addEventListener(h);
    const ts = [];
    await new Promise((res) => { const t0 = performance.now(); const f = (x) => { ts.push(x); if (x - t0 < ms) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    v.scene.postRender.removeEventListener(h);
    const g = []; for (let i = 1; i < ts.length; i++) g.push(+(ts[i] - ts[i - 1]).toFixed(2));
    const s = g.slice().sort((a, b) => a - b);
    const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
    const avg = g.length ? g.reduce((a, b) => a + b, 0) / g.length : 0;
    let st = null; try { st = window.__gevEdge.stats(); } catch (e) {}
    return {
      frames: g.length, avgFps: avg ? +(1000 / avg).toFixed(1) : 0, p50: q(0.5), p95: q(0.95), max: s.length ? s[s.length - 1] : 0,
      cesiumPost: n, cesiumFps: +(n / (ms / 1000)).toFixed(1),
      edgeDraws: st ? st.frames - post0 : null, edgeFps: st && st.fps, edgeP50: st && st.p50,
    };
  }, ms);
  console.log(tag.padEnd(14) + JSON.stringify(r));
  return r;
}

const rows = [];
rows.push(await run('steady#1'));
rows.push(await run('steady#2'));
await page.evaluate(() => window.__gevEdge.off());
await sleep(600);
rows.push(await run('lens-off'));
rows.push(await run('lens-off#2'));
await page.evaluate(() => window.__gevEdge.on());
await sleep(600);
rows.push(await run('lens-on'));
await page.evaluate(() => { window.__gevEdge.off(); window.__gevViewer.useDefaultRenderLoop = false; });
await sleep(600);
rows.push(await run('cesium-stopped'));
await page.evaluate(() => { window.__gevViewer.useDefaultRenderLoop = true; window.__gevEdge.on(); });
writeFileSync('.gev-logs/lc/fps4a2.json', JSON.stringify({ hz, info, rows }, null, 2));
await browser.close();
