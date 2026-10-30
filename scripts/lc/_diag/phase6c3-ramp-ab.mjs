#!/usr/bin/env node
/* Phase6C3 A/B：3D Tiles 冷启动并发上限（maximumSimultaneousTileLoads）对 ramp 长帧的影响
   —— 只改运行时属性，不动源码，用于判定「并发灌入 → 单帧批量」是不是长帧根因。
   模式: base | ts3 | ts4 | ts6 | ts12
   用法: node scripts/lc/_diag/phase6c3-ramp-ab.mjs <mode> [tag]
   产物: .gev-logs/lc/phase6c3/ab-<tag>.json
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const MODE = process.argv[2] || 'base';
const TAG = process.argv[3] || MODE;
const RUN_MS = Number(process.env.AB_RUN_MS || 20000);
const LIMIT = MODE.startsWith('ts') ? Number(MODE.slice(2)) : null;
const RS = MODE.startsWith('rs') ? Number(MODE.slice(2)) : null;
const SKIP = MODE === 'skip';
const CAP = MODE.startsWith('cap') ? Number(MODE.slice(3)) : null;
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
await page.evaluateOnNewDocument((limit, rs, skip, capN) => {
  window.__rsCap = rs;
  window.__skipLod = !!skip;
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify(capN ? { pdb: true, maxReqPerServer: capN } : { pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
  const T0 = performance.now();
  window.__ab = { frames: [], stat: [], t0: T0, readyAt: null, applied: null, limit };
  let last = performance.now();
  const tick = (ts) => {
    const dt = ts - last; last = ts;
    window.__ab.frames.push([+(ts - T0).toFixed(1), +dt.toFixed(1)]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  /* 慢 GL 调用（判定长帧成因：shader link / 瓦片 JSON 解析 / 读回） */
  window.__ab.gl = [];
  const proto = WebGL2RenderingContext.prototype;
  const wrap = (name, th) => {
    const orig = proto[name];
    if (typeof orig !== 'function') return;
    proto[name] = function (...a) {
      window.__glCtx = this;
      const t0 = performance.now();
      try { return orig.apply(this, a); }
      finally {
        const dt = performance.now() - t0;
        if (dt >= th) {
          const rec = { t: +(performance.now() - T0).toFixed(1), call: name, dt: +dt.toFixed(1) };
          if (name === 'linkProgram' || name === 'getProgramParameter') {
            try {
              const sh = a[0];
              const list = sh && sh.constructor.name === 'WebGLProgram' ? window.__glCtx.getAttachedShaders(sh) : null;
              const src = list && list.length ? window.__glCtx.getShaderSource(list[0]) : '';
              rec.sig = String(src || '').split('\n').filter((l) => l.trim() && !l.startsWith('#') && l.indexOf('czm_') < 0).slice(0, 5).join(' / ').slice(0, 200);
            } catch (e) { rec.sig = 'ERR'; }
          }
          window.__ab.gl.push(rec);
        }
      }
    };
  };
  wrap('linkProgram', 15); wrap('getProgramParameter', 20); wrap('getBufferSubData', 8); wrap('texImage2D', 20);
  /* 尽早给 tileset 设并发上限 */
  const applyLimit = () => {
    const v = window.__gevViewer;
    if (!v || !v.scene) { setTimeout(applyLimit, 30); return; }
    if (limit == null && !skip) return;
    let done = 0;
    try {
      for (let i = 0; i < v.scene.primitives.length; i++) {
        const p = v.scene.primitives.get(i);
        if (p && p.constructor && /Cesium3DTileset/.test(p.constructor.name)) {
          if (limit != null) p.maximumSimultaneousTileLoads = limit;
          if (window.__skipLod) {
            p.skipLevelOfDetail = true;
            p.baseScreenSpaceError = 1024;
            p.skipScreenSpaceErrorFactor = 16;
            p.skipLevels = 1;
            p.immediatelyLoadDesiredLevelOfDetail = false;
          }
          done++;
        }
      }
    } catch (e) {}
    if (done) { window.__ab.applied = { t: +(performance.now() - T0).toFixed(1), n: done, limit }; }
    else setTimeout(applyLimit, 30);
  };
  applyLimit();
  /* rsN：通过 dev server 的同一份 cesium 模块实例改 RequestScheduler 上限 */
  const applyRS = async () => {
    if (!limit && !window.__rsCap) { setTimeout(applyRS, 50); return; }
    try {
      const hit = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/deps\/cesium\.js\?v=/.test(n));
      if (!hit) { setTimeout(applyRS, 50); return; }
      const m = await import(hit);
      m.RequestScheduler.maximumRequestsPerServer = window.__rsCap;
      m.RequestScheduler.maximumRequests = Math.max(m.RequestScheduler.maximumRequests, 12);
      window.__ab.rsApplied = { t: +(performance.now() - T0).toFixed(1), cap: window.__rsCap, url: hit.split('/').pop() };
    } catch (e) { window.__ab.rsErr = String(e && e.message || e); setTimeout(applyRS, 100); }
  };
  if (window.__rsCap) applyRS();
  const sample = () => {
    const v = window.__gevViewer;
    if (v && v.scene) {
      const tss = [];
      for (let i = 0; i < v.scene.primitives.length; i++) {
        const p = v.scene.primitives.get(i);
        if (p && p.constructor && /Cesium3DTileset/.test(p.constructor.name)) {
          const st = p.statistics || {};
          tss.push({
            msl: p.maximumSimultaneousTileLoads, mse: p.maximumScreenSpaceError,
            pending: st.numberOfPendingRequests, processing: st.numberOfTilesProcessing,
            selected: st.numberOfTilesSelected, visited: st.numberOfTilesVisited,
            loaded: st.numberOfTilesWithContentReady,
            tilesLoaded: p.tilesLoaded,
          });
        }
      }
      const prev = window.__ab.stat.at(-1);
      const cur = { t: +(performance.now() - T0).toFixed(0), res: +(v.resolutionScale || 0).toFixed(2), rrm: !!v.scene.requestRenderMode, ts: tss };
      if (!prev || JSON.stringify({ r: cur.res, rrm: cur.rrm, ts: cur.ts }) !== JSON.stringify({ r: prev.res, rrm: prev.rrm, ts: prev.ts })) window.__ab.stat.push(cur);
    }
    setTimeout(sample, 100);
  };
  sample();
}, LIMIT, RS, SKIP, CAP);

