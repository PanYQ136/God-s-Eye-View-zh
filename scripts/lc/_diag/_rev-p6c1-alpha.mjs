#!/usr/bin/env node
/* READ-ONLY review probe 3: is the canvas->screen loss alpha-squared (compositing bug)
   or a constant/color-management factor? Compare the same peak pixel at bandAlpha=1 vs 0.55,
   and read the GL backbuffer (premultiplied) directly. */
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
await page.evaluate(() => {
  const s = document.createElement('style'); s.id = 'pc-blank';
  s.textContent = '#data-panel > *{visibility:hidden!important}';
  document.head.appendChild(s);
  const d = document.createElement('div'); d.id = 'pc-under';
  d.style.cssText = 'position:fixed;inset:0;background:#808080;z-index:1;pointer-events:none';
  document.body.appendChild(d);
  window.__gevEdge.testBg(true, 8, 128);
  window.__gevEdge.set({ scale: 1.25 });
});
await sleep(1600);
const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const decode = async (b64) => {
  await page.evaluate(async (b) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b)).blob());
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
    window.__rev = { w: bmp.width, h: bmp.height, d: Array.from(x.getImageData(0, 0, bmp.width, bmp.height).data) };
  }, b64);
  return page.evaluate(() => window.__rev);
};
const state = async (label) => {
  await sleep(1000);
  const on = await decode(await shot());
  const cv = await page.evaluate(async () => {
    const c = document.getElementById('gev-edge-lens');
    const bmp = await createImageBitmap(await (await fetch(c.toDataURL('image/png'))).blob());
    const c2 = document.createElement('canvas'); c2.width = bmp.width; c2.height = bmp.height;
    const x = c2.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
    return { w: bmp.width, h: bmp.height, d: Array.from(x.getImageData(0, 0, bmp.width, bmp.height).data) };
  });
  const K = on.w / W, s = 1.25;
  const rowTop = Math.round((r.y + 1) * s);
  const xs = Math.round((r.x + r.w * 0.3) * s), xe = Math.round((r.x + r.w * 0.7) * s);
  /* pick the brightest canvas row/px in the top band */
  let best = { v: -1 };
  for (let dy = 0; dy < 6; dy++) for (let x = xs; x < xe; x++) {
    const i = ((rowTop + dy) * cv.w + x) * 4;
    const a = cv.d[i + 3] / 255;
    const lum = 0.2126 * cv.d[i] + 0.7152 * cv.d[i + 1] + 0.0722 * cv.d[i + 2];
    const v = a * (lum - 128);
    if (v > best.v) best = { v, dy, x, rgba: [cv.d[i], cv.d[i + 1], cv.d[i + 2], cv.d[i + 3]], a, lum };
  }
  const cssY = r.y + 1 + best.dy / s;
  const cssX = best.x / s;
  const gl = await page.evaluate((p) => window.__gevEdge.readPixels([[p.x, p.y]]), { x: cssX, y: cssY });
  const si = (Math.round((r.y + 1 + best.dy / s) * K) * on.w + Math.round((best.x / s) * K)) * 4;
  const lumOn = 0.2126 * on.d[si] + 0.7152 * on.d[si + 1] + 0.0722 * on.d[si + 2];
  await page.evaluate(() => window.__gevEdge.off());
  await sleep(700);
  const off = await decode(await shot());
  await page.evaluate(() => window.__gevEdge.on());
  const lumOff = 0.2126 * off.d[si] + 0.7152 * off.d[si + 1] + 0.0722 * off.d[si + 2];
  console.log(label, JSON.stringify({
    canvasPeak: +best.v.toFixed(2), rgba: best.rgba, a: +best.a.toFixed(3), straightCol: +best.lum.toFixed(1),
    glBackbufferPremult: gl, screenOn: +lumOn.toFixed(1), screenOff: +lumOff.toFixed(1),
    screenDelta: +(lumOn - lumOff).toFixed(2),
    ratio_screen_over_canvas: +((lumOn - lumOff) / best.v).toFixed(3),
  }));
};
await state('bandAlpha=0.55(default)');
await page.evaluate(() => window.__gevEdge.set({ bandAlpha: 1 }));
await state('bandAlpha=1.00        ');
const st = await page.evaluate(() => { const s = window.__gevEdge.stats(); return { bandAlpha: s.bandAlpha, scale: s.scale, rimAmt: s.rimAmt, gain: s.gain }; });
console.log('cfg', JSON.stringify(st));
await browser.close();
