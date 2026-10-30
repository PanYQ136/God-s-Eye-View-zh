#!/usr/bin/env node
/* Phase7C · 只读探针 B：进入后 0–14s 长帧归因（item 4）
   冷启动（全新 profile）→ 遮罩消失后立刻录 rAF 帧 + LoAF（long-animation-frame）14s，
   把 >100ms 帧按 C6 已确立的族别分类，并读 photoreal/tiles 状态与 mask:gone 时刻对齐。
   用法: node scripts/lc/_diag/p7c-fps-attr.mjs [tag] [runs]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'p7c';
const RUNS = Number(process.argv[3] || 2);
const OUT = '.gev-logs/lc/phase7c';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'http://127.0.0.1:4174/?welcome=0';
const rows = [];

for (let run = 1; run <= RUNS; run++) {
  const profile = mkdtempSync(join(tmpdir(), `gev-${TAG}-fa-`));
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
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable').catch(() => {});
  await cdp.send('Network.clearBrowserCache').catch(() => {});
  const wall0 = Date.now();
  await page.goto(`${BASE}&fa=${run}&t=${Date.now()}`, { waitUntil: 'load' });

  /* 遮罩消失即开始采样 */
  for (let i = 0; i < 1500; i++) {
    const st = await page.evaluate(() => {
      const g = window.__gevBoot;
      return !!(g && g.interactive) || (window.__gevBoot && window.__gevBoot.snapshot && window.__gevBoot.snapshot().interactiveAt != null);
    }).catch(() => false);
    if (st) break;
    await sleep(25);
  }
  const revealWall = Date.now() - wall0;
  await page.evaluate(() => {
    const loaf = [];
    try {
      const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) loaf.push({ start: +e.startTime.toFixed(1), dur: +e.duration.toFixed(1), blocking: +(e.blockingDuration || 0).toFixed(1), renderStart: +(e.renderStart || 0).toFixed(1), styleLayout: +(e.styleAndLayoutStart || 0).toFixed(1), scripts: (e.scripts || []).map((s) => ({ dur: +s.duration.toFixed(1), src: (s.sourceFunctionName || '') + '@' + (s.sourceURL || '').split('/').pop() })) }); });
      po.observe({ type: 'long-animation-frame' });
      window.__faPo = po;
    } catch (e) { window.__faErr = String(e.message || e); }
    window.__fa = { frames: [], loaf, t0: performance.now(), done: false };
    const tick = () => {
      const now = performance.now();
      window.__fa.frames.push(+now.toFixed(1));
      if (now - window.__fa.t0 < 14000) requestAnimationFrame(tick); else window.__fa.done = true;
    };
    requestAnimationFrame(tick);
  });
  /* 每 1s 采一次 photoreal / tiles 状态，看长帧和 photoreal 升级是否同时发生 */
  const marks = [];
  for (let k = 0; k < 28; k++) {
    await sleep(500);
    const st = await page.evaluate(() => {
      const p = window.__gevPhotoreal || null;
      const v = window.__gevViewer;
      let tiles = null;
      try {
        const prims = v.scene.primitives;
        tiles = [];
        for (let i = 0; i < prims.length; i++) {
          const pr = prims.get(i);
          if (pr && typeof pr.tilesLoaded === 'boolean') tiles.push({ ready: pr.readyPromise ? true : false, loaded: pr.tilesLoaded, content: pr.numberOfTilesWithContentReady ?? null, total: pr.tilesLoadedTotal ?? null, sel: pr.statistics ? Math.round(pr.statistics.selected) : null, vis: pr.statistics ? Math.round(pr.statistics.visited) : null });
        }
      } catch (e) {}
      const snaps = window.__gevBoot && window.__gevBoot.snapshot ? window.__gevBoot.snapshot().marks : null;
      return { t: +performance.now().toFixed(0), photoReady: !!(p && p.ready), globeShow: v ? v.scene.globe.show : null, tiles, masks: snaps ? snaps.map((m) => m.name + '@' + m.t) : null };
    }).catch(() => null);
    marks.push(st);
    const done = await page.evaluate(() => !!(window.__fa && window.__fa.done)).catch(() => true);
    if (done) break;
  }
  const acc = await page.evaluate(() => {
    const a = window.__fa; if (!a) return null;
    const f = a.frames;
    const d = [];
    for (let i = 1; i < f.length; i++) d.push({ t: +(f[i] - f[0]).toFixed(1), dt: +(f[i] - f[i - 1]).toFixed(1) });
    const span = d.length ? d[d.length - 1].t : 0;
    const over = d.filter((x) => x.dt > 100);
    const loaf = a.loaf.map((e) => ({ ...e, relStart: +(e.start - a.t0).toFixed(1) }));
    /* 族别：A 主线程（blocking>=15 或 scripts 合计>=40）/ B present（blocking==0 且 scripts<=12.5 且 renderStart-start>=40）/ C 无 LoAF */
    const classify = (fr) => {
      const cands = loaf.filter((e) => e.relStart <= fr.t + 8 && e.relStart + e.dur >= fr.t - 60);
      const near = cands.sort((x, y) => Math.abs(x.relStart - fr.t) - Math.abs(y.relStart - fr.t))[0];
      if (!near) return { fam: 'C' };
      const scriptSum = +(near.scripts || []).reduce((s, x) => s + x.dur, 0).toFixed(1);
      const lead = +(near.renderStart - near.start).toFixed(1);
      const fam = (near.blocking >= 15 || scriptSum >= 40) ? 'A' : (near.blocking === 0 && scriptSum <= 12.5 && lead >= 40 ? 'B' : 'A?');
      return { fam, loafDur: near.dur, blocking: near.blocking, scriptSum, lead, scripts: (near.scripts || []).slice(0, 3) };
    };
    return {
      frames: d.length, span: +span.toFixed(0), fps: +((d.length / span) * 1000).toFixed(1),
      p50: d.map((x) => x.dt).sort((a, b) => a - b)[Math.floor(d.length / 2)],
      worst: Math.max(...d.map((x) => x.dt)), over100: over.length,
      over: over.map((x) => ({ t: x.t, dt: x.dt, ...classify(x) })),
      loafCount: loaf.length, loaf: loaf.filter((e) => e.dur >= 80).slice(0, 14),
      faErr: window.__faErr || null,
    };
  });
  const gpu = await page.evaluate(() => { try { const c = document.createElement('canvas'); const gl = c.getContext('webgl2'); const d = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(d.UNMASKED_RENDERER_WEBGL); } catch (e) { return null; } });
  rows.push({ run, revealWall, acc, marks: marks.filter(Boolean).map((m) => ({ t: m.t, photoReady: m.photoReady, globe: m.globeShow, tiles: m.tiles })), marks0: marks[0] && marks[0].masks, gpu, errs: errs.slice(0, 5) });
  console.log(`run${run} reveal=${revealWall}ms fps=${acc && acc.fps} p50=${acc && acc.p50} worst=${acc && acc.worst} over100=${acc && acc.over100} loaf=${acc && acc.loafCount}`);
  await browser.close();
}
writeFileSync(`${OUT}/${TAG}-fps-attr.json`, JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
console.log(JSON.stringify(rows.map((r) => ({ run: r.run, reveal: r.revealWall, over: r.acc.over.map((o) => ({ t: o.t, dt: o.dt, fam: o.fam, blocking: o.blocking, scriptSum: o.scriptSum, lead: o.lead, scripts: (o.scripts || []).map((s) => s.src).slice(0, 2) })) })), null, 1));
