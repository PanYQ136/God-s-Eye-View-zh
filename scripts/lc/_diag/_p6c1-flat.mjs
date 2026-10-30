/* Phase6C1 探针2：平坦灰底(testBgFlat=128)下，折射 canvas 四边逐像素剖面。 */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const W = 1348, H = 774;
const OUT = '.gev-logs/lc/phase6c1';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000, defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} try { sessionStorage.setItem('gev.gl.armed', '1'); } catch {} });
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break; await sleep(400);
}
await sleep(4000);
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(900);
let ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
if (ph !== 'open') {
  const p = await page.evaluate(() => {
    const el = document.getElementById('data-panel');
    const t = el.querySelector('.panel-header,.pp-header-row,.dock-tray-toggle,.location-toolbar-label') || el;
    const b = t.getBoundingClientRect();
    return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
  });
  await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(80);
  await page.mouse.down(); await sleep(40); await page.mouse.up();
  await sleep(1300);
}
ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
console.log('phase =', ph);
await page.evaluate(() => { const v = (window.__godsEyeView && window.__godsEyeView.viewer) || window.__gevViewer; if (v) v.useDefaultRenderLoop = false; });
await sleep(800);
await page.evaluate(() => { const s = document.createElement('style'); s.id = 'pc-blank'; s.textContent = '#data-panel > *{visibility:hidden!important}'; document.head.appendChild(s); });
await page.evaluate(() => window.__gevEdge.testBg(true, 8, 128));
await sleep(500);
const rect = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const grab = async (x, y, w) => {
  await page.evaluate((g) => { window.__gevEdgeGrab = g; window.__gevEdgeGrabOut = null; window.__gevEdge.on(); }, { x, y, w });
  for (let i = 0; i < 40; i++) { const o = await page.evaluate(() => window.__gevEdgeGrabOut); if (o) return o; await sleep(50); }
  return { err: 'timeout' };
};
const fmt = (o, x0) => {
  if (!o || o.err) return String(o && o.err);
  return o.row.map((p, i) => `${x0 + i}|a${p[3]}|${p[0]},${p[1]},${p[2]}`).join('  ');
};
const R = { rect, edges: {}, rows: {} };
const midX = Math.round(rect.x + rect.w * 0.5), midY = Math.round(rect.y + rect.h * 0.5);
/* 左边缘：x 从 -3 到 +14 */
R.edges.left = await grab(Math.round(rect.x - 3), midY, 18);
/* 右边缘：x 从 -15 到 +3（相对右边界） */
R.edges.right = await grab(Math.round(rect.x + rect.w - 15), midY, 18);
/* 上边缘：y = rect.y + 0..3 各取一行，x 中段 6px */
for (let d = -1; d <= 4; d++) R.rows['top' + d] = await grab(midX, Math.round(rect.y + d), 8);
/* 下边缘：y = bot -1 .. bot +2 */
const bot = Math.round(rect.y + rect.h);
for (let d = -1; d <= 3; d++) R.rows['bot' + d] = await grab(midX, bot + d, 8);
console.log('rect', JSON.stringify(rect));
console.log('LEFT  ', fmt(R.edges.left, Math.round(rect.x - 3)));
console.log('RIGHT ', fmt(R.edges.right, Math.round(rect.x + rect.w - 15)));
for (const k of Object.keys(R.rows)) console.log(k.padEnd(6), fmt(R.rows[k], midX));
writeFileSync(`${OUT}/probe-flat.json`, JSON.stringify(R, null, 1));
await browser.close();
