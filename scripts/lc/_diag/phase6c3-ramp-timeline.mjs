#!/usr/bin/env node
/* Phase6C3 诊断：冷启动 ramp 长帧的时间线归因
   目的：把 gate 里「ramp 窗 worst 121–163ms」落到具体事件上，而不是只凭 LoAF 的
   invoker 名字猜。同时记录：
     · 每帧 rAF 间隔（document start 起，含 boot）
     · LoAF（buffered:true，含加载期）+ scripts 归因
     · resolutionScale / canvas.width / globe.maximumScreenSpaceError 每次变化 + 时刻
     · 瓦片请求（autonavi / api）到达节奏（PerformanceObserver 'resource'）
   模式：
     base      原样
     noresize  ready 后吞掉所有 resolutionScale 写入（不改画质，只冻结分辨率档位），
               用来判定「resize 抖动」是不是长帧来源
     noperf    启动前写 gev.perfMode='0'（关性能模式，仅诊断用）
   用法: node scripts/lc/_diag/phase6c3-ramp-timeline.mjs [mode] [tag]
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const MODE = process.argv[2] || 'base';
const TAG = process.argv[3] || MODE;
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

await page.evaluateOnNewDocument((mode) => {
  try {
    localStorage.clear();
    localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true }));
    if (mode === 'noperf') localStorage.setItem('gev.perfMode', '0');
  } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}

  const T0 = performance.now();
  window.__tl = { frames: [], loaf: [], res: [], tiles: [], mode, t0: T0, readyAt: null };

  /* 每帧间隔 */
  let last = performance.now();
  const tick = (ts) => {
    const dt = ts - last; last = ts;
    window.__tl.frames.push([+(ts - T0).toFixed(1), +dt.toFixed(1)]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  /* LoAF：buffered 把加载期条目也送来 */
  try {
    const ob = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__tl.loaf.push({
          start: +(e.startTime - T0).toFixed(1), dur: +e.duration.toFixed(1),
          blocking: +(e.blockingDuration || 0).toFixed(1), renderStart: +((e.renderStart || 0) - T0).toFixed(1),
          scripts: (e.scripts || []).slice(0, 6).map((s) => ({
            url: String(s.sourceURL || '').split('/').slice(-1)[0], invoker: s.invoker || '',
            dur: +(s.duration || 0).toFixed(1), forcedStyle: +(s.forcedStyleAndLayoutDuration || 0).toFixed(1),
          })),
        });
      }
    });
    ob.observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) {}

  /* 瓦片/资源到达节奏 */
  try {
    const ro = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const host = (() => { try { return new URL(e.name).host; } catch (x) { return ''; } })();
        if (!/autonavi|openstreetmap|arcgisonline|amap/i.test(host + e.name)) continue;
        window.__tl.tiles.push([+(e.startTime - T0).toFixed(1), +(e.responseEnd - T0).toFixed(1), Math.round(e.transferSize || 0), host]);
      }
    });
    ro.observe({ type: 'resource', buffered: true });
  } catch (e) {}

  /* 分辨率 / MSE / 画布尺寸变化采样（40ms） */
  let prev = null, frozen = null;
  window.__tl.freezeRes = false;
  const sample = () => {
    const v = window.__gevViewer;
    if (v && v.scene) {
      if (frozen === null && mode === 'noresize') {
        /* 包装实例属性：写入被记录但不生效（画质档位不降，只是不再改尺寸） */
        try {
          const proto = Object.getPrototypeOf(v);
          const d = Object.getOwnPropertyDescriptor(proto, 'resolutionScale');
          if (d && d.set) {
            Object.defineProperty(v, 'resolutionScale', {
              configurable: true,
              get() { return d.get.call(v); },
              set(x) {
                if (window.__tl.freezeRes) { window.__tl.res.push([+(performance.now() - T0).toFixed(1), 'swallowed', +x, v.canvas ? v.canvas.width : -1]); return; }
                d.set.call(v, x);
              },
            });
            frozen = true;
            if (mode === 'noresize') window.__tl.freezeRes = true;   /* 从第一次看到 viewer 起就冻结分辨率写入 */
          }
        } catch (e) {}
      }
      const cur = {
        res: +(v.resolutionScale || 0).toFixed(3),
        cw: v.canvas ? v.canvas.width : -1,
        ch: v.canvas ? v.canvas.height : -1,
        mse: v.scene.globe ? v.scene.globe.maximumScreenSpaceError : -1,
        globe: v.scene.globe ? v.scene.globe.show : null,
        tfr: v.targetFrameRate === undefined ? 'undef' : v.targetFrameRate,
        rrm: !!v.scene.requestRenderMode,
      };
      if (!prev || JSON.stringify(cur) !== JSON.stringify(prev)) {
        window.__tl.res.push([+(performance.now() - T0).toFixed(1), 'state', cur]);
        prev = cur;
      }
    }
    setTimeout(sample, 40);
  };
  sample();
}, MODE);

