#!/usr/bin/env node
/* Phase6C5 诊断：色散链路增益（灰阶 2px 条纹上的 ΔR−ΔB）+ 真实地图 8x 肉眼样张
   node scripts/lc/phase6c5-diag.mjs [tag]
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] || 'd';
const W = 1348, VH = 774;
const OUT = '.gev-logs/lc/phase6c5';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DPS = [0, 1.0, 2.0, 2.4, 3.0, 6.0];

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
const gpu = await page.evaluate(() => (window.__gevGpu ? window.__gevGpu.probe().renderer : null));
console.log('GPU', gpu);
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
await park(); await clickHeader('data-panel'); await park();

const rData = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; });
console.log('RECT', JSON.stringify(rData));

await page.evaluate(() => {
  const s = document.createElement('style'); s.id = 'c5-blank';
  s.textContent = '#data-panel > *{visibility:hidden!important}';
  document.head.appendChild(s);
  window.__c5dec = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height, K: bmp.width / innerWidth };
  };
  /* 边缘带 ΔR−ΔB（on/off 差）：与 gate T13 同口径（band 内逐像素 max |ΔR−ΔB|，跨 30–70% 取均值/最大） */
  window.__c5dis = async (onB64, offB64, rectCss) => {
    const A = await window.__c5dec(onB64), B = await window.__c5dec(offB64);
    const K = A.K;
    const r = { x: rectCss.x * K, y: rectCss.y * K, w: rectCss.w * K, h: rectCss.h * K };
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
        prof.push(n ? +(sum / n).toFixed(2) : 0); prof.max = 0;
      }
      return prof;
    };
    const top = side(r.y, 'y', 1), left = side(r.x, 'x', 1), bot = side(r.y + r.h, 'y', -1), right = side(r.x + r.w, 'x', -1);
    const bm = (p) => +(p.slice(0, 10).reduce((a, b) => a + b, 0) / Math.min(10, p.length)).toFixed(2);
    const mx = (p) => Math.max(...p.slice(0, 10));
    return { top: bm(top), left: bm(left), bot: bm(bot), right: bm(right), maxTop: mx(top), profTop: top };
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

/* 1) 灰阶 2px 条纹（确定性）→ 色散链路增益；指针 park、卡内内容隐藏 */
const out = { gpu, stripes: {}, realmap: {} };
await page.evaluate(() => window.__gevEdge.testStripes(1, 2));
await sleep(1200);
for (const dp of DPS) {
  await page.evaluate((dp) => window.__gevEdge.set({ dispPx: dp }), dp);
  await park(); await sleep(700);
  const on = await shot();
  await page.evaluate(() => window.__gevEdge.off()); await sleep(600);
  const off = await shot();
  await page.evaluate(() => window.__gevEdge.on()); await sleep(700);
  const m = await page.evaluate((a, b, r) => window.__c5dis(a, b, r), on, off, rData);
  out.stripes['dp' + dp] = m;
  console.log('stripes dp' + dp, 'band均值 top/left/bot/right', m.top, m.left, m.bot, m.right, 'maxTop', m.maxTop, 'profTop', m.profTop.slice(0, 6).join(','));
}
/* 2) 关底衬，真实地图：每档 8x 角/上沿样张 */
await page.evaluate(() => window.__gevEdge.testBg(false));
await sleep(1500);
const boxTop = { x: rData.x + Math.round(rData.w * 0.35), y: rData.y - 2, w: 220, h: 16 };
const boxCorner = { x: rData.x - 4, y: rData.y - 4, w: 44, h: 44 };
for (const dp of [1.0, 2.4, 6.0]) {
  await page.evaluate((dp) => window.__gevEdge.set({ dispPx: dp }), dp);
  await park(); await sleep(1000);
  const b64 = await shot();
  writeFileSync(`${OUT}/c5-${TAG}-real-dp${String(dp).replace('.', 'p')}-1x.png`, Buffer.from(b64, 'base64'));
  for (const [nm, box, s] of [['top8x', boxTop, 8], ['corner8x', boxCorner, 8], ['corner4x', boxCorner, 4]]) {
    const u = await page.evaluate((b64, box, s) => window.__c5crop(b64, box, s), b64, box, s);
    writeFileSync(`${OUT}/c5-${TAG}-real-dp${String(dp).replace('.', 'p')}-${nm}.png`, Buffer.from(String(u).split(',')[1], 'base64'));
  }
  const m = await page.evaluate((b64, r) => window.__c5edge(b64, r), b64, rData);
  out.realmap['dp' + dp] = m;
  console.log('realmap dp' + dp, 'top|RB|', m.top.absRB.slice(0, 5).join(','), 'center', JSON.stringify(m.center || {}));
}
writeFileSync(`${OUT}/c5-${TAG}.json`, JSON.stringify(out, null, 2));
await browser.close();
