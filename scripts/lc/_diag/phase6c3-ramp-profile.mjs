#!/usr/bin/env node
/* Phase6C3 诊断 v2：把 ramp 窗里那一帧 >100ms 的 Cesium 渲染真正归因到函数级
   —— V8 CPU profiler（CDP Profiler，200µs 采样）+ 每 100ms 的 3D Tiles 统计。
   用法: node scripts/lc/_diag/phase6c3-ramp-profile.mjs [tag]
   产物: .gev-logs/lc/phase6c3/profile-<tag>.json（含 samples/nodes + tileset 统计时间线）
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] || 'p1';
const W = 1348, VH = 774;
const OUT = '.gev-logs/lc/phase6c3';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${VH + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: VH, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
  const T0 = performance.now();
  window.__tl = { frames: [], stat: [], t0: T0, readyAt: null, res: [] };
  let last = performance.now();
  const tick = (ts) => {
    const dt = ts - last; last = ts;
    window.__tl.frames.push([+(ts - T0).toFixed(1), +dt.toFixed(1)]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const sample = () => {
    const v = window.__gevViewer;
    if (v && v.scene) {
      const s = { t: +(performance.now() - T0).toFixed(1), res: +(v.resolutionScale || 0).toFixed(2), rrm: !!v.scene.requestRenderMode };
      const tss = [];
      try {
        for (let i = 0; i < v.scene.primitives.length; i++) {
          const p = v.scene.primitives.get(i);
          if (p && p.constructor && /Cesium3DTileset/.test(p.constructor.name)) {
            const st = p.statistics || {};
            tss.push({
              mse: p.maximumScreenSpaceError, tilesLoaded: p.tilesLoaded, rootReady: !!p.root,
              visited: st.numberOfTilesVisited, selected: st.numberOfTilesSelected,
              pending: st.numberOfPendingRequests, processing: st.numberOfTilesProcessing,
              downloading: st.numberOfTilesWithContentReady !== undefined ? st.numberOfTilesWithContentReady : null,
            });
          }
        }
      } catch (e) {}
      s.ts = tss;
      const prev = window.__tl.stat.at(-1);
      if (!prev || JSON.stringify({ r: s.res, rrm: s.rrm, ts: s.ts }) !== JSON.stringify({ r: prev.res, rrm: prev.rrm, ts: prev.ts })) window.__tl.stat.push(s);
    }
    setTimeout(sample, 100);
  };
  sample();
});

const cdp = await page.createCDPSession();
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
const tBoot = Date.now();
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
    && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
const readyAt = await page.evaluate(() => { window.__tl.readyAt = +(performance.now() - window.__tl.t0).toFixed(1); return window.__tl.readyAt; });
await sleep(30000);
const tl = await page.evaluate(() => ({ frames: window.__tl.frames, stat: window.__tl.stat, readyAt: window.__tl.readyAt }));
const { profile } = await cdp.send('Profiler.stop');
const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
await browser.close();
writeFileSync(`${OUT}/profile-${TAG}.json`, JSON.stringify({ readyAt, gpu, tl, profile }));
console.log('GPU', gpu && gpu.renderer);
console.log('readyAt', readyAt);
const rel = (t) => +(t - readyAt).toFixed(1);
const rampFrames = tl.frames.filter((f) => f[0] >= readyAt + 3000);
const big = rampFrames.filter((f) => f[1] > 60).map(([t, dt]) => ({ t, rel: rel(t), dt }));
console.log('post-ready frames', rampFrames.length, '| worst', Math.max(...rampFrames.map((f) => f[1])));
console.log('big frames >60ms (ready+3s 起):', JSON.stringify(big));
console.log('stat timeline:'); tl.stat.forEach((s) => console.log('  ', JSON.stringify(s)));
console.log('OUT', `${OUT}/profile-${TAG}.json`);
