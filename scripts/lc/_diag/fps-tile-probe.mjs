#!/usr/bin/env node
/* 交互期掉帧是否由 Cesium 瓦片流引起：每个窗口记录 fps / 瓦片队列峰值 / MSE */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1360, H = 782;
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront();
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break;
  await sleep(400);
}
await sleep(14000);
const cx = Math.round(W * 0.62), cy = Math.round(H * 0.42);
/* 预热 */
await page.mouse.move(cx, cy); await page.mouse.down();
for (let t = Date.now(), i = 0; Date.now() - t < 3000; i++) { await page.mouse.move(cx + Math.round(Math.sin(i / 12) * 60), cy + Math.round(Math.cos(i / 17) * 36)); await sleep(16); }
await page.mouse.up(); await sleep(2500);

async function win(label, ms = 8000) {
  await page.evaluate(() => {
    const v = window.__gevViewer;
    window.__W = { rafs: [], on: true, tilePend: 0, tilePeak: 0, mse: v.scene.globe.maximumScreenSpaceError, tileLvl: 0 };
    const mine = window.__W;
    const onProg = (n) => { mine.tilePend = n; if (n > mine.tilePeak) mine.tilePeak = n; };
    v.scene.globe.tileLoadProgressEvent.addEventListener(onProg);
    mine.offProg = () => v.scene.globe.tileLoadProgressEvent.removeEventListener(onProg);
    const tick = (t) => { if (!mine.on) return; mine.rafs.push(t); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const t0 = Date.now(); let n = 0;
  await page.mouse.move(cx, cy); await page.mouse.down();
  while (Date.now() - t0 < ms) {
    await page.mouse.move(cx + Math.round(Math.sin(n / 12) * 70), cy + Math.round(Math.cos(n / 17) * 40));
    n += 1;
    await sleep(16);
  }
  await page.mouse.up();
  const r = await page.evaluate(() => {
    const w = window.__W; w.on = false; try { w.offProg(); } catch (e) {}
    const ts = w.rafs; const g = [];
    for (let i = 1; i < ts.length; i++) g.push(ts[i] - ts[i - 1]);
    const span = ts.length > 1 ? ts[ts.length - 1] - ts[0] : 0;
    const s = g.slice().sort((a, b) => a - b);
    return { fps: +((g.length / Math.max(1, span)) * 1000).toFixed(1), p50: +(s[Math.floor(s.length * .5)] || 0).toFixed(1),
      p95: +(s[Math.floor(s.length * .95)] || 0).toFixed(1), max: +(s[s.length - 1] || 0).toFixed(1),
      tilePeak: w.tilePeak, mse: w.mse, pendingNow: w.tilePend,
      badge: (document.getElementById('gev-perf-fps') || {}).textContent || null,
      rs: window.__gevViewer.resolutionScale };
  });
  console.log(label, JSON.stringify({ ...r, moves: n }));
}

await win('w1 pan');
await win('w2 pan');
await win('w3 pan');
/* 原地缩放，不换区域 → 瓦片基本已缓存 */
await page.evaluate(() => {});
const t = Date.now(); let i = 0;
await page.evaluate(() => { window.__W = { rafs: [], on: true }; const mine = window.__W; const tick = (x) => { if (!mine.on) return; mine.rafs.push(x); requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
while (Date.now() - t < 8000) { await page.mouse.wheel({ deltaY: i % 2 ? -120 : 120 }); i += 1; await sleep(60); }
console.log('w4 zoom-in-place', JSON.stringify(await page.evaluate(() => {
  const w = window.__W; w.on = false; const ts = w.rafs; const g = [];
  for (let i = 1; i < ts.length; i++) g.push(ts[i] - ts[i - 1]);
  const span = ts.length > 1 ? ts[ts.length - 1] - ts[0] : 0;
  const s = g.slice().sort((a, b) => a - b);
  return { fps: +((g.length / Math.max(1, span)) * 1000).toFixed(1), p50: +(s[Math.floor(s.length * .5)] || 0).toFixed(1), p95: +(s[Math.floor(s.length * .95)] || 0).toFixed(1), max: +(s[s.length - 1] || 0).toFixed(1), badge: (document.getElementById('gev-perf-fps') || {}).textContent || null };
})));
await browser.close();
