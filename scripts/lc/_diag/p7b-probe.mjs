#!/usr/bin/env node
/* Phase7B 探针：卡片清单 + 地图运动噪声 + 冻结可行性 */
import puppeteer from 'puppeteer';
const BASE = 'http://127.0.0.1:4174/?welcome=0';
const W = 1348, VH = 774;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${VH + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  protocolTimeout: 600000, defaultViewport: { width: W, height: VH, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});
await page.goto(`${BASE}&t=${Date.now()}`, { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false)) break;
  await sleep(400);
}
await sleep(5000);
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
await page.mouse.move(4, 700, { steps: 3 }); await sleep(500);

const info = await page.evaluate(() => {
  const lc = [...document.querySelectorAll('.gev-lc')].map((el) => {
    const r = el.getBoundingClientRect();
    return { id: el.id, cls: el.className, w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  });
  const s = window.__gevEdge.stats();
  const surf = (s.surfaces || []).map((x) => x.id);
  const missing = surf.filter((id) => !lc.some((c) => c.id === id));
  const rects = Object.fromEntries(surf.map((id) => {
    const el = document.getElementById(id); const r = el && el.getBoundingClientRect();
    return [id, r ? { w: +r.width.toFixed(1), h: +r.height.toFixed(1) } : null];
  }));
  return { lcCount: lc.length, lc, surf, surfCount: surf.length, missing, rects,
    hasViewer: !!window.__gevViewer, clock: !!(window.__gevViewer && window.__gevViewer.clock),
    shouldAnimate: !!(window.__gevViewer && window.__gevViewer.clock && window.__gevViewer.clock.shouldAnimate),
    canvases: [...document.querySelectorAll('canvas')].map((c) => ({ id: c.id || c.className, w: c.width, h: c.height })) };
});
console.log(JSON.stringify(info, null, 1));

await page.evaluate(() => {
  window.__p7diff = async (a, b) => {
    const dec = async (x) => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + x)).blob());
      const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
      return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
    };
    const A = await dec(a), B = await dec(b);
    let s = 0, n = 0, mx = 0, big = 0;
    for (let i = 0; i < A.d.length; i += 4) {
      const dl = Math.abs(0.2126 * (A.d[i] - B.d[i]) + 0.7152 * (A.d[i + 1] - B.d[i + 1]) + 0.0722 * (A.d[i + 2] - B.d[i + 2]));
      const rb = Math.abs((A.d[i] - B.d[i]) - (A.d[i + 2] - B.d[i + 2]));
      s += rb; n++; if (rb > mx) mx = rb; if (Math.abs(dl) > 2) big++;
    }
    return { rbMean: +(s / n).toFixed(3), rbMax: mx, lumBigFrac: +(big / n).toFixed(4), n };
  };
});
const d1 = await shot(), d2 = await shot();
console.log('free-run  diff', JSON.stringify(await page.evaluate((a, b) => window.__p7diff(a, b), d1, d2)));

const frozen = await page.evaluate(() => {
  try {
    const v = window.__gevViewer;
    if (!v) return 'no viewer';
    v.clock.shouldAnimate = false;
    v.clock.multiplier = 0;
    if (v.scene && v.scene.screenSpaceCameraController) v.scene.screenSpaceCameraController.enableInputs = false;
    v.scene.requestRenderMode = true;
    v.scene.requestRender();
    return 'frozen';
  } catch (e) { return 'err ' + e.message; }
});
console.log('freeze:', frozen);
await sleep(2500);
const f1 = await shot(), f2 = await shot();
console.log('frozen     diff', JSON.stringify(await page.evaluate((a, b) => window.__p7diff(a, b), f1, f2)));
await browser.close();
