#!/usr/bin/env node
/* Phase7D2 · 长帧 CPU 采样归因：reveal 后 0–14s 开 V8 Profiler + rAF 帧计时 + GL 关键 op 计时。
   产出 .gev-logs/lc/phase7d2/<tag>-cpuprof.json：frames(>60ms 全量) + cpuProfile(原始) + marks
   用法: node scripts/lc/_diag/p7d2-cpuprof.mjs [tag] [runs]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'p7d2prof';
const RUNS = Number(process.argv[3] || 1);
const OUT = '.gev-logs/lc/phase7d2';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:4174/?welcome=0';

const INSTRUMENT = () => {
  const G = (window.__gp = { t0: performance.now(), frames: [], ops: {}, loaf: [] });
  const cur = () => G.frames[G.frames.length - 1] || null;
  const bump = (name, dt) => {
    const o = (G.ops[name] ||= { n: 0, ms: 0, max: 0 });
    o.n += 1; o.ms += dt; if (dt > o.max) o.max = dt;
    const f = cur();
    if (f) { const fo = (f.ops[name] ||= { n: 0, ms: 0 }); fo.n += 1; fo.ms += dt; if (dt > (f.topMs || 0)) { f.topMs = +dt.toFixed(2); f.top = name; } }
  };
  const wrap = (proto, name) => {
    const orig = proto && proto[name];
    if (typeof orig !== 'function') return;
    proto[name] = function (...a) {
      const t = performance.now();
      try { return orig.apply(this, a); } finally { bump(name, performance.now() - t); }
    };
  };
  const OPS = ['texImage2D', 'texSubImage2D', 'bufferData', 'bufferSubData', 'linkProgram', 'compileShader',
    'getProgramParameter', 'getShaderParameter', 'readPixels', 'finish', 'flush', 'generateMipmap', 'drawElements', 'drawArrays', 'drawElementsInstanced'];
  try {
    for (const P of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      if (!P) continue;
      for (const n of OPS) wrap(P.prototype, n);
    }
  } catch (e) { G.err = String(e.message || e); }
  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return origRaf((ts) => {
      const rec = { t: +(performance.now() - G.t0).toFixed(1), cb: 0, ops: {} };
      G.frames.push(rec);
      if (G.frames.length > 6000) G.frames.shift();
      const s = performance.now();
      try { cb(ts); } finally { rec.cb = +(performance.now() - s).toFixed(2); }
      rec.end = +(performance.now() - G.t0).toFixed(1);
    });
  };
  try {
    const po = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) G.loaf.push({ start: +e.startTime.toFixed(1), dur: +e.duration.toFixed(1), blocking: +(e.blockingDuration || 0).toFixed(1), renderStart: +(e.renderStart || 0).toFixed(1), scripts: (e.scripts || []).map((x) => ({ dur: +x.duration.toFixed(1), src: (x.sourceFunctionName || '') + '@' + (x.sourceURL || '').split('/').pop(), inv: x.invoker || null })) });
    });
    po.observe({ type: 'long-animation-frame' });
  } catch (_) {}
};

const rows = [];
for (let run = 1; run <= RUNS; run++) {
  const profileDir = mkdtempSync(join(tmpdir(), `gev-${TAG}-`));
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: profileDir,
    args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
      '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
      '--disable-features=CalculateNativeWinOcclusion'],
    protocolTimeout: 300000,
    defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.bringToFront().catch(() => {});
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.evaluateOnNewDocument(INSTRUMENT);
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable').catch(() => {});
  await cdp.send('Network.clearBrowserCache').catch(() => {});
  const wall0 = Date.now();
  await page.goto(`${BASE}&prof=${run}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });

  let revealWall = null;
  for (let k = 0; k < 3000; k++) {
    const v = await page.evaluate(() => {
      const g = window.__gevBoot;
      const el = document.getElementById('loading-screen');
      const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
      return !!(g && g.interactive) || (Number.isFinite(op) && op < 0.05);
    }).catch(() => false);
    if (v) { revealWall = Date.now() - wall0; break; }
    await sleep(20);
  }
  const anchor = await page.evaluate(() => {
    const G = window.__gp;
    G.frames.length = 0;
    G.loaf.length = 0;
    for (const k of Object.keys(G.ops)) G.ops[k] = { n: 0, ms: 0, max: 0 };
    G.tWin = performance.now();
    return G.tWin;
  });

  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 400 });
  await cdp.send('Profiler.start');
  /* 采样期同时按 1s 采样 tileset / photoreal 状态 */
  const samples = [];
  for (let k = 0; k < 15; k++) {
    await sleep(1000);
    const s = await page.evaluate(() => {
      const p = window.__gevPhotoreal || null;
      const v = window.__gevViewer || null;
      const C = window.Cesium || {};
      const S = C.RequestScheduler || null;
      let prim = null;
      try {
        const pr = v.scene.primitives;
        for (let i = 0; i < pr.length; i++) {
          const x = pr.get(i);
          if (x && typeof x.tilesLoaded === 'boolean') prim = { sel: Math.round(x.statistics.selected), vis: Math.round(x.statistics.visited), content: x.statistics.numberOfTilesWithContentReady ?? null, loaded: x.tilesLoaded };
        }
      } catch (_) {}
      return { t: +((performance.now() - window.__gp.tWin) / 1000).toFixed(2), photo: !!(p && p.ready), globe: v ? v.scene.globe.show : null, sched: S ? [S.maximumRequestsPerServer, S.maximumRequests] : null, prim, canvas: v ? [v.canvas.width, v.canvas.height] : null };
    }).catch(() => null);
    if (s) samples.push(s);
  }
  const { profile } = await cdp.send('Profiler.stop');
  await cdp.send('Profiler.disable').catch(() => {});
  const dump = await page.evaluate(() => {
    const G = window.__gp;
    const f = G.frames;
    const frames = [];
    for (let i = 1; i < f.length; i++) frames.push({ t: f[i].t, end: f[i].end, dt: +(f[i].t - f[i - 1].t).toFixed(1), cb: f[i].cb, ops: f[i].ops, top: f[i].top || null, topMs: f[i].topMs || 0 });
    const snap = (window.__gevBoot && window.__gevBoot.snapshot && window.__gevBoot.snapshot()) || null;
    return { frames, ops: G.ops, loaf: G.loaf.map((e) => ({ ...e, t: +(e.start - G.tWin).toFixed(1) })), marks: snap ? snap.marks : null };
  });
  const anchors = await page.evaluate(() => ({ tWin: window.__gp.tWin, now: performance.now() }));
  const over = dump.frames.filter((x) => x.dt > 80);
  console.log(`run${run} reveal=${revealWall}ms frames=${dump.frames.length} over80=${over.length} worst=${Math.max(0, ...dump.frames.map((x) => x.dt))}`);
  for (const x of over.slice(0, 20)) console.log(`   t=${x.t} dt=${x.dt} cb=${x.cb} top=${x.top}@${x.topMs} ops=${JSON.stringify(x.ops).slice(0, 160)}`);
  rows.push({ run, revealWall, anchors, samples, dump, profile, errs: errs.slice(0, 5) });
  await browser.close();
}
writeFileSync(`${OUT}/${TAG}-cpuprof.json`, JSON.stringify({ at: new Date().toISOString(), rows }));
console.log('WROTE ' + `${OUT}/${TAG}-cpuprof.json`);
