#!/usr/bin/env node
/* READ-ONLY review probe 2: does canvas->screen loss come from the 1.25x compositor
   upscale (canvas 1348 vs display 1685) or from an alpha compositing bug?
   Compare the same top-edge profile at lens scale 1.0 vs 1.25 (1:1 with device px). */
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
});
await sleep(1600);
const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });

const grabCanvas = () => page.evaluate(async () => {
  const cv = document.getElementById('gev-edge-lens');
  const bmp = await createImageBitmap(await (await fetch(cv.toDataURL('image/png'))).blob());
  const c2 = document.createElement('canvas'); c2.width = bmp.width; c2.height = bmp.height;
  const cx = c2.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
  const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
  return { w: bmp.width, h: bmp.height, d: Array.from(d) };
});
const decode = async (b64) => {
  await page.evaluate(async (b) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b)).blob());
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
    window.__rev = { w: bmp.width, h: bmp.height, d: Array.from(x.getImageData(0, 0, bmp.width, bmp.height).data) };
  }, b64);
  return page.evaluate(() => window.__rev);
};
const prof = (cv, rect, onImg, offImg, W2, K) => {
  const cwpx = cv.w / W2;                    // canvas px per CSS px
  const rowTop = Math.round(rect.y * cwpx);
  const x0 = Math.round((rect.x + rect.w * 0.3) * cwpx), x1 = Math.round((rect.x + rect.w * 0.7) * cwpx);
  const out = [];
  for (let dy = -1; dy <= 8; dy++) {
    let s = 0, n = 0, amax = 0;
    for (let x = x0; x < x1; x++) {
      const i = ((rowTop + dy) * cv.w + x) * 4;
      const a = cv.d[i + 3] / 255;
      const lum = 0.2126 * cv.d[i] + 0.7152 * cv.d[i + 1] + 0.0722 * cv.d[i + 2];
      s += Math.abs(a * (lum - 128)); n++; amax = Math.max(amax, a);
    }
    /* screen: same rows in device px */
    let ss = 0, nn = 0;
    for (let dy2 = 0; dy2 < Math.max(1, Math.round(K)); dy2++) {
      const y = Math.round((rect.y + dy) * K) + dy2;
      for (let x = Math.round((rect.x + rect.w * 0.3) * K); x < Math.round((rect.x + rect.w * 0.7) * K); x++) {
        const i = (y * onImg.w + x) * 4;
        const dOn = 0.2126 * onImg.d[i] + 0.7152 * onImg.d[i + 1] + 0.0722 * onImg.d[i + 2];
        const dOff = 0.2126 * offImg.d[i] + 0.7152 * offImg.d[i + 1] + 0.0722 * offImg.d[i + 2];
        ss += Math.abs(dOn - dOff); nn++;
      }
    }
    out.push({ dy, aMax: +amax.toFixed(3), canvas: +(s / n).toFixed(2), screen: +(ss / nn).toFixed(2) });
  }
  return out;
};

const run = async (label, scale) => {
  await page.evaluate((s) => window.__gevEdge.set({ scale: s }), scale);
  await sleep(1200);
  const on = await decode(await shot());
  const cv = await grabCanvas();
  await page.evaluate(() => window.__gevEdge.off());
  await sleep(700);
  const off = await decode(await shot());
  await page.evaluate(() => window.__gevEdge.on());
  await sleep(600);
  const K = on.w / W;
  const stats = await page.evaluate(() => { const s = window.__gevEdge.stats(); return { scale: s.scale, canvas: s.canvas }; });
  console.log('=== ' + label + ' scale(arg)=' + scale + ' lens.scale=' + stats.scale + ' canvas=' + JSON.stringify(stats.canvas) + ' shot=' + on.w + 'x' + on.h + ' K=' + K);
  console.log(JSON.stringify(prof(cv, r, on, off, W, K)));
};
await run('A scale=1.0 (default)', 1);
await run('B scale=1.25 (1:1 device)', 1.25);
await browser.close();