await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
    && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
const readyAt = await page.evaluate(() => { window.__ab.readyAt = +(performance.now() - window.__ab.t0).toFixed(1); return window.__ab.readyAt; });
await sleep(RUN_MS);   /* 默认 ready+20s：覆盖 ready+5..20s ramp 区段 */
const ab = await page.evaluate(() => ({ frames: window.__ab.frames, stat: window.__ab.stat, readyAt: window.__ab.readyAt, applied: window.__ab.applied, limit: window.__ab.limit, gl: window.__ab.gl }));
const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
const reqSched = await page.evaluate(() => window.__gevReqSched || null);
await browser.close();

const rel = (t) => +(t - ab.readyAt).toFixed(1);
const win = (a, b) => ab.frames.filter((f) => f[0] >= ab.readyAt + a && f[0] <= ab.readyAt + b);
const worst = (arr) => (arr.length ? Math.max(...arr.map((f) => f[1])) : 0);
const over = (arr, ms) => arr.filter((f) => f[1] > ms).length;
const winDefs = [[5000, 13000], [7000, 15000], [5000, 15000], [5000, 25000]];
const out = {
  mode: MODE, limit: LIMIT, cap: CAP, tag: TAG, readyAt, reqSched, gpu: gpu && gpu.renderer, applied: ab.applied,
  windows: winDefs.map(([a, b]) => { const w = win(a, b); return { win: `ready+${a / 1000}..${b / 1000}s`, n: w.length, worst: worst(w), over100: over(w, 100), over60: over(w, 60), over40: over(w, 40) }; }),
  big: win(3000, 25000).filter((f) => f[1] > 60).map(([t, dt]) => ({ rel: rel(t), dt, gl: (ab.gl || []).filter((g) => Math.abs(g.t - t) < 250) })),
  tilesLoadedAt: (ab.stat.find((s) => s.ts && s.ts[0] && s.ts[0].tilesLoaded) || {}).t || null,
  lastPending: (ab.stat.at(-1) || {}).ts,
  stat: ab.stat,
};
writeFileSync(`${OUT}/ab-${TAG}.json`, JSON.stringify({ out, raw: ab }, null, 1));
console.log('MODE', MODE, '| GPU', out.gpu, '| readyAt', readyAt, '| applied', JSON.stringify(ab.applied), '| reqSched', JSON.stringify(reqSched));
out.windows.forEach((w) => console.log('  ', w.win, 'n=' + w.n, 'worst=' + w.worst, '>100:' + w.over100, '>60:' + w.over60, '>40:' + w.over40));
console.log('  big(>60ms) rel:', JSON.stringify(out.big));
console.log('  OUT', `${OUT}/ab-${TAG}.json`);
