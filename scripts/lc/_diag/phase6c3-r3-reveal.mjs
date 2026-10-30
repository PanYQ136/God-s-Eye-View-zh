#!/usr/bin/env node
/* Phase6C3-R3 诊断：遮罩收起（reveal）时刻到底有没有影像？
   与 gate 的 B5 取证口径一致，但用**页内**时间戳（performance.now）判定 reveal，
   避免 CDP 轮询延迟把「reveal+0.1s」拍成「reveal+7s」。
   同时每 150ms 采一条时间线（瓦片统计 / globe.show / LOAD FAILED 芯片 / 画布探针）。
   自跑：node scripts/lc/_diag/phase6c3-r3-reveal.mjs <tag> [nocache] */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = process.argv[2] || 'r3rev';
const noCache = process.argv[3] === 'nocache';
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
page.on('pageerror', (e) => console.log('pageerror', String(e.message).slice(0, 140)));
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
  window.__rec = { t0: performance.now(), revealAt: null, timeline: [] };
  const maskOp = () => {
    const el = document.getElementById('loading-screen');
    if (!el) return 0;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
    const o = parseFloat(cs.opacity);
    return Number.isFinite(o) ? o : 0;
  };
  let lastSample = 0;
  const tick = () => {
    const t = performance.now();
    const op = maskOp();
    if (window.__rec.revealAt == null && op < 0.05) window.__rec.revealAt = t;
    if (t - lastSample >= 150) {
      lastSample = t;
      const v = window.__gevViewer;
      let ts = null;
      try { const p = v.scene.primitives; for (let k = 0; k < p.length; k++) { const q = p.get(k); if (q && q.initialTilesLoaded) ts = q; } } catch (e) {}
      const st = ts && ts.statistics;
      const b = window.__gevBoot && window.__gevBoot.snapshot ? window.__gevBoot.snapshot() : null;
      window.__rec.timeline.push({
        at: +t.toFixed(0), maskOp: +op.toFixed(2), state: b && b.state, reason: b && b.reason,
        contentReady: st && st.numberOfTilesWithContentReady, pending: st && st.numberOfPendingRequests,
        tilesLoaded: ts ? !!ts.tilesLoaded : null, cmds: st && st.numberOfCommands,
        globeShow: v && v.scene && v.scene.globe ? v.scene.globe.show : null,
        probe: b && b.viewProbe ? [b.viewProbe.std, b.viewProbe.uniq] : null,
        failChip: /LOAD FAILED|加载失败/.test((document.getElementById('loading-feedback') || {}).textContent || '') || /LOAD FAILED/.test(document.body.innerText || ''),
      });
      if (window.__rec.timeline.length > 400) window.__rec.timeline.shift();
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const tNav = Date.now();
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
if (noCache) {
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.reload({ waitUntil: 'load', timeout: 240000 });
}
/* 等页内 reveal（每 40ms 轮询，误差 <60ms；同时把 revealAt 的页内时间戳取回来） */
let revealPage = null;
for (let i = 0; i < 1500; i++) {
  const r = await page.evaluate(() => (window.__rec && window.__rec.revealAt != null ? window.__rec.revealAt : null)).catch(() => null);
  if (r != null) { revealPage = r; break; }
  await sleep(40);
}
console.log('reveal(page perf) =', revealPage);
const samples = [];
const relNow = () => page.evaluate(() => performance.now() - window.__rec.revealAt);
for (const at of [-150, 100, 1000, 4000, 8000]) {
  const cur = await relNow();
  const wait = at - cur;
  if (wait > 0) await sleep(wait);
  const png = await page.screenshot({ encoding: 'base64' });
  writeFileSync(`.gev-logs/lc/phase6c3/${tag}-t${at}.png`, Buffer.from(png, 'base64'));
  const st = await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const w = Math.min(640, bmp.width), h = Math.min(420, bmp.height);
    const x = Math.round((bmp.width - w) / 2), y = Math.round((bmp.height - h) / 2);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, x, y, w, h, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data;
    let sum = 0, sum2 = 0, n = 0; const uniq = new Set();
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l; sum2 += l * l; n += 1; uniq.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    }
    const m = sum / n;
    return { mean: +m.toFixed(2), std: +Math.sqrt(Math.max(0, sum2 / n - m * m)).toFixed(2), uniq: uniq.size };
  }, png);
  samples.push({ at, ...st });
  console.log('t' + at, JSON.stringify(st));
}
const out = await page.evaluate(() => ({ timeline: window.__rec.timeline, revealAt: window.__rec.revealAt }));
writeFileSync(`.gev-logs/lc/phase6c3/${tag}.json`, JSON.stringify({ tag, noCache, samples, ...out }, null, 1));
console.log('timeline head', JSON.stringify(out.timeline.slice(0, 6)));
await browser.close();
