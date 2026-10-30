#!/usr/bin/env node
/* Phase7D3 视觉取证：同一冻结画面上拍 (e0=0 / e0=0.85) × (dispGain 8 / 1) 四张，出
   ① 8x 最近邻裁切（产品态，肉眼/vision 判断有无暖冷）② 色散隔离图（A−B 放大 8 倍，看空间结构）
   用法：node scripts/lc/_diag/p7d3-visual.mjs [tag] */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] || 'p7d3v';
const BASE = process.env.GEV_URL || 'http://127.0.0.1:4174/?welcome=0';
const OUT = '.gev-logs/lc/phase7d3';
mkdirSync(OUT, { recursive: true });
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
  const st = await page.evaluate(() => {
    try { const s = window.__gevEdge && window.__gevEdge.stats(); return { r: !!(window.__lc && window.__lc.api && window.__lc.api.ready), n: s ? (s.surfaces || []).length : 0 }; }
    catch (e) { return { r: false, n: 0 }; }
  }).catch(() => ({ r: false, n: 0 }));
  if (st.r && st.n >= 9) break;
  await sleep(400);
}
await sleep(5000);
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;

/* 等非黑屏 */
let live = null;
for (let i = 0; i < 40; i++) {
  const b64 = await shot();
  live = await page.evaluate(async (b) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b)).blob());
    const cv = document.createElement('canvas'); cv.width = 400; cv.height = 300;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, 400, 200, 400, 300, 0, 0, 400, 300);
    const d = cx.getImageData(0, 0, 400, 300).data;
    let s = 0, s2 = 0, n = 0;
    for (let k = 0; k < d.length; k += 4) { const l = (d[k] + d[k + 1] + d[k + 2]) / 3; s += l; s2 += l * l; n++; }
    const m = s / n; return { mean: +m.toFixed(2), std: +Math.sqrt(Math.max(0, s2 / n - m * m)).toFixed(2) };
  }, b64);
  if (live.std >= 6) break;
  await sleep(1500);
}
console.log('backdrop', JSON.stringify(live));
await page.evaluate(() => {
  const v = window.__gevViewer || (window.__godsEyeView && window.__godsEyeView.viewer);
  if (v) v.useDefaultRenderLoop = false;
});
await sleep(600);

const cards = await page.evaluate(() => (window.__gevEdge.stats().surfaces || []).map((x) => {
  const el = document.getElementById(x.id); if (!el) return null;
  const r = el.getBoundingClientRect();
  return { id: x.id, x: r.x, y: r.y, w: r.width, h: r.height };
}).filter(Boolean));

const grab = async (e0, gain) => {
  await page.evaluate((e0, gain) => window.__gevEdge.set({ dispBandStart: e0, dispGain: gain, dispCap: 20 / 255 }), e0, gain);
  await page.mouse.move(4, 700);
  await sleep(700);
  return shot();
};
const A0 = await grab(0, 8), B0 = await grab(0, 1);
const A85 = await grab(0.85, 8);

/* 页内裁切 + 色散隔离图 */
const out = await page.evaluate(async (imgs, cards) => {
  const dec = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, bmp.width, bmp.height);
    return { d: d.data, w: bmp.width, h: bmp.height, K: bmp.width / innerWidth };
  };
  const crop = (src, box, s, nn) => {
    const K = src.K;
    const cv = document.createElement('canvas');
    cv.width = Math.round(box.w * K * s); cv.height = Math.round(box.h * K * s);
    const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = !nn;
    cx.drawImage(src.canvas, Math.round(box.x * K), Math.round(box.y * K), Math.round(box.w * K), Math.round(box.h * K), 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/png');
  };
  const A = await dec(imgs[0]), B = await dec(imgs[1]), C = await dec(imgs[2]);
  for (const o of [A, B, C]) {
    const cv = document.createElement('canvas'); cv.width = o.w; cv.height = o.h;
    const cx = cv.getContext('2d'); const id = cx.createImageData(o.w, o.h);
    for (let i = 0; i < o.d.length; i += 4) { id.data[i] = o.d[i]; id.data[i + 1] = o.d[i + 1]; id.data[i + 2] = o.d[i + 2]; id.data[i + 3] = 255; }
    cx.putImageData(id, 0, 0); o.canvas = cv;
  }
  /* 色散隔离图：e0=0 的 (gain8 − gain1)，把 Δ(R−B) 写成 R/B 双向彩度，×8 放大，灰底 128 */
  const iso = document.createElement('canvas'); iso.width = A.w; iso.height = A.h;
  const ic = iso.getContext('2d'); const iid = ic.createImageData(A.w, A.h);
  for (let i = 0; i < A.d.length; i += 4) {
    const dr = (A.d[i] - B.d[i]) - (A.d[i + 2] - B.d[i + 2]);
    const v = Math.max(-127, Math.min(127, Math.round(dr * 8)));
    iid.data[i] = 128 + Math.max(0, v); iid.data[i + 1] = 128; iid.data[i + 2] = 128 + Math.max(0, -v); iid.data[i + 3] = 255;
  }
  ic.putImageData(iid, 0, 0);
  const isoObj = { canvas: iso, K: A.K, w: A.w, h: A.h };
  const picks = [
    { id: 'data-panel', edge: 'left' }, { id: 'gev-gfx-fab', edge: 'bot' },
    { id: 'pp-toggles', edge: 'top' }, { id: 'cctv-panel', edge: 'right' },
  ];
  const res = [];
  for (const p of picks) {
    const cd = cards.find((c) => c.id === p.id); if (!cd) continue;
    const boxes = {
      top: { x: cd.x + cd.w * 0.25, y: cd.y - 3, w: 90, h: 18 },
      bot: { x: cd.x + cd.w * 0.25, y: cd.y + cd.h - 15, w: 90, h: 18 },
      left: { x: cd.x - 3, y: cd.y + cd.h * 0.25, w: 18, h: 90 },
      right: { x: cd.x + cd.w - 15, y: cd.y + cd.h * 0.25, w: 18, h: 90 },
    };
    const box = boxes[p.edge];
    res.push({ name: `${p.id}-${p.edge}`, e0z: crop(A, box, 8, true), e085: crop(C, box, 8, true), iso: crop(isoObj, box, 8, true) });
  }
  return { res, full: [A.canvas.toDataURL('image/png'), C.canvas.toDataURL('image/png')] };
}, [A0, B0, A85], cards);

const save = (name, dataUrl) => writeFileSync(`${OUT}/${TAG}-${name}.png`, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
save('1x-e0-0', out.full[0]);
save('1x-e0-085', out.full[1]);
for (const r of out.res) { save(`${r.name}-8x-e0-0`, r.e0z); save(`${r.name}-8x-e0-085`, r.e085); save(`${r.name}-8x-iso-x8`, r.iso); }
console.log('saved', out.res.map((r) => r.name).join(', '));
await page.evaluate(() => { const v = window.__gevViewer || (window.__godsEyeView && window.__godsEyeView.viewer); if (v) v.useDefaultRenderLoop = true; });
await browser.close();
