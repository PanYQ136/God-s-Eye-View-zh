#!/usr/bin/env node
/* Phase6C2 诊断8：色散口径验证 —— 1D 剖面（每行 max）vs 2D band 区域 max
   假设：顶/下沿位移是纵向，而 1D 剖面沿 x 扫（同一条纹内）→ 恒 0；2D band max 能测到。 */
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
await page.evaluate(() => {
  const s = document.createElement('style'); s.id = 'pc-blank';
  s.textContent = '#data-panel > *{visibility:hidden!important}'; document.head.appendChild(s);
  const d = document.createElement('div'); d.id = 'pc-under';
  d.style.cssText = 'position:fixed;inset:0;background:#808080;z-index:1;pointer-events:none'; document.body.appendChild(d);
  window.__gevEdge.testChecker(true, 8, 0);
});
await page.mouse.move(4, 620, { steps: 3 });
await sleep(1800);
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const band = await page.evaluate(() => (window.__gevEdge.stats().surfaces.find((s) => s.id === 'data-panel') || {}).band);
await page.evaluate(() => {
  window.__pc8 = {
    async dec(b64) {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
      return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
    },
    /* rect = device px 的卡片矩形；bandD = device px */
    measure(A, B, rect, bandD) {
      const x0 = Math.round(rect.x), x1 = Math.round(rect.x + rect.w), y0 = Math.round(rect.y), y1 = Math.round(rect.y + rect.h);
      const bx0 = Math.round(rect.x + rect.w * 0.3), bx1 = Math.round(rect.x + rect.w * 0.7);
      const by0 = Math.round(rect.y + rect.h * 0.3), by1 = Math.round(rect.y + rect.h * 0.7);
      const band = Math.round(bandD);
      const scan = (xs, xe, ys, ye) => {
        let mx = 0, mxLum = 0, pk = null;
        for (let y = Math.max(0, ys); y < ye && y < A.h; y++) {
          for (let x = Math.max(0, xs); x < xe && x < A.w; x++) {
            const i = (y * A.w + x) * 4;
            const dr = A.d[i] - B.d[i], dg = A.d[i + 1] - B.d[i + 1], db = A.d[i + 2] - B.d[i + 2];
            const v = Math.abs(dr - db); if (v > mx) { mx = v; pk = [x, y]; }
            const l = Math.abs(0.2126 * dr + 0.7152 * dg + 0.0722 * db); if (l > mxLum) mxLum = l;
          }
        }
        return { d2: mx, pk, lum2: +mxLum.toFixed(1) };
      };
      return {
        top: scan(bx0, bx1, y0, y0 + band),
        bot: scan(bx0, bx1, y1 - band, y1),
        left: scan(x0, x0 + band, by0, by1),
        right: scan(x1 - band, x1, by0, by1),
      };
    },
  };
});
const K = await page.evaluate(async (b64) => (await window.__pc8.dec(b64)).w / innerWidth, await shot());
const rD = { x: r.x * K, y: r.y * K, w: r.w * K, h: r.h * K };
const bandD = band * K;
const res = {};
for (const dp of [1.2, 1.5, 1.8]) {
  await page.evaluate((v) => window.__gevEdge.set({ dispPx: v }), dp);
  await sleep(800);
  const on = await shot();
  await page.evaluate(() => window.__gevEdge.off()); await sleep(550);
  const off = await shot();
  await page.evaluate(() => window.__gevEdge.on()); await sleep(650);
  const m = await page.evaluate(async (on, off, r, band) => {
    const A = await window.__pc8.dec(on), B = await window.__pc8.dec(off);
    return window.__pc8.measure(A, B, r, band);
  }, on, off, rD, bandD);
  res[dp] = m;
  console.log('dispPx', dp, '| 2D band max|ΔR−ΔB|  top', m.top.d2, 'bot', m.bot.d2, 'left', m.left.d2, 'right', m.right.d2,
    '| peak@', JSON.stringify([m.top.pk, m.left.pk]), '| maxLum top', m.top.lum2);
}
writeFileSync(`${OUT}/diag8.json`, JSON.stringify({ K, r, band, rD, bandD, res }, null, 1));
console.log('WROTE diag8.json');
await browser.close();
