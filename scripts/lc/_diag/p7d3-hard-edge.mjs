#!/usr/bin/env node
/* Phase7D3 硬边复核：2px 条纹底衬下，四边 band 内 max |Δ(R−B)|（gate T13 口径 6–45，lead 要求 ≤24）
   对比 e0=0（旧行为）与 e0=0.85（色散覆盖整带）。用法：node scripts/lc/_diag/p7d3-hard-edge.mjs */
import puppeteer from 'puppeteer';

const BASE = process.env.GEV_URL || 'http://127.0.0.1:4174/?welcome=0';
const W = 1348, VH = 774;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${VH + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 600000,
  defaultViewport: { width: W, height: VH, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});
await page.goto(`${BASE}&t=${Date.now()}`, { waitUntil: 'load' });
for (let i = 0; i < 450; i++) {
  const st = await page.evaluate(() => { try { const s = window.__gevEdge && window.__gevEdge.stats(); return { r: !!(window.__lc && window.__lc.api && window.__lc.api.ready), n: s ? (s.surfaces || []).length : 0 }; } catch (e) { return { r: false, n: 0 }; } }).catch(() => ({ r: false, n: 0 }));
  if (st.r && st.n >= 9) break;
  await sleep(400);
}
await sleep(3000);
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const cards = await page.evaluate(() => (window.__gevEdge.stats().surfaces || []).map((x) => {
  const el = document.getElementById(x.id); if (!el) return null;
  const r = el.getBoundingClientRect();
  return { id: x.id, x: r.x, y: r.y, w: r.width, h: r.height, band: x.band };
}).filter(Boolean));
console.log('cards', cards.length);

/* 页内：条纹底 + on/off 两张 → 四边 band 内 max|Δ(R−B)| */
const kern = async (a, b, mode) => page.evaluate(async (a, b, cards, mode) => {
  const dec = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height, K: bmp.width / innerWidth };
  };
  const A = await dec(a), B = await dec(b);
  const K = A.K; const res = {};
  for (const cd of cards.slice(0, 3)) {
    const r = { x: cd.x * K, y: cd.y * K, w: cd.w * K, h: cd.h * K };
    const band = Math.max(2, Math.round((cd.band || 10) * K));
    const edges = { top: [r.y, 'y', 1], left: [r.x, 'x', 1], bot: [r.y + r.h, 'y', -1], right: [r.x + r.w, 'x', -1] };
    const o = {};
    for (const [e, [ep, ax, dir]] of Object.entries(edges)) {
      const x0 = Math.round(r.x + r.w * 0.3), x1 = Math.round(r.x + r.w * 0.7);
      const y0 = Math.round(r.y + r.h * 0.3), y1 = Math.round(r.y + r.h * 0.7);
      let mx = 0;
      for (let k = 0; k < band; k++) {
        const aa = Math.round(ep) + k * dir;
        for (let t = Math.max(0, Math.min(aa, aa + dir)); t < Math.min(ax === 'y' ? A.h : A.w, Math.max(aa, aa + dir)); t++) {
          for (let u = ax === 'y' ? x0 : y0; u < Math.min(ax === 'y' ? x1 : y1, ax === 'y' ? A.w : A.h); u++) {
            const i = ax === 'y' ? (t * A.w + u) * 4 : (u * A.w + t) * 4;
            const drb = Math.abs((A.d[i] - B.d[i]) - (A.d[i + 2] - B.d[i + 2]));
            if (drb > mx) mx = drb;
          }
        }
      }
      o[e] = mx;
    }
    res[cd.id] = o;
  }
  return res;
}, a, b, cards, mode);

const BG = process.env.P7D3_BG || 'stripes';   // stripes = 2px 硬边（T13 口径）；checker = 8px 棋盘（四边折射峰值口径）
const setBg = (axis) => {
  if (BG === 'checker') page.evaluate(() => window.__gevEdge.testChecker(true, 8, 0));
  else page.evaluate((axis) => window.__gevEdge.testStripes(axis, 2), axis);
};
const runOne = async (e0, axis) => {
  await page.evaluate((e0) => window.__gevEdge.set({ dispBandStart: e0, dispGain: 8, dispCap: 20 / 255 }), e0);
  await setBg(axis);
  await page.mouse.move(4, 700);
  await sleep(700);
  const on = await shot();
  await page.evaluate(() => window.__gevEdge.testBg(false));
  await sleep(500);
  const off = await shot();
  await setBg(axis);
  await sleep(400);
  return kern(on, off, axis);
};

for (const axis of [1, 0]) {
  for (const e0 of [0, 0.85]) {
    const r = await runOne(e0, axis);
    const first = Object.values(r)[0];
    const dims = axis === 1 ? ['top', 'bot'] : ['left', 'right'];
    console.log(`axis=${axis === 1 ? 'hstripes(顶/下)' : 'vstripes(左/右)'}  e0=${e0}  ` +
      dims.map((dn) => `${dn} ${Math.max(...Object.values(r).map((o) => o[dn]))}`).join(' / ') +
      `   [${Object.keys(r).join(',')}]`);
  }
}
await page.evaluate(() => window.__gevEdge.testBg(false));
await browser.close();
