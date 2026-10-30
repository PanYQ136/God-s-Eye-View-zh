#!/usr/bin/env node
/* READ-ONLY review probe: is #gev-edge-lens getImageData premultiplied?
   Compares (1) canvas raw RGBA, (2) the gate-v2 formula a*(rgb-base),
   (3) straight-alpha formula rgb - a*base, (4) real screen delta from screenshot. */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1348, H = 774;
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
    && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
await sleep(4500);
await page.mouse.move(4, 400);
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(600);
let ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
if (ph !== 'open') {
  const p = await page.evaluate(() => {
    const el = document.getElementById('data-panel');
    const t = el.querySelector('.panel-header,.pp-header-row') || el;
    const b = t.getBoundingClientRect();
    return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
  });
  await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(80);
  await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1200);
}
const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
await page.evaluate(() => {
  const s = document.createElement('style'); s.id = 'pc-blank';
  s.textContent = '#data-panel > *{visibility:hidden!important}';
  document.head.appendChild(s);
  const d = document.createElement('div'); d.id = 'pc-under';
  d.style.cssText = 'position:fixed;inset:0;background:#808080;z-index:1;pointer-events:none';
  document.body.appendChild(d);
  window.__gevEdge.testBg(true, 8, 128);
});
await sleep(1600);
const onB64 = await shot();
const canvas = await page.evaluate(async () => {
  const cv = document.getElementById('gev-edge-lens');
  const url = cv.toDataURL('image/png');
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const c2 = document.createElement('canvas'); c2.width = bmp.width; c2.height = bmp.height;
  const cx = c2.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
  const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
  return { w: bmp.width, h: bmp.height, d: Array.from(d) };
});
await page.evaluate(() => window.__gevEdge.off());
await sleep(700);
const offB64 = await shot();
await page.evaluate(() => window.__gevEdge.on());

const dec = async (b64) => {
  await page.evaluate(async (b) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b)).blob());
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
    window.__rev = { w: bmp.width, h: bmp.height, d: Array.from(x.getImageData(0, 0, bmp.width, bmp.height).data) };
  }, b64);
  return page.evaluate(() => window.__rev);
};
const ON = await dec(onB64), OFF = await dec(offB64);
const K = ON.w / W;
const cw = canvas.w;
const row = Math.round((r.y + 1) * (cw / W));
const cx0 = Math.round((r.x + r.w * 0.3) * (cw / W)), cx1 = Math.round((r.x + r.w * 0.7) * (cw / W));
const out = [];
for (let dy = -1; dy <= 9; dy++) {
  const y = row + dy;
  let aMax = 0, aSum = 0, n = 0, rgbAt = null, best = 0;
  for (let x = cx0; x < cx1; x++) {
    const i = (y * cw + x) * 4;
    const a = canvas.d[i + 3] / 255;
    if (a > aMax) { aMax = a; best = x; }
    aSum += a; n++;
  }
  const i = (y * cw + best) * 4;
  const rgb = [canvas.d[i], canvas.d[i + 1], canvas.d[i + 2]], a = canvas.d[i + 3] / 255;
  const lumPremult = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  const gateFormula = +(a * (lumPremult - 128)).toFixed(2);          // gate-v2: treats rgb as straight
  const straightCol = a > 0 ? lumPremult / a : 0;                     // if rgb is premultiplied
  const straightFormula = +(a * (straightCol - 128)).toFixed(2);      // true premultiplied-over-128 contribution
  const sy = Math.round(y * K), sx = Math.round(best * K);
  const si = (sy * ON.w + sx) * 4, oi = si;
  const screenOn = 0.2126 * ON.d[si] + 0.7152 * ON.d[si + 1] + 0.0722 * ON.d[si + 2];
  const screenOff = 0.2126 * OFF.d[oi] + 0.7152 * OFF.d[oi + 1] + 0.0722 * OFF.d[oi + 2];
  out.push({ dy, a: +a.toFixed(3), rgba: [rgb[0], rgb[1], rgb[2], canvas.d[i + 3]], rgbIfStraight: +straightCol.toFixed(1),
    gateFormula, straightFormula, screenDelta: +(screenOn - screenOff).toFixed(2) });
}
console.log('canvas', cw + 'x' + canvas.h, 'screenshot', ON.w + 'x' + ON.h, 'K', K, 'row', row, 'rect', JSON.stringify(r));
console.log(JSON.stringify(out, null, 1));
const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
console.log('gpu', gpu && gpu.renderer, 'dpr', await page.evaluate(() => window.devicePixelRatio));
await browser.close();