const tBoot = Date.now();
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
let readyOk = false;
for (let i = 0; i < 150; i++) {
  readyOk = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
    && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (readyOk) break;
  await sleep(400);
}
const readyAt = await page.evaluate(() => {
  const v = window.__gevViewer;
  window.__tl.readyAt = +(performance.now() - window.__tl.t0).toFixed(1);
  return window.__tl.readyAt;
});
if (MODE === 'noresize') {
  const r = await page.evaluate(() => { window.__tl.freezeRes = true; return window.__gevViewer ? window.__gevViewer.resolutionScale : null; });
  console.log('[noresize] frozen at res', r);
}
/* 采集 40s：覆盖 ready+7s 的 ramp 窗（ready+5s 起 8s 的旧口径也覆盖） */
await sleep(40000);
const tl = await page.evaluate(() => ({
  frames: window.__tl.frames, loaf: window.__tl.loaf, res: window.__tl.res,
  tiles: window.__tl.tiles, mode: window.__tl.mode, readyAt: window.__tl.readyAt,
}));
const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
await browser.close();

/* ── 汇总 ─────────────────────────────────────────────── */
const rel = (t) => +(t - tl.readyAt).toFixed(1);
const big = tl.frames.filter((f) => f[1] > 40).map(([t, dt]) => ({ t, relReady: rel(t), dt }));
const ramp = tl.frames.filter((f) => f[0] >= tl.readyAt + 5000 && f[0] <= tl.readyAt + 13000);
const ramp7 = tl.frames.filter((f) => f[0] >= tl.readyAt + 7000 && f[0] <= tl.readyAt + 15000);
const worst = (arr) => (arr.length ? Math.max(...arr.map((f) => f[1])) : 0);
const sum = {
  mode: MODE, readyAt: tl.readyAt, gpu: gpu && gpu.renderer,
  framesTotal: tl.frames.length,
  firstFrameAt: tl.frames.length ? tl.frames[0][0] : null,
  ramp5_13_worst: worst(ramp), ramp7_15_worst: worst(ramp7),
  bigFrames: big,
  resStates: tl.res,
  tiles: { n: tl.tiles.length, first: tl.tiles.slice(0, 3), lastAt: tl.tiles.length ? tl.tiles.at(-1)[1] : null },
  loaf: tl.loaf.filter((l) => l.dur > 50),
};
/* 长帧与事件的邻接关系 */
sum.bigFrames.forEach((b) => {
  const near = tl.res.filter((r) => Math.abs(r[0] - b.t) < 400).map((r) => r.slice(0, 3));
  const nearLoaf = tl.loaf.filter((l) => Math.abs(l.start - b.t) < 200).map((l) => ({ dur: l.dur, inv: l.scripts.map((s) => s.invoker + ':' + s.dur) }));
  const nearTiles = tl.tiles.filter((x) => Math.abs(x[1] - b.t) < 300).length;
  b.nearRes = near; b.nearLoaf = nearLoaf; b.nearTiles = nearTiles;
});
writeFileSync(`${OUT}/timeline-${TAG}.json`, JSON.stringify({ sum, raw: tl }, null, 1));
console.log('GPU', gpu && gpu.renderer);
console.log('readyAt', tl.readyAt, 'ms | frames', tl.frames.length, '| ramp5-13 worst', sum.ramp5_13_worst, '| ramp7-15 worst', sum.ramp7_15_worst);
console.log('res states:'); tl.res.forEach((r) => console.log('  ', JSON.stringify(r)));
console.log('big frames (>40ms):');
big.forEach((b) => console.log('  ', JSON.stringify({ t: b.t, relReady: b.relReady, dt: b.dt, nearRes: b.nearRes, nearTiles: b.nearTiles, nearLoaf: b.nearLoaf })));
console.log('loaf >50ms:', JSON.stringify(sum.loaf.map((l) => ({ s: l.start, rel: rel(l.start), d: l.dur, b: l.blocking, sc: l.scripts })).slice(0, 20), null, 1));
console.log('tiles:', tl.tiles.length, 'lastAt', tl.tiles.length ? tl.tiles.at(-1)[1] : null);
console.log('OUT', `${OUT}/timeline-${TAG}.json`);
