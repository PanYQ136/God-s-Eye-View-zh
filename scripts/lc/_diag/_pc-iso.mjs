import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1348, H = 774;
const b = await puppeteer.launch({
  headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'],
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const p = await b.newPage();
await p.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch {} });
await p.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'load' });
for (let i = 0; i < 100; i++) { if (await p.evaluate(() => !!(window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => 0)) break; await sleep(400); }
await sleep(5000);
const cdp = await p.createCDPSession();
console.log('layers', JSON.stringify(await p.evaluate(() => {
  const c = document.getElementById('gev-edge-lens');
  const st = getComputedStyle(c);
  const cc = document.getElementById('cesiumContainer');
  const cvs = document.querySelector('#cesiumContainer canvas');
  const info = (el) => el ? { z: getComputedStyle(el).zIndex, pos: getComputedStyle(el).position, op: getComputedStyle(el).opacity } : null;
  return { lens: info(c), lensRect: c.getBoundingClientRect().toJSON(), cesium: info(cc), cesiumCanvas: info(cvs), bodyBg: getComputedStyle(document.body).backgroundColor };
})));
/* 只看折射层：地图/卡片/所有 UI 全部隐藏 */
await p.evaluate(() => {
  const s = document.createElement('style');
  s.id = 'pc-iso';
  s.textContent = 'body *{visibility:hidden!important} #gev-edge-lens{visibility:visible!important}';
  document.head.appendChild(s);
  document.body.style.background = '#202020';
});
await sleep(1200);
const r = await p.evaluate(() => { const q = document.getElementById('data-panel').getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; });
const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
const out = await p.evaluate(async (b64, r) => {
  const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
  const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
  const rows = [];
  for (let k = 0; k <= 16; k++) {
    let s = 0, n = 0;
    for (let x = Math.round(r.x + r.w * 0.3); x < Math.round(r.x + r.w * 0.7); x++) {
      const i = ((Math.round(r.y) + k) * bmp.width + x) * 4;
      s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++;
    }
    rows.push(+(s / n).toFixed(1));
  }
  const i2 = ((Math.round(r.y + r.h / 2)) * bmp.width + Math.round(r.x + r.w / 2)) * 4;
  return { rows, center: [d[i2], d[i2 + 1], d[i2 + 2]] };
}, data, r);
console.log('rect', JSON.stringify(r));
console.log('LENS-ONLY rows 0..16 :', JSON.stringify(out.rows));
console.log('card center px (should be body 32,32,32):', JSON.stringify(out.center));
(await import('node:fs')).writeFileSync('.gev-logs/lc/phase6c/iso-lens.png', Buffer.from(data, 'base64'));
await p.evaluate(() => window.__gevEdge.off());
await sleep(700);
const { data: d2 } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
const out2 = await p.evaluate(async (b64, r) => {
  const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
  const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
  const rows = [];
  for (let k = 0; k <= 16; k++) {
    let s = 0, n = 0;
    for (let x = Math.round(r.x + r.w * 0.3); x < Math.round(r.x + r.w * 0.7); x++) {
      const i = ((Math.round(r.y) + k) * bmp.width + x) * 4;
      s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++;
    }
    rows.push(+(s / n).toFixed(1));
  }
  return rows;
}, d2, r);
console.log('LENS-OFF  rows 0..16 :', JSON.stringify(out2));
await b.close();
