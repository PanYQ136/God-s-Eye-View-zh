#!/usr/bin/env node
/* 交互期帧成本归因（不改 App 代码）：在页面里包住 GL / 2D 的「重活」调用，
   逐帧记录 CPU 侧耗时 + 帧间隔，回答三件事：
     1. 100ms+ 停顿时主线程到底停在哪个调用上（texSubImage2D / drawImage / drawArrays / render）；
     2. 每个画布（Cesium / #gev-edge-lens / #world-overlay-canvas / #world-overlay-detection-surface / #scope-mask）
        每帧被重绘几次、每次多久；
     3. 遮挡/隐藏 canvas 后同一窗口的变化（--hide=overlay|edge|ring）。
   用法: node scripts/lc/_diag/fps-gl-attrib.mjs [--drag-ms=30000] [--hide=overlay]
   输出: .gev-logs/lc/fps-gl-attrib/report.json
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argOf = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=')[1] : d;
};
const DRAG_MS = Number(argOf('drag-ms', 30000));
const HIDE = (argOf('hide', '') || '').split(',').filter(Boolean);
const TAG = argOf('tag', HIDE.join('-') || 'baseline');
const W = 1360;
const H = 782;
const OUT = '.gev-logs/lc/fps-gl-attrib';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion',
  ],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront();

await page.evaluateOnNewDocument(() => {
  const S = (window.__GLT = {
    on: true, buckets: Object.create(null), slow: [], rafs: [],
    frame: 0, perFrame: Object.create(null),
  });
  const tag = (ctx, fallback) => {
    try {
      const c = ctx && ctx.canvas;
      if (!c) return fallback;
      return (c.id || (c.className || '').split(' ')[0] || c.tagName || fallback).slice(0, 32);
    } catch (e) { return fallback; }
  };
  const hit = (name, canvas, dt, extra) => {
    const key = canvas + ' :: ' + name + (extra || '');
    const b = S.buckets[key] || (S.buckets[key] = { n: 0, ms: 0, max: 0, slow: 0 });
    b.n += 1; b.ms += dt; if (dt > b.max) b.max = dt;
    if (dt >= 2) { b.slow += 1; if (S.slow.length < 1200) S.slow.push({ ts: +(performance.now()).toFixed(1), key, dt: +dt.toFixed(2) }); }
  };
  const wrap = (proto, name, argsOf) => {
    const orig = proto && proto[name];
    if (typeof orig !== 'function') return;
    proto[name] = function (...a) {
      if (!S.on) return orig.apply(this, a);
      const t0 = performance.now();
      let r;
      try { return (r = orig.apply(this, a)); } finally {
        const dt = performance.now() - t0;
        hit(name, tag(this, 'gl?'), dt, argsOf ? argsOf(a) : '');
      }
    };
  };
  const texArgs = (a) => {
    /* texSubImage2D(target, level, xo, yo, fmt, type, src) —— 记录源对象与尺寸 */
    const src = a[6];
    if (!src) return '';
    const c = src.constructor && src.constructor.name || 'obj';
    const w = src.width | 0, h = src.height | 0;
    return ' <- ' + c + (w ? (' ' + w + 'x' + h) : '');
  };
  for (const proto of [window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, window.WebGLRenderingContext && WebGLRenderingContext.prototype]) {
    if (!proto) continue;
    wrap(proto, 'texSubImage2D', texArgs);
    wrap(proto, 'texImage2D', texArgs);
    wrap(proto, 'drawArrays');
    wrap(proto, 'drawElements');
    wrap(proto, 'readPixels');
    wrap(proto, 'clear');
    wrap(proto, 'bufferSubData');
    wrap(proto, 'bufferData');
  }
  if (window.CanvasRenderingContext2D) {
    wrap(CanvasRenderingContext2D.prototype, 'drawImage');
    wrap(CanvasRenderingContext2D.prototype, 'fillRect');
    wrap(CanvasRenderingContext2D.prototype, 'clearRect');
    wrap(CanvasRenderingContext2D.prototype, 'putImageData');
    wrap(CanvasRenderingContext2D.prototype, 'fill');
    wrap(CanvasRenderingContext2D.prototype, 'stroke');
    wrap(CanvasRenderingContext2D.prototype, 'getImageData');
  }
  S.loaf = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        S.loaf.push({
          start: +e.startTime.toFixed(1), dur: +e.duration.toFixed(1),
          renderStart: e.renderStart ? +e.renderStart.toFixed(1) : 0,
          styleLayout: +(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0).toFixed(1),
          scripts: (e.scripts || []).map((s2) => ({ dur: +s2.duration.toFixed(1), fn: s2.sourceFunctionName || s2.invoker, url: (s2.sourceURL || '').split('/').pop(), line: s2.sourceCharPosition })),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch (err) { S.loafError = String(err && err.message); }
  const tick = (t) => {
    if (!S.on) return;
    S.rafs.push(+t.toFixed(2));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break;
  await sleep(400);
}
await sleep(12000);

if (HIDE.length) {
  await page.evaluate((list) => {
    for (const k of list) {
      const sel = k === 'overlay'
        ? ['#world-overlay-canvas', '#world-overlay-detection-surface', '#scope-mask']
        : k === 'edge' ? ['#gev-edge-lens']
          : k === 'ring' ? ['.celestial-ring-canvas']
            : [k];
      for (const s of sel) for (const el of document.querySelectorAll(s)) el.style.display = 'none';
    }
  }, HIDE);
}

const cx = Math.round(W * 0.62);
const cy = Math.round(H * 0.42);

/* 预热 3s 真拖拽 */
await page.mouse.move(cx, cy);
await page.mouse.down();
{
  const t = Date.now();
  let i = 0;
  while (Date.now() - t < 3000) {
    await page.mouse.move(cx + Math.round(Math.sin(i / 12) * 60), cy + Math.round(Math.cos(i / 17) * 36));
    i += 1;
    await sleep(16);
  }
}
await page.mouse.up();
await sleep(1500);

/* 清空统计，开始正式采样 */
await page.evaluate(() => {
  const S = window.__GLT;
  S.buckets = Object.create(null); S.slow = []; S.rafs = []; S.loaf = []; S.on = true;
});

const t0 = Date.now();
let n = 0;
await page.mouse.move(cx, cy);
await page.mouse.down();
while (Date.now() - t0 < DRAG_MS) {
  await page.mouse.move(cx + Math.round(Math.sin(n / 12) * 60), cy + Math.round(Math.cos(n / 17) * 36));
  n += 1;
  await sleep(16);
}
await page.mouse.up();

const raw = await page.evaluate(() => {
  const S = window.__GLT;
  S.on = false;
  const e = window.__gevEdge && window.__gevEdge.stats ? window.__gevEdge.stats() : null;
  const v = window.__gevViewer;
  return {
    buckets: S.buckets, slow: S.slow, rafs: S.rafs, loaf: S.loaf, loafError: S.loafError || null,
    edge: e ? { drawFps: e.drawFps, drawP50: e.drawP50, drawP95: e.drawP95, frames: e.frames, tex: e.tex, scale: e.scale, canvas: e.canvas, err: e.err } : null,
    viewer: v ? { canvas: [v.canvas.width, v.canvas.height], resolutionScale: v.resolutionScale, targetFrameRate: v.targetFrameRate } : null,
    overlay: window.__gevWorldOverlay && window.__gevWorldOverlay.getDiagnostics ? window.__gevWorldOverlay.getDiagnostics() : null,
  };
});

const gaps = [];
for (let i = 1; i < raw.rafs.length; i++) gaps.push(+(raw.rafs[i] - raw.rafs[i - 1]).toFixed(1));
const sorted = gaps.slice().sort((a, b) => a - b);
const q = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
const span = raw.rafs.length > 1 ? raw.rafs[raw.rafs.length - 1] - raw.rafs[0] : 0;

const buckets = Object.entries(raw.buckets)
  .map(([k, b]) => ({ key: k, n: b.n, ms: +b.ms.toFixed(1), perSec: +(b.n / (span / 1000)).toFixed(1), avg: +(b.ms / b.n).toFixed(3), max: +b.max.toFixed(2), slow: b.slow }))
  .sort((a, b) => b.ms - a.ms);

const worst = gaps.map((g, i) => ({ g, i, at: raw.rafs[i] })).sort((a, b) => b.g - a.g).slice(0, 10);
const slow = raw.slow.slice().sort((a, b) => b.dt - a.dt).slice(0, 40);

const report = {
  at: new Date().toISOString(), tag: TAG, hide: HIDE, dragMs: DRAG_MS,
  frame: { n: gaps.length, fps: +((gaps.length / Math.max(1, span)) * 1000).toFixed(2), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted[sorted.length - 1] ?? null, over50: sorted.filter((x) => x > 50).length, over100: sorted.filter((x) => x > 100).length },
  env: raw.viewer, edge: raw.edge,
  buckets, worstFrames: worst, slowCalls: slow,
  loaf: raw.loaf.sort((a, b) => b.dur - a.dur).slice(0, 12), loafError: raw.loafError,
};
writeFileSync(`${OUT}/report-${TAG}.json`, JSON.stringify({ report, raw }, null, 2));
console.log(JSON.stringify({ tag: TAG, frame: report.frame, edge: report.edge, buckets: buckets.slice(0, 26), worstFrames: worst.slice(0, 6), loaf: report.loaf.slice(0, 6) }, null, 2));
await browser.close();
