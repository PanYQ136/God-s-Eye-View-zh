#!/usr/bin/env node
/* 评审 Round-2（执行透镜）第二/第三套仪器：
   mode=clean  —— reveal 后 45s 纯 rAF dt 采样（不做 getComputedStyle、不截图、不轮询），
                  同时挂 PerformanceObserver(long-animation-frame) 作为浏览器侧独立判据。
   mode=shots  —— reveal 后 0.1s / 1.5s / 4s / 8s / 12s 连拍（只看画面，不看时序）。
   自跑：node scripts/lc/_diag/_rev2-clean.mjs clean|shots [tag] */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mode = process.argv[2] || 'clean';
const tag = process.argv[3] || 'rev2';
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});
const t0 = Date.now();
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 300; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ok) break;
  await sleep(100);
}
const readyAt = Date.now() - t0;
const tileProbe = () => page.evaluate(() => {
  const v = window.__gevViewer; let ts = null;
  try { const p = v.scene.primitives; for (let k = 0; k < p.length; k++) { const q = p.get(k); if (q && q.initialTilesLoaded) ts = q; } } catch (e) {}
  const st = ts && ts.statistics; const s = window.__gevBoot && window.__gevBoot.snapshot && window.__gevBoot.snapshot();
  return { contentReady: st && st.numberOfTilesWithContentReady, cmds: st && st.numberOfCommands,
    tilesLoaded: ts && !!ts.tilesLoaded, resScale: v && v.resolutionScale,
    sched: window.Cesium && window.Cesium.RequestScheduler
      ? { per: window.Cesium.RequestScheduler.maximumRequestsPerServer, all: window.Cesium.RequestScheduler.maximumRequests } : null,
    maskOpacity: s && s.maskOpacity, state: s && s.state, interactiveAt: s && s.interactiveAt };
});
if (mode === 'clean') {
  /* 纯采样：页面内自跑 45s，中途不 evaluate、不截图 */
  const r = await page.evaluate(async (ms) => {
    const loaf = [];
    try {
      const ob = new PerformanceObserver((list) => { for (const e of list.getEntries()) loaf.push({ start: +e.startTime.toFixed(1), dur: +e.duration.toFixed(1), blocking: +(e.blockingDuration || 0).toFixed(1), scripts: (e.scripts || []).slice(0, 4).map((s) => ({ f: String(s.sourceURL || '').split('/').slice(-1)[0], fn: s.functionName || '', d: +(s.duration || 0).toFixed(1) })) }); });
      ob.observe({ type: 'long-animation-frame', buffered: false });
    } catch (e) {}
    const t0 = performance.now(); const dt = []; let last = t0;
    await new Promise((res) => { const tick = (ts) => { const d = ts - last; last = ts; if (d > 0) dt.push(+d.toFixed(1)); if (ts - t0 < ms) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
    const s = dt.slice().sort((a, b) => a - b);
    return { frames: dt.length, fps: +(1000 / s[Math.floor(s.length / 2)]).toFixed(1), p50: s[Math.floor(s.length / 2)],
      p95: s[Math.floor(s.length * 0.95)], worst: Math.max(...dt), over60: dt.filter((v) => v > 60).length,
      over100: dt.filter((v) => v > 100).length, top: dt.slice().sort((a, b) => b - a).slice(0, 8), loaf };
  }, 45000);
  const tiles = [await tileProbe()];
  console.log(JSON.stringify({ mode, readyAt, sample: r, tiles }, null, 1));
}
if (mode === 'shots') {
  const out = { mode, readyAt, shots: [] };
  for (const at of [100, 1500, 4000, 8000, 12000]) {
    const wait = at - (Date.now() - t0 - readyAt);
    if (wait > 0) await sleep(wait);
    const info = await tileProbe();
    const png = await page.screenshot({ encoding: 'base64' });
    writeFileSync(`.gev-logs/lc/phase6c3/${tag}-r2shot+${at}.png`, Buffer.from(png, 'base64'));
    out.shots.push({ at, info });
  }
  console.log(JSON.stringify(out, null, 1));
}
await browser.close();
