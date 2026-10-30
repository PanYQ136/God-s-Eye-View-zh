#!/usr/bin/env node
/* Phase7D2 · 长帧 GL 级归因（item4 修复前的取证仪器）
   在文档启动前包 WebGL2 的 texImage 系列、bufferData、compile/link、readPixels、finish、flush 与 rAF，
   把每个 rAF 帧的「rAF 回调耗时 + GL 各 op 累计耗时 + 调用次数」记录下来，配合 LoAF 族别，
   回答「>100ms 帧到底是哪一类 GL 操作吃的」。
   用法: node scripts/lc/_diag/p7d2-gl-attr.mjs [tag] [runs]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'p7d2';
const RUNS = Number(process.argv[3] || 2);
const OUT = '.gev-logs/lc/phase7d2';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:4174/?welcome=0';

const INSTRUMENT = () => {
  const G = (window.__gla = {
    t0: performance.now(),
    fid: 0,
    frames: [],
    loaf: [],
    longtask: [],
    ops: {},
    err: null,
  });
  const OPS = [
    'texImage2D', 'texImage3D', 'texSubImage2D', 'texSubImage3D', 'compressedTexImage2D',
    'bufferData', 'bufferSubData', 'linkProgram', 'compileShader', 'getProgramParameter',
    'getShaderParameter', 'readPixels', 'finish', 'flush', 'generateMipmap',
  ];
  const cur = () => G.frames[G.frames.length - 1] || null;
  const bump = (name, dt, extra) => {
    const o = (G.ops[name] ||= { n: 0, ms: 0, max: 0, maxAt: 0 });
    o.n += 1; o.ms += dt;
    if (dt > o.max) { o.max = dt; o.maxAt = +(performance.now() - G.t0).toFixed(1); }
    const f = cur();
    if (f) {
      const fo = (f.ops[name] ||= { n: 0, ms: 0 });
      fo.n += 1; fo.ms += dt;
      if (dt > (f.topMs || 0)) { f.topMs = +dt.toFixed(2); f.topOp = name; f.topOpExtra = extra || null; }
    }
  };
  const wrap = (proto, name, wantExtra) => {
    const orig = proto && proto[name];
    if (typeof orig !== 'function') return;
    proto[name] = function (...args) {
      const t = performance.now();
      try { return orig.apply(this, args); }
      finally {
        bump(name, performance.now() - t, wantExtra ? wantExtra(args) : null);
      }
    };
  };
  try {
    for (const P of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      if (!P) continue;
      for (const name of OPS) {
        if (name.startsWith('tex') || name.startsWith('compressedTex')) {
          wrap(P.prototype, name, (a) => {
            // (target, level, internalformat, width, height, ...) 或 (target, level, ifmt, w, h, border, format, type, src)
            const nums = a.filter((x) => typeof x === 'number');
            const src = a.find((x) => x && (ArrayBuffer.isView(x) || x instanceof ImageBitmap || x instanceof HTMLImageElement || x instanceof HTMLCanvasElement));
            let bytes = null;
            if (ArrayBuffer.isView(src)) bytes = src.byteLength;
            else if (src && src.width) bytes = src.width * src.height * 4;
            return { dims: nums.slice(3, 5).join('x'), bytes };
          });
        }
      }
    }
  } catch (e) { G.err = 'gl-patch:' + String(e.message || e); }

  const origRaf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    const id = ++G.fid;
    return origRaf((ts) => {
      const rec = { id, t: +(performance.now() - G.t0).toFixed(1), dur: 0, ops: {}, cbMs: 0 };
      G.frames.push(rec);
      if (G.frames.length > 4000) G.frames.shift();
      const s = performance.now();
      try { cb(ts); } finally {
        const e = performance.now();
        rec.cbMs = +(e - s).toFixed(2);
        rec.dur = +e.toFixed(2);
        /* 帧间隔在分析端算（相邻 rec.t 差） */
      }
    });
  };

  try {
    const po = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        G.loaf.push({
          start: +e.startTime.toFixed(1), dur: +e.duration.toFixed(1),
          blocking: +(e.blockingDuration || 0).toFixed(1),
          renderStart: +(e.renderStart || 0).toFixed(1),
          styleLayout: +(e.styleAndLayoutStart || 0).toFixed(1),
          scripts: (e.scripts || []).map((x) => ({ dur: +x.duration.toFixed(1), src: (x.sourceFunctionName || '') + '@' + (x.sourceURL || '').split('/').pop(), invoker: x.invoker || null })),
        });
      }
    });
    po.observe({ type: 'long-animation-frame' });
    G.po = po;
  } catch (e) { G.err = (G.err || '') + ' loaf:' + String(e.message || e); }
  try {
    const po2 = new PerformanceObserver((l) => {
      for (const e of l.getEntries()) G.longtask.push({ start: +e.startTime.toFixed(1), dur: +e.duration.toFixed(1), name: e.name, container: e.attribution?.[0]?.containerType || null });
    });
    po2.observe({ type: 'longtask' });
  } catch (_) {}
};

