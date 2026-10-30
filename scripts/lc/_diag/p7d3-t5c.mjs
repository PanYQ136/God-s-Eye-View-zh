#!/usr/bin/env node
/* Phase7D3 · gate item7 / T5c 红诊断：移开指针后 hover 高光多久回到基线（Δmean ≤0.6）
   方法：冻结 Cesium（消除地图运动）→ 拍基线 → 悬停 600ms → 移开 → 按 200/400/800/1500/2500ms 采样，
   逐帧对基线求卡片矩形内 |Δ| 均值。用法：node scripts/lc/_diag/p7d3-t5c.mjs [tag] */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] || 'p7d3t5c';
const BASE = process.env.GEV_URL || 'http://127.0.0.1:4174/?welcome=0';
const OUT = '.gev-logs/lc/phase7d3';
mkdirSync(OUT, { recursive: true });
const W = 1348, VH = 774;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CARD = process.env.P7D3_CARD || 'data-panel';

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
await sleep(5000);
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
await page.evaluate(() => {
  const v = window.__gevViewer || (window.__godsEyeView && window.__godsEyeView.viewer);
  if (v) v.useDefaultRenderLoop = false;
});
await sleep(500);
const rect = await page.evaluate((id) => {
  const el = document.getElementById(id); if (!el) return null;
  const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
}, CARD);
if (!rect) { console.log('no card', CARD); await browser.close(); process.exit(1); }

await page.mouse.move(4, 700);
await sleep(800);
const base = await shot();
const hover = async () => {
  await page.mouse.move(rect.x + rect.w * 0.5, rect.y + rect.h * 0.5, { steps: 6 });
  await sleep(700);
  return shot();
};
const hShot = await hover();
const away = await (async () => { await page.mouse.move(4, 700, { steps: 6 }); return shot(); })();

const delays = [0, 200, 400, 800, 1500, 2500];
const after = [];
for (const d of delays) {
  if (d) await sleep(d - (after.length ? delays[after.length - 1] : 0));
  after.push(await shot());
}

const res = await page.evaluate(async (base, hShot, away, after, rect, delays) => {
  const dec = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height, K: bmp.width / innerWidth };
  };
  const B = await dec(base);
  const K = B.K;
  const box = { x: Math.round(rect.x * K), y: Math.round(rect.y * K), w: Math.round(rect.w * K), h: Math.round(rect.h * K) };
  const cmp = async (b64) => {
    const X = await dec(b64);
    let s = 0, n = 0, mx = 0;
    for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) {
      const i = (y * B.w + x) * 4;
      const d = (Math.abs(X.d[i] - B.d[i]) + Math.abs(X.d[i + 1] - B.d[i + 1]) + Math.abs(X.d[i + 2] - B.d[i + 2])) / 3;
      s += d; n++; if (d > mx) mx = d;
    }
    return { mean: +(s / n).toFixed(3), max: +mx.toFixed(1) };
  };
  const out = { K: K, hover: await cmp(hShot), away0: await cmp(away), after: [] };
  for (let i = 0; i < after.length; i++) out.after.push({ delayMs: delays[i], ...(await cmp(after[i])) });
  return out;
}, base, hShot, away, after, rect, delays);

console.log('card', CARD, 'rect', JSON.stringify(rect));
console.log('shotScale K', res.K);
console.log('hover  Δmean', res.hover.mean, 'max', res.hover.max);
console.log('away0  Δmean', res.away0.mean, 'max', res.away0.max);
for (const a of res.after) console.log(`+${a.delayMs}ms  Δmean ${a.mean}  max ${a.max}  ${a.mean <= 0.6 ? 'OK' : 'FAIL'}`);
writeFileSync(`${OUT}/${TAG}-t5c.json`, JSON.stringify(res, null, 1));
await page.evaluate(() => { const v = window.__gevViewer || (window.__godsEyeView && window.__godsEyeView.viewer); if (v) v.useDefaultRenderLoop = true; });
await browser.close();
