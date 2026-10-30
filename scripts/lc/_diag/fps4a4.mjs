#!/usr/bin/env node
/* 剩余帧率归因：55fps 的天花板到底是谁的（折射 canvas 层 / backdrop-filter / 页面自身）
   node scripts/lc/_diag/fps4a4.mjs */
import puppeteer from 'puppeteer';
const URL = process.env.LC_URL || 'http://127.0.0.1:4173/';
const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront();
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 240; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
await sleep(6000);

async function sample(tag, ms = 5000) {
  const r = await page.evaluate(async (ms) => {
    const ts = []; const t0 = performance.now();
    await new Promise((res) => { const f = (x) => { ts.push(x); if (x - t0 < ms) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const g = []; for (let i = 1; i < ts.length; i++) g.push(+(ts[i] - ts[i - 1]).toFixed(2));
    const s = g.slice().sort((a, b) => a - b);
    const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
    const avg = g.length ? g.reduce((a, b) => a + b, 0) / g.length : 0;
    return { avgFps: avg ? +(1000 / avg).toFixed(1) : 0, p50: q(0.5), p95: q(0.95), anims: document.getAnimations().length,
      canvases: document.querySelectorAll('canvas').length, cesiumPost: null };
  }, ms);
  console.log(tag.padEnd(22) + JSON.stringify(r));
  return r;
}

const rows = {};
rows.base = await sample('A 基线（9面）');
await page.evaluate(() => { document.getElementById('gev-edge-lens').style.display = 'none'; });
await sleep(600);
rows.noLensLayer = await sample('B 折射层 display:none');
await page.evaluate(() => { document.getElementById('gev-edge-lens').style.display = ''; });
await sleep(600);
rows.back = await sample('C 折射层回来');
/* backdrop-filter 全关（诊断用，不保留） */
await page.evaluate(() => {
  const st = document.createElement('style'); st.id = 'diag-nobf';
  st.textContent = '*{backdrop-filter:none !important;-webkit-backdrop-filter:none !important;}';
  document.head.appendChild(st);
});
await sleep(600);
rows.noBackdrop = await sample('D 关 backdrop-filter');
await page.evaluate(() => { const s = document.getElementById('diag-nobf'); if (s) s.remove(); });
await sleep(600);
/* 停掉 Cesium 渲染循环（requestRenderMode 已经空闲，看是否还有别的东西在出帧） */
await page.evaluate(() => { window.__gevViewer.useDefaultRenderLoop = false; });
await sleep(600);
rows.noRenderLoop = await sample('E 停 Cesium renderLoop');
await page.evaluate(() => { window.__gevViewer.useDefaultRenderLoop = true; });
console.log(JSON.stringify(rows));
await browser.close();
