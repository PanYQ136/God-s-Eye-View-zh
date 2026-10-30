#!/usr/bin/env node
/* 持续拖拽 60s：每 5s 桶记录 fps / 单次 mouse.move 往返 / JS 堆 / longtask / DOM 节点数
   目的：确认「交互越久越慢→挂死」是线性劣化（累积/泄漏）还是瓦片流抖动 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1360, H = 782;
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion',
    '--enable-precise-memory-info'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break;
  await sleep(400);
}
await sleep(14000);
const cx = Math.round(W * 0.62), cy = Math.round(H * 0.42);

await page.evaluate(() => {
  window.__L = { lt: [], on: true };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__L.lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] }); } catch (e) {}
});

const buckets = [];
let n = 0;
const bucketMs = 5000;
const total = 60000;
await page.mouse.move(cx, cy);
await page.mouse.down();
const T0 = Date.now();
let bStart = Date.now();
let fpsMark = await page.evaluate(() => { window.__F = { n: 0 }; const tick = () => { window.__F.n++; requestAnimationFrame(tick); }; requestAnimationFrame(tick); return 0; });
let moveTimes = [];
while (Date.now() - T0 < total) {
  const a = Date.now();
  await page.mouse.move(cx + Math.round(Math.sin(n / 12) * 70), cy + Math.round(Math.cos(n / 17) * 40));
  moveTimes.push(Date.now() - a);
  n += 1;
  await sleep(16);
  if (Date.now() - bStart >= bucketMs) {
    const r = await page.evaluate(() => {
      const f = window.__F.n; window.__F = { n: 0 }; const tick = () => { window.__F.n++; requestAnimationFrame(tick); }; requestAnimationFrame(tick);
      return { frames: f, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, nodes: document.getElementsByTagName('*').length, lt: window.__L.lt.splice(0).map((x) => x[1]) };
    });
    const mt = moveTimes.splice(0).sort((x, y) => x - y);
    buckets.push({ t: Math.round((Date.now() - T0) / 1000), fps: +((r.frames / bucketMs) * 1000).toFixed(1), heapMB: r.heap, nodes: r.nodes,
      moveP50: mt[Math.floor(mt.length / 2)] || null, moveMax: mt[mt.length - 1] || null, longtasks: r.lt.slice(0, 6), ltCount: r.lt.length,
      badge: await page.evaluate(() => (document.getElementById('gev-perf-fps') || {}).textContent || null) });
    bStart = Date.now();
  }
}
await page.mouse.up();
console.log(JSON.stringify({ buckets, errs: errs.slice(0, 5) }, null, 1));
await browser.close();
