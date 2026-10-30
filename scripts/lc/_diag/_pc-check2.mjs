import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({
  headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const p = await b.newPage();
await p.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch {} });
await p.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'load' });
for (let i = 0; i < 100; i++) { if (await p.evaluate(() => !!(window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => 0)) break; await sleep(400); }
await sleep(4000);
const r = await p.evaluate(() => { const q = document.getElementById('data-panel').getBoundingClientRect(); return { x: Math.round(q.x), y: Math.round(q.y), w: Math.round(q.width), h: Math.round(q.height) }; });
console.log('rect', r);
/* 只让 data-panel 上边缘落进 lens；读 GL 画布真值 */
await p.evaluate(() => window.__gevEdge.testBg(true, 8, 100));
await sleep(1200);
const pts = [];
for (let k = 0; k <= 14; k++) pts.push([r.x + 60 + k * 0, r.y + k]);
const row = await p.evaluate((pts) => window.__gevEdge.readPixels(pts), pts);
console.log('lens px down the top edge (y+0..14) premultiplied RGBA:', JSON.stringify(row));
const row2 = await p.evaluate((r) => window.__gevEdge.readPixels([[r.x + 5, r.y + 5], [r.x + 60, r.y + 60], [r.x + 20, r.y + 3]]), r);
console.log('corner/inner:', JSON.stringify(row2));
/* 屏幕真值（CDP 4x 截图同一列） */
const cdp = await p.createCDPSession();
const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: r.x - 8, y: r.y - 8, width: 40, height: 30, scale: 4 }, captureBeyondViewport: false });
const prof = await p.evaluate(async (b64, y0) => {
  const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
  const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
  const out = [];
  for (let y = 0; y < bmp.height; y += 2) {
    let s = [0, 0, 0];
    for (let x = 0; x < bmp.width; x++) { const i = (y * bmp.width + x) * 4; s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
    out.push([Math.round(s[0] / bmp.width), Math.round(s[1] / bmp.width), Math.round(s[2] / bmp.width)]);
  }
  return out;
}, data, r.y);
console.log('screen rows (y-8..+22, step .5px):', JSON.stringify(prof));
await b.close();
