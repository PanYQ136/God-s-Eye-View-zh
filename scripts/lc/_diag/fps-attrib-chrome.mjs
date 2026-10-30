#!/usr/bin/env node
/* 交互期 30ms 帧成本归因（Chrome + 真实拖拽，每个窗口 3s）
   对照：baseline / 隐藏各覆盖层 / 降 resolutionScale（仅诊断） */
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

async function win(label, setup, ms = 3000) {
  if (setup) { await page.evaluate(setup); await sleep(600); }
  await page.evaluate(() => {
    window.__M = { rafs: [], on: true };
    const tick = (t) => { if (!window.__M.on) return; window.__M.rafs.push(t); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const t0 = Date.now();
  let n = 0;
  const tMove = [];
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  while (Date.now() - t0 < ms) {
    const a = Date.now();
    await page.mouse.move(cx + Math.round(Math.sin(n / 12) * 60), cy + Math.round(Math.cos(n / 17) * 36));
    tMove.push(Date.now() - a);
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
    return { fps: +((g.length / Math.max(1, span)) * 1000).toFixed(2), p50: q(.5), p95: q(.95), max: s[s.length - 1],
      badge: (document.getElementById('gev-perf-fps') || {}).textContent || null };
  });
  tMove.sort((a, b) => a - b);
  console.log(label, JSON.stringify({ ...r, moves: n, moveMsP50: tMove[Math.floor(tMove.length / 2)] }));
}

await win('1 baseline            ', null);
await win('2 hide detection-surf ', () => { ['world-overlay-detection-surface', 'world-overlay-canvas', 'scope-mask'].forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; }); });
await win('3 hide celestial rings', () => { document.querySelectorAll('.celestial-ring-canvas').forEach((e) => { e.style.display = 'none'; }); });
await win('4 hide clouds+edge    ', () => { ['cockpit-cloud-effects', 'gev-edge-lens'].forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; }); });
await win('5 res 0.5 (diag)      ', () => { window.__gevViewer.resolutionScale = 0.5; });
await win('6 res 1.0 full        ', () => { window.__gevViewer.resolutionScale = 1.0; });
await browser.close();
