#!/usr/bin/env node
/* A/B：Chrome + 真实拖拽下，玻璃边缘折射层是否就是 FPS 瓶颈
   窗口：baseline / edge.off / edge 恢复后再测 */
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
await sleep(12000);
const cx = Math.round(W * 0.62), cy = Math.round(H * 0.42);

async function win(label, setup, ms = 4000) {
  if (setup) { await page.evaluate(setup); await sleep(800); }
  await page.bringToFront();
  await page.evaluate(() => {
    window.__M = { rafs: [], on: true };
    const tick = (t) => { if (!window.__M.on) return; window.__M.rafs.push(t); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const t0 = Date.now();
  let n = 0;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  while (Date.now() - t0 < ms) {
    await page.mouse.move(cx + Math.round(Math.sin(n / 12) * 60), cy + Math.round(Math.cos(n / 17) * 36));
    n += 1;
    await sleep(16);
  }
  await page.mouse.up();
  const r = await page.evaluate(() => {
    window.__M.on = false;
    const ts = window.__M.rafs; const g = [];
    for (let i = 1; i < ts.length; i++) g.push(+(ts[i] - ts[i - 1]).toFixed(2));
    const s = g.slice().sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
    const span = ts.length > 1 ? ts[ts.length - 1] - ts[0] : 0;
    return { n: ts.length, spanMs: Math.round(span), fps: +((g.length / Math.max(1, span)) * 1000).toFixed(2),
      p50: q(.5), p95: q(.95), max: s[s.length - 1], over100: s.filter((x) => x > 100).length,
      badge: (document.getElementById('gev-perf-fps') || {}).textContent || null,
      edge: window.__gevEdge.stats() };
  });
  console.log(label, JSON.stringify({ fps: r.fps, p50: r.p50, p95: r.p95, max: r.max, over100: r.over100, moves: n, span: r.spanMs, badge: r.badge, edgeDraw: r.edge.drawFps, edgeScale: r.edge.scale, edgeLod: r.edge.lod }));
  return r;
}

await win('A-baseline   ', null);
await win('B-edge.off   ', () => window.__gevEdge.off());
await win('C-edge.on    ', () => window.__gevEdge.on && window.__gevEdge.on());
await win('D-cesium-halt', () => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await browser.close();
