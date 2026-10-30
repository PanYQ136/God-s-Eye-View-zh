#!/usr/bin/env node
/* Phase6C2 诊断9：顶沿法线方向判定 —— 竖条纹(位移若有横向分量就会出彩边) + rimAmt 0 去高光 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
mkdirSync('.gev-logs/lc/phase6c2', { recursive: true });
const W = 1348, VH = 774;
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
const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const grabRow = async (x, y, w) => page.evaluate(async (x, y, w) => {
  window.__gevEdgeGrab = { x, y, w };
  for (let i = 0; i < 40; i++) { await new Promise((res) => setTimeout(res, 25)); if (window.__gevEdgeGrabOut) break; }
  const o = window.__gevEdgeGrabOut; window.__gevEdgeGrabOut = null;
  return o && o.row ? o.row : null;
}, Math.round(x), Math.round(y), Math.round(w));

const tests = [
  { name: 'top + vstripes(axis0) + rim0 + dp3', bg: [0, 3], rim: 0 },
  { name: 'top + hstripes(axis1) + rim0 + dp3', bg: [1, 3], rim: 0 },
  { name: 'left + vstripes(axis0) + rim0 + dp3 (对照)', bg: [0, 3], rim: 0 },
  { name: 'top + checker + rim0 + dp3', bg: [2, 3], rim: 0 },
];
for (const t of tests) {
  await page.evaluate((t) => {
    if (t.bg[0] === 2) window.__gevEdge.testChecker(true, 8, 0); else window.__gevEdge.testStripes(t.bg[0], 8);
    window.__gevEdge.set({ dispPx: t.bg[1], rimAmt: t.rim });
  }, t);
  await sleep(1300);
  const rows = {};
  for (let k = 0; k <= 5; k++) {
    const row = await grabRow(r.x + 40, r.y + k, 40);   // 顶沿：横向 40 px
    if (row) rows['top' + k] = { maxRB: Math.max(...row.map((p) => Math.abs(p[0] - p[2]))), aMax: Math.max(...row.map((p) => p[3])), s: row.slice(10, 16) };
  }
  const lcol = await grabRow(r.x, r.y + 120, 8);        // 左沿：横向 8 px 跨 band
  console.log(t.name, '| top rows', JSON.stringify(rows).slice(0, 700));
  if (lcol) console.log('   left row', JSON.stringify(lcol.map((p) => p.slice(0, 3))));
}
await browser.close();
