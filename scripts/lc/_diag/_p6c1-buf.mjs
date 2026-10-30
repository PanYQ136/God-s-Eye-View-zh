/* Phase6C1 探针8：折射缓冲内容 bbox（toDataURL 解码）——内容到底在哪 */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const W = 1348, H = 774;
mkdirSync('.gev-logs/lc/phase6c1', { recursive: true });
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
    const b = t.getBoundingClientRect(); return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
  });
  await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(80);
  await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1300);
}
const rect = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const out = await page.evaluate(async (rect) => {
  const cv = document.getElementById('gev-edge-lens');
  const url = cv.toDataURL('image/png');
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
  const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
  let n = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, sumA = 0;
  const col = {}; // 每 40px 行带计数
  for (let y = 0; y < bmp.height; y++) {
    for (let x = 0; x < bmp.width; x++) {
      const a = d[(y * bmp.width + x) * 4 + 3];
      if (a > 8) {
        n++; sumA += a;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        const k = Math.floor(y / 40) * 40; col[k] = (col[k] || 0) + 1;
      }
    }
  }
  const rowAt = (y) => { const o = []; for (let x = Math.round(rect.x - 2); x < Math.round(rect.x + 16); x++) o.push(d[(y * bmp.width + x) * 4 + 3]); return o; };
  return { pngLen: url.length, nonZero: n, sumA, bbox: [minX, minY, maxX, maxY], size: [bmp.width, bmp.height],
    rows: { y95: rowAt(95), y96: rowAt(96), y97: rowAt(97) },
    rowHits: Object.entries(col).slice(0, 24) };
}, rect);
console.log(JSON.stringify(out, null, 1));
writeFileSync('.gev-logs/lc/phase6c1/lens-buffer.json', JSON.stringify(out, null, 1));
await browser.close();
