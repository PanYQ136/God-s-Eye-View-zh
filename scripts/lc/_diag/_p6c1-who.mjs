/* Phase6C1 探针6：折射 canvas 到底有没有被绘制？谁盖住它？ */
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
await sleep(4500);
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
await page.evaluate(() => { const v = (window.__godsEyeView && window.__godsEyeView.viewer) || window.__gevViewer; if (v) v.useDefaultRenderLoop = false; });
await sleep(900);
await page.evaluate(() => { const s = document.createElement('style'); s.id = 'pc-blank'; s.textContent = '#data-panel > *{visibility:hidden!important}'; document.head.appendChild(s); });
await sleep(400);
const rect = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const cdp = await page.createCDPSession();
const px = async (pts) => {
  const s = (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
  return page.evaluate(async (s, pts) => {
    const blob = await (await fetch('data:image/png;base64,' + s)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
    return pts.map(([x, y]) => { const i = (Math.round(y) * bmp.width + Math.round(x)) * 4; return `${x},${y}=${d[i]},${d[i + 1]},${d[i + 2]}`; });
  }, s, pts);
};
const pts = [[rect.x + 160, rect.y + 1], [rect.x + 160, rect.y + 2], [rect.x + 160, rect.y + 4], [rect.x + 2, rect.y + 190], [rect.x + 160, rect.y + 250]];

await page.evaluate(() => window.__gevEdge.on()); await sleep(500);
console.log('S0 on     ', (await px(pts)).join('  '));
await page.evaluate(() => window.__gevEdge.off()); await sleep(450);
console.log('S0 off    ', (await px(pts)).join('  '));

/* S1: canvas 自身涂红 —— 元素是否被绘制 */
await page.evaluate(() => { const s = document.createElement('style'); s.id = 'pz-red';
  s.textContent = '#gev-edge-lens{background:#ff0000 !important;z-index:8 !important}'; document.head.appendChild(s); });
await sleep(500);
console.log('S1 redbg  ', (await px(pts)).join('  '));
await page.evaluate(() => document.getElementById('pz-red').remove());

/* S2: 卡壳与伪元素全透明 + 去掉阴影 → 再看 on/off */
await page.evaluate(() => { const s = document.createElement('style'); s.id = 'pz-nocard';
  s.textContent = '#data-panel,#data-panel::before,#data-panel::after{background:transparent!important;box-shadow:none!important;backdrop-filter:none!important;filter:none!important;border:0!important}';
  document.head.appendChild(s); });
await sleep(400);
await page.evaluate(() => window.__gevEdge.on()); await sleep(500);
console.log('S2 on     ', (await px(pts)).join('  '));
await page.evaluate(() => window.__gevEdge.off()); await sleep(450);
console.log('S2 off    ', (await px(pts)).join('  '));

/* S3: 上一层世界叠加 canvas 隐藏（看是否它盖住） */
await page.evaluate(() => document.getElementById('pz-nocard').remove());
await page.evaluate(() => { const s = document.createElement('style'); s.id = 'pz-wo';
  s.textContent = '#world-overlay-root,#gev-screen-whiteboard{display:none!important}'; document.head.appendChild(s); });
await page.evaluate(() => window.__gevEdge.on()); await sleep(500);
console.log('S3 on(noWO)', (await px(pts)).join('  '));
await page.evaluate(() => window.__gevEdge.off()); await sleep(450);
console.log('S3 off     ', (await px(pts)).join('  '));
await page.evaluate(() => document.getElementById('pz-wo').remove());
await browser.close();
