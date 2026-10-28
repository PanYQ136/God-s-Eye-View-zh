#!/usr/bin/env node
/* 试 CDP Page.captureScreenshot 的 clip.scale 做真实 4x/8x 栅格化（dsf 保持 1） */
import puppeteer from 'puppeteer';
const URL = 'http://127.0.0.1:4173/';
const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'],
  protocolTimeout: 300000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 120; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break;
  await sleep(400);
}
await sleep(7000);
// 真鼠标点开 data-panel
const pt = await page.evaluate(() => {
  const b = document.querySelector('#data-panel .panel-header').getBoundingClientRect();
  return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
});
await page.mouse.move(pt.x, pt.y, { steps: 3 });
await page.mouse.down(); await sleep(30); await page.mouse.up();
await sleep(1300);
const r = await page.evaluate(() => {
  const b = document.getElementById('data-panel').getBoundingClientRect();
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), phase: window.__lc.api.phases()['data-panel'] };
});
console.log('rect', JSON.stringify(r));
const cdp = await page.createCDPSession();
for (const scale of [1, 4, 8]) {
  const clip = { x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6), width: 120, height: 90, scale };
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
  const st = await page.evaluate(async (data) => {
    const blob = await (await fetch('data:image/png;base64,' + data)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let sum = 0, sum2 = 0, n = 0, chromaMax = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l; sum2 += l * l; n++;
      chromaMax = Math.max(chromaMax, Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]));
    }
    const mean = sum / n;
    return { w: bmp.width, h: bmp.height, mean: +mean.toFixed(1), sd: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(2), chromaMax };
  }, data);
  console.log(`scale=${scale}`, JSON.stringify(st));
}
await browser.close();
