#!/usr/bin/env node
/* Phase6C5 真实地图：色散 on/off 贡献 + 4x/8x 样张（dp 1.0 / 2.4 / 3.0 / 6.0） */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] || 'e';
const W = 1348, VH = 774;
const OUT = '.gev-logs/lc/phase6c5';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COMBOS = [[1.0,1.0],[2.4,1.0],[2.4,3.0],[2.4,5.0],[2.4,8.0]];

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${VH + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: VH, deviceScaleFactor: 1 },
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
await sleep(6000);
const cdp = await page.createCDPSession();
console.log('GPU', await page.evaluate(() => (window.__gevGpu ? window.__gevGpu.probe().renderer : null)));
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const clickHeader = async (id) => {
  const p = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const t = el.querySelector('.panel-header,.pp-header-row') || el;
    const b = t.getBoundingClientRect();
    return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
  }, id);
  await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(80);
  await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1000);
};
const park = async () => { await page.mouse.move(4, 700, { steps: 3 }); await sleep(400); };
await park(); await clickHeader('data-panel'); await park(); await clickHeader('pp-toggles'); await park();

const rects = await page.evaluate(() => {
  const g = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  return { data: g('data-panel'), pp: g('pp-toggles') };
});
console.log('RECT', JSON.stringify(rects));

await page.evaluate(() => {
  const dec = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height, K: bmp.width / innerWidth };
  };
  window.__c5dis = async (onB64, offB64, rectCss) => {
    const A = await dec(onB64), B = await dec(offB64);
    const K = A.K, r = { x: rectCss.x * K, y: rectCss.y * K, w: rectCss.w * K, h: rectCss.h * K };
    const side = (edge, axis, dir) => {
      const prof = [];
      for (let k = 0; k <= 12; k++) {
        const a = Math.round(edge + k * dir);
        let mx = 0, sum = 0, n = 0;
        const lo = axis === 'y' ? Math.round(r.x + r.w * 0.3) : Math.round(r.y + r.h * 0.3);
        const hi = axis === 'y' ? Math.round(r.x + r.w * 0.7) : Math.round(r.y + r.h * 0.7);
        for (let t = Math.min(a, a + dir); t < Math.max(a, a + dir); t++) {
          for (let u = lo; u < hi; u++) {
            const i = axis === 'y' ? (t * A.w + u) * 4 : (u * A.w + t) * 4;
            const v = Math.abs((A.d[i] - B.d[i]) - (A.d[i + 2] - B.d[i + 2]));
            sum += v; if (v > mx) mx = v; n++;
          }
        }
        prof.push(n ? +(sum / n).toFixed(2) : 0);
      }
      return prof;
    };
    const bm = (p) => +(p.slice(0, 10).reduce((a, b) => a + b, 0) / 10).toFixed(2);
    const top = side(r.y, 'y', 1), left = side(r.x, 'x', 1), bot = side(r.y + r.h, 'y', -1), right = side(r.x + r.w, 'x', -1);
    return { top: bm(top), left: bm(left), bot: bm(bot), right: bm(right), maxTop: Math.max(...top.slice(0, 10)), profTop: top };
  };
  window.__c5crop = async (b64, box, s) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const K = bmp.width / innerWidth;
    const cv = document.createElement('canvas');
    cv.width = Math.round(box.w * K * s); cv.height = Math.round(box.h * K * s);
    const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false;
    cx.drawImage(bmp, Math.round(box.x * K), Math.round(box.y * K), Math.round(box.w * K), Math.round(box.h * K), 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/png');
  };
});
const out = { rects, real: {}, errs: [] };
const boxTop = { x: rects.pp.x + Math.round(rects.pp.w * 0.25), y: rects.pp.y - 3, w: 160, h: 18 };
const boxCorner = { x: rects.pp.x - 4, y: rects.pp.y - 4, w: 44, h: 44 };
for (const [dp,gn] of COMBOS) {
  await page.evaluate(([dp,gn]) => window.__gevEdge.set({ dispPx: dp, dispGain: gn }), [dp,gn]);
  await park(); await sleep(900);
  const on1 = await shot();
  const f = `${OUT}/c5-${TAG}-pp-dp${String(dp).replace('.', 'p')}-g${String(gn).replace('.', 'p')}`;
  writeFileSync(`${f}-1x.png`, Buffer.from(on1, 'base64'));
  for (const [nm, box, s] of [['top8x', boxTop, 8], ['top4x', boxTop, 4], ['corner8x', boxCorner, 8]]) {
    const u = await page.evaluate((b64, box, s) => window.__c5crop(b64, box, s), on1, box, s);
    writeFileSync(`${f}-${nm}.png`, Buffer.from(String(u).split(',')[1], 'base64'));
  }
  await page.evaluate(() => window.__gevEdge.off()); await sleep(600);
  const off = await shot();
  await page.evaluate(() => window.__gevEdge.on()); await sleep(700);
  const m = await page.evaluate((a, b, r) => window.__c5dis(a, b, r), on1, off, rects.pp);
  out.real['dp' + dp + '_g' + gn] = m;
  console.log('realmap pp dp' + dp + ' gain' + gn, 'on/off Δ(R−B) bandMean top/left/bot/right', m.top, m.left, m.bot, m.right, 'maxTop', m.maxTop, 'prof', m.profTop.slice(0, 6).join(','));
}
writeFileSync(`${OUT}/c5-${TAG}.json`, JSON.stringify(out, null, 2));
await browser.close();
