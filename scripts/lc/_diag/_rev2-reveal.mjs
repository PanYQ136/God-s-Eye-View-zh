#!/usr/bin/env node
/* 评审 Round-2（执行透镜）独立探针：reveal 瞬间 / +1.5s / +4s / +8s 的可见画面与瓦片就绪度
   目的：B 方案把长帧藏进遮罩的代价是「收起瞬间地图低清」——量化这个代价有多长、多严重。
   自跑：node scripts/lc/_diag/_rev2-reveal.mjs <tag> */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = process.argv[2] || 'rev2';
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
page.on('pageerror', (e) => console.log('pageerror', String(e.message).slice(0, 120)));
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
  /* 帧采样：记录每个 rAF 的 dt 与遮罩不透明度（独立于 gev-boot-gate 的第二套仪器） */
  try {
    window.__rev = { frames: [], t0: performance.now() };
    const maskOp = () => {
      const el = document.getElementById('loading-screen');
      if (!el) return 0;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
      const o = parseFloat(cs.opacity); return Number.isFinite(o) ? o : 0;
    };
    let last = performance.now();
    const tick = () => {
      const t = performance.now(); const dt = t - last; last = t;
      window.__rev.frames.push({ at: +(t - window.__rev.t0).toFixed(1), dt: +dt.toFixed(1), op: +maskOp().toFixed(3) });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (e) {}
});
const t0 = Date.now();
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 300; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ok) break;
  await sleep(100);
}
const readyAt = Date.now() - t0;
const probe = () => page.evaluate(() => {
  const v = window.__gevViewer; let ts = null;
  try { const p = v.scene.primitives; for (let k = 0; k < p.length; k++) { const q = p.get(k); if (q && q.initialTilesLoaded) ts = q; } } catch (e) {}
  const st = ts && ts.statistics;
  const s = window.__gevBoot && window.__gevBoot.snapshot ? window.__gevBoot.snapshot() : null;
  return {
    contentReady: st && st.numberOfTilesWithContentReady,
    cmds: st && st.numberOfCommands,
    tilesLoaded: ts && !!ts.tilesLoaded,
    pending: st && st.numberOfPendingRequests,
    camH: v && v.camera && Math.round(v.camera.positionCartographic.height),
    resScale: v && v.resolutionScale,
    pixelRatio: v && v.scene && v.scene.pixelRatio,
    sched: window.Cesium && window.Cesium.RequestScheduler
      ? { per: window.Cesium.RequestScheduler.maximumRequestsPerServer, all: window.Cesium.RequestScheduler.maximumRequests } : null,
    bootState: s && s.state, maskOp: s && s.maskOpacity,
    interactiveAt: s && s.interactiveAt,
    lastFrame: (() => { const f = window.__rev.frames.slice(-1)[0]; return f; })(),
  };
});
const out = { tag, readyAt, shots: [], timeline: [] };
/* 三张关键画面：收起瞬间、+1.5s、+4s、+8s */
for (const at of [60, 1500, 4000, 8000, 12000]) {
  const wait = at - (Date.now() - t0 - readyAt);
  if (wait > 0) await sleep(wait);
  const info = await probe();
  const png = await page.screenshot({ encoding: 'base64' });
  writeFileSync(`.gev-logs/lc/phase6c3/${tag}-reveal+${at}.png`, Buffer.from(png, 'base64'));
  out.shots.push({ at, info });
}
/* reveal 后 20s 内每秒一次的瓦片就绪曲线 */
for (let k = 0; k <= 20; k++) {
  const wait = 60 + k * 1000 - (Date.now() - t0 - readyAt);
  if (wait > 0) await sleep(wait);
  const i = await probe();
  out.timeline.push({ t: k, contentReady: i.contentReady, pending: i.pending, tilesLoaded: i.tilesLoaded, resScale: i.resScale });
}
const fr = await page.evaluate(() => window.__rev.frames);
const post = fr.filter((f) => f.op < 0.95);
out.frames = { total: fr.length, postReveal: post.length, worstPost: Math.max(0, ...post.map((f) => f.dt)),
  over100Post: post.filter((f) => f.dt > 100).map((f) => ({ at: f.at, dt: f.dt, op: f.op })),
  over60Post: post.filter((f) => f.dt > 60).length };
console.log(JSON.stringify(out, null, 1));
await browser.close();
