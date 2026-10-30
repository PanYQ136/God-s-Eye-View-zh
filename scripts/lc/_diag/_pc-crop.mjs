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
const r = await p.evaluate(() => { const q = document.getElementById('data-panel').getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; });
/* 裁到卡左上角 60x30 区域，存 4 份对照图 */
const crop = async (name) => {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const out = await p.evaluate(async (b64, r) => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = 60 * 6; cv.height = 30 * 6;
    const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false;
    cx.drawImage(bmp, Math.round(r.x - 6), Math.round(r.y - 6), 60, 30, 0, 0, 60 * 6, 30 * 6);
    return cv.toDataURL('image/png');
  }, data, r);
  writeFileSync(`.gev-logs/lc/phase6c/cmp-${name}.png`, Buffer.from(String(out).split(',')[1], 'base64'));
  console.log('saved', name);
};
await crop('1-on-default');
await p.evaluate(() => window.__gevEdge.set({ bandAlpha: 1 }));
await sleep(900); await crop('2-bandAlpha1');
await p.evaluate(() => window.__gevEdge.set({ bandAlpha: 1, gain: 0, dispPx: 0, blurPx: 0 }));
await sleep(900); await crop('3-bandAlpha1-flat');
await p.evaluate(() => window.__gevEdge.off());
await sleep(700); await crop('4-lens-off');
await b.close();