const rows = [];
for (let run = 1; run <= RUNS; run++) {
  const profile = mkdtempSync(join(tmpdir(), `gev-${TAG}-gl-`));
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: profile,
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
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 200)); });
  await page.evaluateOnNewDocument(INSTRUMENT);
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable').catch(() => {});
  await cdp.send('Network.clearBrowserCache').catch(() => {});
  const wall0 = Date.now();
  await page.goto(`${BASE}&gla=${run}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });

  /* 等遮罩视觉消失（与 gate 的 reveal 同口径） */
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
  /* reveal 前把窗口清零：只统计进入后 0–15s */
  await page.evaluate(() => {
    const G = window.__gla;
    G.tReveal = +(performance.now() - G.t0).toFixed(1);
    G.frames.length = 0;
    G.loaf.length = 0;
    G.longtask.length = 0;
    for (const k of Object.keys(G.ops)) G.ops[k] = { n: 0, ms: 0, max: 0, maxAt: 0 };
    G.tWin = performance.now();
  }).catch(() => {});

  const samples = [];
  for (let k = 0; k < 30; k++) {
    await sleep(500);
    const s = await page.evaluate(() => {
      const G = window.__gla;
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
      return {
        t: +((performance.now() - G.tWin) / 1000).toFixed(2),
        photo: !!(p && p.ready), globe: v ? v.scene.globe.show : null,
        sched: S ? [S.maximumRequestsPerServer, S.maximumRequests] : null,
        prim,
        canvas: v ? [v.canvas.width, v.canvas.height] : null,
        rs: v ? v.resolutionScale : null,
      };
    }).catch(() => null);
    if (s) samples.push(s);
    if (s && s.t > 15) break;
  }

  const dump = await page.evaluate(() => {
    const G = window.__gla;
    const f = G.frames;
    const frames = [];
    for (let i = 1; i < f.length; i++) {
      frames.push({ t: f[i].t, dt: +(f[i].t - f[i - 1].t).toFixed(1), cb: f[i].cbMs, ops: f[i].ops, top: f[i].topOp || null, topMs: f[i].topMs || 0, topExtra: f[i].topOpExtra || null });
    }
    const snap = (window.__gevBoot && window.__gevBoot.snapshot && window.__gevBoot.snapshot()) || null;
    return {
      frames,
      ops: G.ops,
      loaf: G.loaf.map((e) => ({ ...e, t: +(e.start - G.tWin).toFixed(1) })),
      longtask: G.longtask.map((e) => ({ ...e, t: +(e.start - G.tWin).toFixed(1) })),
      marks: snap ? snap.marks : null,
      tReveal: G.tReveal,
      err: G.err,
    };
  }).catch((e) => ({ error: String(e) }));

  const fr = dump.frames || [];
  const over = fr.filter((x) => x.dt > 100);
  const big = fr.filter((x) => x.dt > 60).slice(0, 40);
  console.log(`run${run} reveal=${revealWall}ms frames=${fr.length} over100=${over.length} worst=${Math.max(0, ...fr.map((x) => x.dt))}`);
  for (const x of over) console.log(`   t=${x.t} dt=${x.dt} cb=${x.cb} top=${x.top}@${x.topMs} ${JSON.stringify(x.topExtra)} ops=${JSON.stringify(x.ops)}`);
  rows.push({ run, revealWall, dump, big, errs: errs.slice(0, 6) });
  await browser.close();
}
writeFileSync(`${OUT}/${TAG}-gl-attr.json`, JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
console.log('WROTE ' + `${OUT}/${TAG}-gl-attr.json`);
