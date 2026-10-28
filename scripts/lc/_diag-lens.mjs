import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--no-sandbox', '--window-size=1560,890', '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'], protocolTimeout: 300000, defaultViewport: { width: 1536, height: 730, deviceScaleFactor: 1 } });
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 120; i++) { if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break; await sleep(400); }
await sleep(8000);
const pt = await page.evaluate(() => { const b = document.querySelector('#data-panel .panel-header').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; });
await page.mouse.move(pt.x, pt.y, { steps: 3 }); await page.mouse.down(); await sleep(30); await page.mouse.up(); await sleep(1400);
const cdp = await page.createCDPSession();
const has = await page.evaluate(() => !!document.getElementById('gev-edge-lens'));

async function prof(tag) {
  const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: 120, h: 60 }; });
  await page.evaluate((r) => { const d = document.createElement('div'); d.id = 'bd'; d.style.cssText = `position:fixed;z-index:149;left:${r.x - 30}px;top:${r.y - 30}px;width:${r.w + 60}px;height:${r.h + 60}px;background:rgb(100,100,100);pointer-events:none;`; document.body.appendChild(d); }, r);
  await sleep(150);
  const clip = { x: r.x - 6, y: r.y - 6, width: r.w + 12, height: r.h + 12, scale: 8 };
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
  writeFileSync(`.gev-logs/lc/cmp-${tag}.png`, Buffer.from(data, 'base64'));
  const out = await page.evaluate(async (data, r) => {
    const blob = await (await fetch('data:image/png;base64,' + data)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    const L = (x, y) => { const i = (y * bmp.width + x) * 4; return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; };
    const f = bmp.width / (r.w + 12);
    const edge = Math.round(6 * f);
    /* 左沿：沿 x 扫（行的中间段取均值） */
    const y0 = Math.round(bmp.height * 0.45), y1 = Math.round(bmp.height * 0.55);
    const cols = [];
    for (let x = 0; x < bmp.width; x++) { let s = 0; for (let y = y0; y < y1; y++) s += L(x, y); cols.push(s / (y1 - y0)); }
    const seg = cols.slice(edge - 3 * f, edge + 3 * f).map((v) => +v.toFixed(1));
    return { f, edge, seg };
  }, data, r);
  await page.evaluate(() => document.getElementById('bd')?.remove());
  console.log(tag, JSON.stringify(out));
}
console.log('edge-lens canvas 存在:', has);
await prof('with-lens');
await page.evaluate(() => document.getElementById('gev-edge-lens')?.remove());
await sleep(300);
await prof('no-lens');
await browser.close();
