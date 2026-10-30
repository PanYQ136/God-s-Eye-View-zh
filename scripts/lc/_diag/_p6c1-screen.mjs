/* Phase6C1 探针3：屏幕级（真正合成结果）on/off Δ —— 真实底图 + 平坦128底 两种。
   对比同一帧的折射 canvas 自读，判定「画了没合成」还是「画得太弱」。 */
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
await sleep(4500);
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
  await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1300);
}
ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
await page.evaluate(() => { const v = (window.__godsEyeView && window.__godsEyeView.viewer) || window.__gevViewer; if (v) v.useDefaultRenderLoop = false; });
await sleep(1000);
await page.evaluate(() => { const s = document.createElement('style'); s.id = 'pc-blank'; s.textContent = '#data-panel > *{visibility:hidden!important}'; document.head.appendChild(s); });
await sleep(500);
const rect = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;

/* 屏幕 Δ：Top 剖面 k=-3..12，直接读截图像素平均 */
const prof = (a, b, rect, which) => page.evaluate(async (a, b, rect, which) => {
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
  for (let k = -3; k <= 12; k++) {
    const y = Math.round((which === 'bottom' ? rect.y + rect.h : rect.y) + k);
    let s = 0, n = 0, absA = 0, absB = 0;
    for (let x = x0; x < x1; x++) {
      const i = (y * A.w + x) * 4;
      const dr = A.d[i] - B.d[i], dg = A.d[i + 1] - B.d[i + 1], db = A.d[i + 2] - B.d[i + 2];
      s += Math.abs(0.2126 * dr + 0.7152 * dg + 0.0722 * db); n++;
      absA += A.d[i]; absB += B.d[i];
    }
    out.push({ k, d: +(s / n).toFixed(1), on: Math.round(absA / n), off: Math.round(absB / n) });
  }
  return out;
}, a, b, rect, which);

const canvasRow = async (x, y, w) => {
  await page.evaluate((g) => { window.__gevEdgeGrab = g; window.__gevEdgeGrabOut = null; window.__gevEdge.on(); }, { x, y, w });
  for (let i = 0; i < 40; i++) { const o = await page.evaluate(() => window.__gevEdgeGrabOut); if (o) return o; await sleep(50); }
  return { err: 'timeout' };
};
const midX = Math.round(rect.x + rect.w * 0.5);
const R = { phase: ph, rect };

/* ── A：真实底图 ── */
const onA = await shot();
await page.evaluate(() => window.__gevEdge.off()); await sleep(500);
const offA = await shot();
await page.evaluate(() => window.__gevEdge.on()); await sleep(600);
R.real = { top: await prof(onA, offA, rect, 'top'), canvas: await canvasRow(midX, Math.round(rect.y + 2), 8), canvasY1: await canvasRow(midX, Math.round(rect.y + 1), 8) };
writeFileSync(`${OUT}/p3-on.png`, Buffer.from(onA, 'base64'));
writeFileSync(`${OUT}/p3-off.png`, Buffer.from(offA, 'base64'));

/* ── B：平坦 128 灰底 ── */
await page.evaluate(() => window.__gevEdge.testBg(true, 8, 128)); await sleep(500);
const onB = await shot();
await page.evaluate(() => window.__gevEdge.off()); await sleep(500);
const offB = await shot();
await page.evaluate(() => window.__gevEdge.on()); await sleep(600);
R.flat = { top: await prof(onB, offB, rect, 'top'), canvas: await canvasRow(midX, Math.round(rect.y + 2), 8) };
writeFileSync(`${OUT}/p3-flat-on.png`, Buffer.from(onB, 'base64'));
writeFileSync(`${OUT}/p3-flat-off.png`, Buffer.from(offB, 'base64'));

const line = (arr) => arr.map((o) => `k${o.k}:d${o.d}(on${o.on}/off${o.off})`).join(' ');
console.log('phase', ph, 'rect', JSON.stringify(rect));
console.log('A real  top:', line(R.real.top));
console.log('A canvas y+1:', JSON.stringify(R.real.canvasY1.row));
console.log('A canvas y+2:', JSON.stringify(R.real.canvas.row));
console.log('B flat  top:', line(R.flat.top));
console.log('B canvas y+2:', JSON.stringify(R.flat.canvas.row));
writeFileSync(`${OUT}/probe3.json`, JSON.stringify(R, null, 1));
await browser.close();
