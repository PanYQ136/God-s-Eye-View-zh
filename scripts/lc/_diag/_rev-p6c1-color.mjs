#!/usr/bin/env node
/* READ-ONLY review probe 4: characterize Page.captureScreenshot colour transfer.
   Inject three known patches (0 / 128 / 255) and read them back from the screenshot. */
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
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
await sleep(4000);
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
await page.evaluate(() => {
  const mk = (id, bg, x) => {
    const d = document.createElement('div'); d.id = id;
    d.style.cssText = `position:fixed;left:${x}px;top:300px;width:120px;height:120px;background:${bg};z-index:99999`;
    document.body.appendChild(d);
  };
  mk('rev-p0', '#000000', 20);
  mk('rev-p128', '#808080', 160);
  mk('rev-p255', '#ffffff', 300);
});
await sleep(600);
const b64 = await shot();
const res = await page.evaluate(async (b) => {
  const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b)).blob());
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
  const d = x.getImageData(0, 0, bmp.width, bmp.height).data;
  const K = bmp.width / innerWidth;
  const at = (cx, cy) => { const i = (Math.round(cy * K) * bmp.width + Math.round(cx * K)) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
  /* straight (no colour conversion) decode too, to compare */
  const bmp2 = await createImageBitmap(new Blob([new Uint8Array(await (await fetch('data:image/png;base64,' + b)).blob().then(x=>x.arrayBuffer()))], { type: 'image/png' }), { colorSpaceConversion: 'none' });
  const c2 = document.createElement('canvas'); c2.width = bmp2.width; c2.height = bmp2.height;
  const x2 = c2.getContext('2d', { willReadFrequently: true }); x2.drawImage(bmp2, 0, 0);
  const d2 = x2.getImageData(0, 0, bmp2.width, bmp2.height).data;
  const at2 = (cx, cy) => { const i = (Math.round(cy * K) * bmp2.width + Math.round(cx * K)) * 4; return [d2[i], d2[i + 1], d2[i + 2], d2[i + 3]]; };
  return {
    size: [bmp.width, bmp.height], K,
    default: { p0: at(80, 360), p128: at(220, 360), p255: at(360, 360) },
    noColorConversion: { p0: at2(80, 360), p128: at2(220, 360), p255: at2(360, 360) },
    colorSpace: bmp.colorSpace || null,
  };
}, b64);
console.log(JSON.stringify(res, null, 1));
await browser.close();
