#!/usr/bin/env node
/* 探测：不同 deviceScaleFactor 下截图是否真的拍到内容（亮度方差 + 非黑像素占比） */
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
for (const dsf of [1, 2, 3, 4, 6, 8]) {
  const p = await browser.newPage();
  await p.setViewport({ width: W, height: H, deviceScaleFactor: dsf });
  await p.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
  for (let i = 0; i < 120; i++) {
    if (await p.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break;
    await sleep(400);
  }
  await sleep(6000);
  const b64 = await p.screenshot({ clip: { x: 40, y: 88, width: 120, height: 90 }, encoding: 'base64' });
  const st = await p.evaluate(async (b64) => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let sum = 0, sum2 = 0, nonblack = 0, n = 0, chromaMax = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l; sum2 += l * l; n++;
      if (l > 8) nonblack++;
      chromaMax = Math.max(chromaMax, Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]));
    }
    const mean = sum / n;
    return { w: bmp.width, h: bmp.height, mean: +mean.toFixed(1), sd: +Math.sqrt(sum2 / n - mean * mean).toFixed(2), nonblackPct: +((nonblack / n) * 100).toFixed(1), chromaMax };
  }, b64);
  console.log(`dsf=${dsf}`, JSON.stringify(st));
  await p.close();
}
await browser.close();
