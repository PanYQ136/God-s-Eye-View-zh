#!/usr/bin/env node
/* Phase7B 诊断：把 band 内 Δ(R−B) 的空间分布打成数字网格，判断「1px 彩色亮线」到底存不存在、
   以及它落在什么样的 alpha/位置（避免用 max2d 这种单像素读数自欺）。 */
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
await sleep(7000);
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
await page.mouse.move(4, 700, { steps: 3 }); await sleep(600);
const cfg = await page.evaluate(() => window.__gevEdge.cfg());
console.log('cfg dispPx', cfg.dispPx, 'gain', cfg.dispGain, 'cap', (cfg.dispCap * 255).toFixed(1));

await page.evaluate(() => {
  window.__p7grid = async (a, b, rect, edgePx, axis, bandPx, dir) => {
    const dec = async (x) => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + x)).blob());
      const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
      return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
    };
    const A = await dec(a), B = await dec(b);
    const out = [];
    const lo = axis === 'y' ? Math.round(rect.x + rect.w * 0.35) : Math.round(rect.y + rect.h * 0.35);
    const hi = axis === 'y' ? Math.round(rect.x + rect.w * 0.65) : Math.round(rect.y + rect.h * 0.65);
    for (let k = 0; k < bandPx; k++) {
      const p = Math.round(edgePx) + k * dir;
      const row = [];
      for (let u = lo; u < hi; u += 4) {
        const i = axis === 'y' ? (p * A.w + u) * 4 : (u * A.w + p) * 4;
        row.push((A.d[i] - B.d[i]) - (A.d[i + 2] - B.d[i + 2]));
      }
      out.push(row);
    }
    return out;
  };
});
const rects = await page.evaluate(() => {
  const s = window.__gevEdge.stats();
  return (s.surfaces || []).map((x) => {
    const el = document.getElementById(x.id); const r = el && el.getBoundingClientRect();
    return r ? { id: x.id, x: r.x, y: r.y, w: r.width, h: r.height, band: x.band } : null;
  }).filter(Boolean);
});
for (const target of ['data-panel', 'location-bar']) {
  const cd = rects.find((r) => r.id === target);
  if (!cd) continue;
  await page.evaluate(() => window.__gevEdge.set({ dispGain: 8.0 }));
  await sleep(600);
  const a = await shot();
  await page.evaluate(() => window.__gevEdge.set({ dispGain: 1.0 }));
  await sleep(600);
  const b = await shot();
  await page.evaluate(() => window.__gevEdge.set({ dispGain: 8.0 }));
  const gridL = await page.evaluate((a, b, cd) => window.__p7grid(a, b, cd, cd.x, 'x', cd.band, 1), a, b, cd);
  const gridB = await page.evaluate((a, b, cd) => window.__p7grid(a, b, cd, cd.y + cd.h, 'y', cd.band, -1), a, b, cd);
  const fmt = (g) => g.map((row, k) => `k${String(k).padStart(2)} ` + row.map((v) => String(v).padStart(4)).join('')).join('\n');
  console.log(`\n=== ${target} LEFT (axis x, dir +1, band ${cd.band}) Δ(R−B) 每 4px 采样 ===\n` + fmt(gridL));
  console.log(`\n=== ${target} BOTTOM (axis y, dir -1) ===\n` + fmt(gridB));
}
await browser.close();
