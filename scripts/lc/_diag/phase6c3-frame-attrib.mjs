#!/usr/bin/env node
/* Phase6C3 诊断 v6：同一跑里同时拿
     · V8 CPU profile（CDP Profiler，200µs）
     · 每帧间隔（page rAF）
     · WebGL link/getBufferSubData/texImage2D 慢调用
     · LoAF
   并在 page 侧打时间锚点，把 profile 采样时刻映射回 page 时间，
   从而对每个 >60ms 的帧输出「函数级 self time Top-N」。
   用法: node scripts/lc/_diag/phase6c3-frame-attrib.mjs [tag] [ms]
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] || 'a1';
const RUN_MS = Number(process.argv[3] || 25000);
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
  window.__fa = { frames: [], gl: [], loaf: [], t0: T0, readyAt: null, anchor: null };
  let last = performance.now();
  const tick = (ts) => {
    const dt = ts - last; last = ts;
    window.__fa.frames.push([+(ts - T0).toFixed(1), +dt.toFixed(1), +ts.toFixed(1)]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const proto = WebGL2RenderingContext.prototype;
  const wrap = (name, th, extra) => {
    const orig = proto[name];
    if (typeof orig !== 'function') return;
    proto[name] = function (...a) {
      const t0 = performance.now();
      try { return orig.apply(this, a); }
      finally {
        const dt = performance.now() - t0;
        if (dt >= th) window.__fa.gl.push({ t: +(performance.now() - T0).toFixed(1), call: name, dt: +dt.toFixed(1), x: extra ? extra(a) : '' });
      }
    };
  };
  wrap('linkProgram', 15, null);
  wrap('getProgramParameter', 20, null);
  wrap('getBufferSubData', 8, (a) => 'len=' + (a[2] && a[2].byteLength));
  wrap('texImage2D', 20, (a) => `w=${a[3]} h=${a[4]}`);
  wrap('readPixels', 8, null);
  try {
    const ob = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__fa.loaf.push({
          start: +(e.startTime - T0).toFixed(1), dur: +e.duration.toFixed(1),
          scripts: (e.scripts || []).slice(0, 8).map((s) => ({ inv: s.invoker || '', d: +(s.duration || 0).toFixed(1), u: String(s.sourceURL || '').split('/').slice(-1)[0] })),
        });
      }
    });
    ob.observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) {}
});

const cdp = await page.createCDPSession();
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
    && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
const readyAt = await page.evaluate(() => { window.__fa.readyAt = +(performance.now() - window.__fa.t0).toFixed(1); window.__fa.readyAtRaw = performance.now(); return window.__fa.readyAt; });
/* 时间锚点：page 侧 performance.now() 与 profiler 时钟对齐 */
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
const anchorPage = await page.evaluate(() => { const n = performance.now(); window.__fa.anchor = n; return n; });
const anchorWall = Date.now();
await cdp.send('Profiler.start');
await sleep(RUN_MS);
const { profile } = await cdp.send('Profiler.stop');
const endPage = await page.evaluate(() => performance.now());
const fa = await page.evaluate(() => ({ frames: window.__fa.frames, gl: window.__fa.gl, loaf: window.__fa.loaf, readyAt: window.__fa.readyAt, readyAtRaw: window.__fa.readyAtRaw, t0: window.__fa.t0, anchor: window.__fa.anchor }));
const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
await browser.close();

/* profile 采样时间 → page performance.now()：anchorPage ≈ anchorTicks */
const pStart = profile.startTime;      // µs (ticks)
const toPage = (ticksUs) => anchorPage + (ticksUs - pStart) / 1000;
const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
const times = [];
let acc = 0;
for (const d of profile.timeDeltas) { acc += d; times.push(pStart + acc); }
const samples = profile.samples.map((id, i) => ({ id, ticks: times[i] }));
const nameOf = (n) => `${(n.callFrame.functionName || '(anon)')} @ ${String(n.callFrame.url || '').split('/').slice(-1)[0]}:${n.callFrame.lineNumber}`;

const anchorErr = (toPage(pStart) - anchorPage);
const postFrames = fa.frames.filter((f) => f[0] - fa.t0 >= anchorPage - fa.t0);
/* 对 anchor 之后每个 >60ms 的帧做函数级归因 */
const attribs = [];
for (const [t, dt, raw] of fa.frames) {
  const pageT = raw;               // 原始 rAF 时间戳 = performance.now() 时钟
  if (t < fa.readyAt) continue;
  if (dt < 60) continue;
  const t0p = pageT - dt, t1p = pageT;
  const inWin = samples.filter((s) => { const pg = toPage(s.ticks); return pg >= t0p - 1 && pg <= t1p + 1; });
  const agg = new Map();
  for (const s of inWin) {
    const n = nodes.get(s.id);
    if (!n) continue;
    const k = nameOf(n);
    agg.set(k, (agg.get(k) || 0) + 1);
  }
  const top = [...agg.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, c]) => `${(c * 0.2).toFixed(0)}ms ${k}`);
  attribs.push({ rel: +(pageT - fa.readyAt).toFixed(0), dt, samples: inWin.length, top,
    glNear: fa.gl.filter((g) => Math.abs(g.t - pageT) < 300),
    loafNear: fa.loaf.filter((l) => Math.abs(l.start + l.dur - pageT) < 400 || Math.abs(l.start - t0p) < 400).slice(0, 2) });
}
writeFileSync(`${OUT}/attrib-${TAG}.json`, JSON.stringify({ gpu, readyAt: fa.readyAt, anchorPage, anchorErr, attribs, gl: fa.gl, loaf: fa.loaf, frames: fa.frames }, null, 1));
console.log('GPU', gpu && gpu.renderer, '| readyAt', fa.readyAt, '| anchorErr(ms)', anchorErr.toFixed(1));
console.log('frames >60ms after ready:');
attribs.forEach((a) => {
  console.log(`  rel=+${a.rel}ms dt=${a.dt}ms samples=${a.samples}`);
  a.top.forEach((t) => console.log('      ', t));
  if (a.glNear.length) console.log('       GL:', JSON.stringify(a.glNear));
  if (a.loafNear.length) console.log('       LoAF:', JSON.stringify(a.loafNear[0].scripts));
});
console.log('OUT', `${OUT}/attrib-${TAG}.json`);
