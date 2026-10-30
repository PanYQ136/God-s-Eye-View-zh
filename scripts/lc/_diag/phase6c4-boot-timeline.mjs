#!/usr/bin/env node
/* Phase6C4 · 冷启动阶段拆解仪器（只测量，不改产品代码）
   每个冷启动（新 profile = HTTP 缓存冷）记录：
     · 墙钟：navigationStart → 首个 rAF 帧 → tileset:added → cine:go → cine:done
             → tiles:loaded/view:content → view:settled → decide → mask:gone
     · __gevBoot.snapshot().marks（boot-gate 自己的相对时间轴）
     · navigation timing / 关键 resource（tileset json、bundle）
     · 期间所有 >50ms 主线程长任务（LoAF）+ 对应时刻
   用法：node scripts/lc/_diag/phase6c4-boot-timeline.mjs [runs] [tag]
   产物：.gev-logs/lc/phase6c4/boot-<tag>.json
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const RUNS = Number(process.argv[2] || 1);
const TAG = process.argv[3] || 'a';
const OUT = '.gev-logs/lc/phase6c4';
const URL = process.env.C4_URL || 'http://127.0.0.1:4173/?welcome=0&t=';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1348, VH = 774;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARGS = ['--no-sandbox', `--window-size=${W + 24},${VH + 160}`, '--window-position=40,20', '--hide-scrollbars',
  '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
  '--disable-features=CalculateNativeWinOcclusion'];

const NAV_MARK = () => {
  /* 在文档启动前注入：记录 navigationStart 与之相对的墙钟锚点 */
  window.__c4 = { t0: performance.timeOrigin, loaf: [], gaps: [], res: [] };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.duration < 50) continue;
        window.__c4.loaf.push({
          start: +e.startTime.toFixed(1), dur: +e.duration.toFixed(1),
          blocking: +(e.blockingDuration || 0).toFixed(1),
          scripts: (e.scripts || []).slice(0, 6).map((s) => ({
            url: String(s.sourceURL || '').split('/').slice(-1)[0], fn: s.sourceFunctionName || '',
            inv: s.invoker || '', dur: +(s.duration || 0).toFixed(1),
          })),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) { window.__c4.loafErr = String(e && e.message || e); }
  /* 首帧 + 每 50ms 采样遮罩不透明度，得到遮罩淡出曲线 */
  const maskSamples = (window.__c4.mask ||= []);
  const t0 = performance.now();
  const tick = () => {
    const el = document.getElementById('loading-screen');
    const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
    maskSamples.push([+performance.now().toFixed(0), Number.isFinite(op) ? +op.toFixed(2) : -1]);
    if (performance.now() - t0 < 30000 && !(el && el.classList.contains('hidden') && op < 0.02)) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

const CINE_LOG = () => {
  window.__c4cine = [];
  window.addEventListener('gev:cine-done', () => {
    const c = window.__gevCine || {};
    window.__c4cine.push({ at: +performance.now().toFixed(0), stage: c.stage, geo: c.geo, frames: c.frames });
  });
};

const NOW = () => {
  const b = window.__gevBoot && window.__gevBoot.snapshot ? window.__gevBoot.snapshot() : null;
  const nav = performance.getEntriesByType('navigation')[0] || {};
  const v = window.__gevViewer;
  let ts = null;
  try {
    const prims = v.scene.primitives;
    for (let i = 0; i < prims.length; i++) {
      const p = prims.get(i);
      if (p && p.initialTilesLoaded && typeof p.tilesLoaded === 'boolean') { ts = p; break; }
    }
  } catch (e) {}
  return {
    navStartToMark: {
      domInteractive: +(nav.domInteractive || 0).toFixed(0),
      domContentLoaded: +(nav.domContentLoadedEventEnd || 0).toFixed(0),
      loadEvent: +(nav.loadEventEnd || 0).toFixed(0),
      responseEnd: +(nav.responseEnd || 0).toFixed(0),
    },
    boot: b && {
      state: b.state, reason: b.reason, startedAt: b.startedAt, tilesetAt: b.tilesetAt,
      cineMayStartAt: b.cineMayStartAt, cineDoneAt: b.cineDoneAt, firstContentAt: b.firstContentAt,
      viewContentAt: b.viewContentAt, tilesLoadedAt: b.tilesLoadedAt, settledAt: b.settledAt,
      decideAt: b.decideAt, interactiveAt: b.interactiveAt, maskOpacity: b.maskOpacity,
      marks: b.marks, probeAtReveal: b.probeAtReveal,
      longOver100: (b.longFrames || []).filter((f) => f.dt > 100).length,
      visibleOver100: (b.longFrames || []).filter((f) => f.dt > 100 && f.maskOp < 0.95).length,
    },
    tileset: ts ? { tilesLoaded: !!ts.tilesLoaded, contentReady: ts.statistics && ts.statistics.numberOfTilesWithContentReady, pending: ts.statistics && ts.statistics.numberOfPendingRequests } : null,
    cine: { stage: window.__gevCine && window.__gevCine.stage, geo: window.__gevCine && window.__gevCine.geo, log: (window.__c4cine || []) },
    mask: (window.__c4.mask || []).slice(-80),
    loaf: (window.__c4.loaf || []).slice(0, 40),
    resStats: (() => {
      const rs = performance.getEntriesByType('resource');
      const js = rs.filter((r) => r.initiatorType === 'script' || /\.js(\?|$)/.test(r.name));
      const byType = {};
      for (const r of rs) byType[r.initiatorType] = (byType[r.initiatorType] || 0) + 1;
      const dur = js.map((r) => r.responseEnd - r.startTime).sort((a, b) => b - a);
      const kb = (a) => Math.round(a.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024);
      return {
        count: rs.length, byType, jsCount: js.length, jsKB: kb(js), allKB: kb(rs),
        jsFirstStart: js.length ? +Math.min(...js.map((r) => r.startTime)).toFixed(0) : null,
        jsLastEnd: js.length ? +Math.max(...js.map((r) => r.responseEnd)).toFixed(0) : null,
        slowestJs: js.map((r) => ({ n: r.name.split('/').slice(-2).join('/').slice(0, 50), st: +r.startTime.toFixed(0), en: +(r.responseEnd || 0).toFixed(0), kb: Math.round((r.transferSize || 0) / 1024), dur: +(r.responseEnd - r.startTime).toFixed(0) })).sort((a, b) => b.dur - a.dur).slice(0, 12),
        topDurSum: +dur.slice(0, 10).reduce((a, b) => a + b, 0).toFixed(0),
      };
    })(),
    tilesetReqs: performance.getEntriesByType('resource')
      .filter((r) => /tileset|google3d|root\.json|\/tiles\//.test(r.name))
      .map((r) => ({ n: r.name.split('/').slice(-2).join('/').slice(0, 60), start: +r.startTime.toFixed(0), end: +(r.responseEnd || 0).toFixed(0), kb: Math.round((r.transferSize || 0) / 1024) }))
      .sort((a, b) => a.start - b.start).slice(0, 20),
  };
};

const runs = [];
for (let run = 1; run <= RUNS; run++) {
  const browser = await puppeteer.launch({
    headless: false, executablePath: CHROME, args: ARGS, protocolTimeout: 900000,
    defaultViewport: { width: W, height: VH, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.bringToFront().catch(() => {});
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
  await page.evaluateOnNewDocument(NAV_MARK);
  await page.evaluateOnNewDocument(CINE_LOG);
  await page.evaluateOnNewDocument(() => {
    try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
    try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
  });
  const rec = { run };
  const wall0 = Date.now();
  try {
    await page.goto(URL + Date.now(), { waitUntil: 'load' });
    let revealWall = null;
    for (let i = 0; i < 3000; i++) {
      const st = await page.evaluate(() => {
        const b = window.__gevBoot && window.__gevBoot.snapshot ? window.__gevBoot.snapshot() : null;
        const el = document.getElementById('loading-screen');
        const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
        return { ia: b ? b.interactiveAt : null, op: Number.isFinite(op) ? op : 0 };
      }).catch(() => null);
      if (st && st.ia != null && st.op < 0.05) { revealWall = Date.now(); break; }
      await sleep(20);
    }
    rec.wallRevealMs = revealWall ? revealWall - wall0 : null;
    const snap = await page.evaluate(NOW);
    rec.snap = snap;
    const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
    rec.gpu = gpu && { renderer: gpu.renderer, software: gpu.software, tier: gpu.tier };
    rec.errs = errs;
  } catch (e) {
    rec.error = String(e && e.message || e);
  }
  runs.push(rec);
  console.log(`run${run} wallReveal=${rec.wallRevealMs} interactiveAt=${rec.snap && rec.snap.boot && rec.snap.boot.interactiveAt} reason=${rec.snap && rec.snap.boot && rec.snap.boot.reason} errs=${(rec.errs || []).length}`);
  if (rec.snap && rec.snap.boot) {
    console.log('  marks ' + rec.snap.boot.marks.map((m) => `${m.name}@${m.t}`).join(' '));
    console.log('  nav ' + JSON.stringify(rec.snap.navStartToMark));
  }
  await browser.close();
}
writeFileSync(`${OUT}/boot-${TAG}.json`, JSON.stringify({ tag: TAG, runs }, null, 1));
console.log('wrote ' + `${OUT}/boot-${TAG}.json`);
