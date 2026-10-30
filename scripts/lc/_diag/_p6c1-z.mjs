/* Phase6C1 探针5：z-index 试穿 —— 折射层被谁盖住 */
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
const wo = await page.evaluate(() => {
  const r = document.getElementById('world-overlay-root');
  const kids = [...r.children].map((e) => { const s = getComputedStyle(e); const b = e.getBoundingClientRect();
    return { tag: e.tagName, id: e.id, z: s.zIndex, op: s.opacity, bg: s.backgroundColor, size: Math.round(b.width) + 'x' + Math.round(b.height) }; });
  const s = getComputedStyle(r);
  return { root: { z: s.zIndex, bg: s.backgroundColor, op: s.opacity, pe: s.pointerEvents }, kids };
});
console.log('world-overlay-root:', JSON.stringify(wo));
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const prof = (a, b) => page.evaluate(async (a, b, rect) => {
  const dec = async (s) => {
    const blob = await (await fetch('data:image/png;base64,' + s)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width };
  };
  const A = await dec(a), B = await dec(b);
  const x0 = Math.round(rect.x + rect.w * 0.35), x1 = Math.round(rect.x + rect.w * 0.65);
  const out = [];
  for (let k = -2; k <= 10; k++) {
    const y = Math.round(rect.y + k);
    let s = 0, n = 0, on = 0, off = 0;
    for (let x = x0; x < x1; x++) {
      const i = (y * A.w + x) * 4;
      s += Math.abs(0.2126 * (A.d[i] - B.d[i]) + 0.7152 * (A.d[i + 1] - B.d[i + 1]) + 0.0722 * (A.d[i + 2] - B.d[i + 2]));
      on += A.d[i]; off += B.d[i]; n++;
    }
    out.push({ k, d: +(s / n).toFixed(1), on: Math.round(on / n), off: Math.round(off / n) });
  }
  return out;
}, a, b, rect);
const line = (arr) => arr.map((o) => `k${o.k}:Δ${o.d}[${o.off}->${o.on}]`).join(' ');

for (const z of [4, 8, 149]) {
  await page.evaluate((z) => { document.getElementById('gev-edge-lens').style.zIndex = String(z); }, z);
  await sleep(400);
  await page.evaluate(() => window.__gevEdge.on());
  await sleep(500);
  const on = await shot();
  await page.evaluate(() => window.__gevEdge.off()); await sleep(450);
  const off = await shot();
  await page.evaluate(() => window.__gevEdge.on()); await sleep(400);
  console.log(`z=${z}`.padEnd(6), line(await prof(on, off)));
}
await browser.close();
