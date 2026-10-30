import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
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
const info = () => p.evaluate(() => {
  const cv = document.getElementById('gev-edge-lens');
  const s = window.__gevEdge.stats();
  return { n: document.querySelectorAll('#gev-edge-lens').length, inlineOp: cv.style.opacity, compOp: getComputedStyle(cv).opacity,
    bodyOp: getComputedStyle(document.body).opacity, htmlCls: document.documentElement.className, frames: s.frames, err: s.err,
    canvasWH: [cv.width, cv.height], cssWH: [cv.style.width, cv.style.height], z: getComputedStyle(cv).zIndex };
});
console.log('state1', JSON.stringify(await info()));
/* 只露折射层（其余全隐藏），再强制 opacity 1 */
await p.evaluate(() => {
  const s = document.createElement('style'); s.id = 'pc-iso2';
  s.textContent = '*{visibility:hidden!important} body{background:#202020!important} #gev-edge-lens{visibility:visible!important;opacity:1!important}';
  document.head.appendChild(s);
});
await sleep(1000);
console.log('state2', JSON.stringify(await info()));
const grab = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(`.gev-logs/lc/phase6c/${name}.png`, Buffer.from(data, 'base64'));
  return data;
};
const r = await p.evaluate(() => { const q = document.getElementById('data-panel').getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; });
const prof = (b64) => p.evaluate(async (b64, r) => {
  const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
  const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
  const rows = [];
  for (let k = -2; k <= 16; k++) {
    let s = 0, n = 0;
    for (let x = Math.round(r.x + r.w * 0.3); x < Math.round(r.x + r.w * 0.7); x++) {
      const i = ((Math.round(r.y) + k) * bmp.width + x) * 4;
      s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++;
    }
    rows.push(+(s / n).toFixed(1));
  }
  return rows;
}, b64, r);
console.log('rect', JSON.stringify(r));
console.log('lensOnly ON rows:', JSON.stringify(await prof(await grab('iso2-on'))));
await p.evaluate(() => window.__gevEdge.off());
await sleep(800);
console.log('lensOnly OFF rows:', JSON.stringify(await prof(await grab('iso2-off'))));
await p.evaluate(() => window.__gevEdge.on());
await sleep(800);
/* 现在的 CFG 参数 */
console.log('cfg', JSON.stringify(await p.evaluate(() => { const c = window.__gevEdge.cfg(); return { band: c.band, thick: c.thick, gain: c.gain, dispPx: c.dispPx, rimAmt: c.rimAmt, bandAlpha: c.bandAlpha, lensPow: c.lensPow, enabled: c.enabled }; })));
await b.close();
