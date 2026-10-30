/* Phase6C1 探针9：每帧强制重画 vs 单次重画 —— 判断「合成后缓冲丢失」 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
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
const cdp = await page.createCDPSession();
const px = async (x, y) => {
  const s = (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
  return page.evaluate(async (s, x, y) => {
    const blob = await (await fetch('data:image/png;base64,' + s)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, s, x, y);
};
const probePt = [rect.x + 60, rect.y + 96];  // 左边直边中段
console.log('off baseline     ', await px(...probePt));
await page.evaluate(() => window.__gevEdge.on()); await sleep(60);
console.log('on +60ms         ', await px(...probePt));
await sleep(600);
console.log('on +660ms        ', await px(...probePt));

/* A: 每帧重画（on() 复位 lastSig/texValid → draw 每帧都跑） */
await page.evaluate(() => {
  window.__p9 = setInterval(() => { try { window.__gevEdge.on(); } catch (e) {} }, 8);
});
await sleep(700);
console.log('A on every-frame ', await px(...probePt));
await page.evaluate(() => clearInterval(window.__p9));
await sleep(400);
console.log('A after stop     ', await px(...probePt));

/* B: 关掉所有可能的上层，再每帧重画 */
await page.evaluate(() => { const s = document.createElement('style'); s.id = 'pz';
  s.textContent = '#world-overlay-root,#gev-screen-whiteboard,#lc-stage{display:none!important}'; document.head.appendChild(s); });
await sleep(500);
console.log('B no overlays    ', await px(...probePt));
await page.evaluate(() => document.getElementById('pz').remove());
await browser.close();
