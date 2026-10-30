#!/usr/bin/env node
/* Phase6C2 诊断7：顶/左沿色散的 lens 画布级原始读数（绕开合成器） */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const W = 1348, VH = 774, OUT = '.gev-logs/lc/phase6c2';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${VH + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000, defaultViewport: { width: W, height: VH, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false)) break;
  await sleep(400);
}
await sleep(6000);
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(800);
if (await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase) !== 'open') {
  const p = await page.evaluate(() => { const b = document.getElementById('data-panel').querySelector('.panel-header').getBoundingClientRect(); return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) }; });
  await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(80); await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1200);
}
await page.mouse.move(4, 620, { steps: 3 });
const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height };
});
const grabRow = async (x, y, w) => page.evaluate(async (x, y, w) => {
  window.__gevEdgeGrab = { x, y, w };
  for (let i = 0; i < 40; i++) { await new Promise((res) => setTimeout(res, 25)); if (window.__gevEdgeGrabOut) break; }
  const o = window.__gevEdgeGrabOut; window.__gevEdgeGrabOut = null;
  return o && o.row ? o.row : null;
}, Math.round(x), Math.round(y), Math.round(w));

const out = {};
for (const [name, axis, dp] of [['top-hstripes-dp1.2', 1, 1.2], ['top-hstripes-dp4', 1, 4], ['left-vstripes-dp1.2', 0, 1.2], ['left-vstripes-dp4', 0, 4]]) {
  await page.evaluate((axis, dp) => { window.__gevEdge.testStripes(axis, 8); window.__gevEdge.set({ dispPx: dp }); }, axis, dp);
  await sleep(1300);
  const rows = {};
  if (axis === 1) {
    for (let k = 0; k <= 6; k++) {
      const row = await grabRow(r.x + 40, r.y + k, 60);
      if (row) rows[k] = { maxRB: Math.max(...row.map((p) => Math.abs(p[0] - p[2]))), aMax: Math.max(...row.map((p) => p[3])), sample: row.slice(20, 26) };
    }
  } else {
    for (let k = 0; k <= 6; k++) {
      const row = await grabRow(r.x + k, r.y + 120, 10);
      if (row) rows[k] = { maxRB: Math.max(...row.map((p) => Math.abs(p[0] - p[2]))), aMax: Math.max(...row.map((p) => p[3])), sample: row };
    }
  }
  out[name] = rows;
  console.log(name, JSON.stringify(rows).slice(0, 900));
}
writeFileSync(`${OUT}/diag7.json`, JSON.stringify({ r, out }, null, 1));
console.log('WROTE diag7.json');
await browser.close();
