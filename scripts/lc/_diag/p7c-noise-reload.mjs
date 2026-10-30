#!/usr/bin/env node
/* Phase7C · 只读探针 A+C
   A) T5c「移开指针后辉光消失」的同状态噪声底：指针始终停在卡外，(n) 组连拍 → 卡内 innerDelta。
      T5c 实测 Δmean 0.706 / brighterFrac 1.28%；用同一统计量的「同状态噪声」判断 0.6 阈值是否落在噪声里。
   C) 同一标签 page.reload()（= 用户按 F5）后，遮罩收起时刻画面是否有影像（B5 同口径 640×420 std/uniq），
      并读 globe.show / tilesLoaded / pageerror，判定 gate B5 的 FAIL 是产品行为还是 CDP reload race。
   用法: node scripts/lc/_diag/p7c-noise-reload.mjs [tag]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'p7c';
const OUT = '.gev-logs/lc/phase7c';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1348, VH = 774;
const BASE = 'http://127.0.0.1:4174/?welcome=0';

const profile = mkdtempSync(join(tmpdir(), `gev-${TAG}-nr-`));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: profile,
  args: ['--no-sandbox', `--window-size=${W + 24},${VH + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 300000,
  defaultViewport: { width: W, height: VH, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
let errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
const cdp = await page.createCDPSession();
await cdp.send('Network.enable').catch(() => {});
await cdp.send('Network.clearBrowserCache').catch(() => {});
await page.goto(`${BASE}&nr=${Date.now()}`, { waitUntil: 'load' });
for (let i = 0; i < 600; i++) {
  const ok = await page.evaluate(() => !!(window.__gevBoot && window.__gevBoot.interactive)).catch(() => false);
  if (ok) break;
  await sleep(50);
}
await sleep(3000);

const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
await page.evaluate(() => {
  const dec = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height, K: bmp.width / innerWidth };
  };
  const innerDelta = (A, B, rect, skipOuter, skipBottom) => {
    const x0 = Math.round((rect.x + skipOuter) * A.K), x1 = Math.round((rect.x + rect.w - skipOuter) * A.K);
    const y0 = Math.round((rect.y + skipOuter) * A.K), y1 = Math.round((rect.y + rect.h - (skipBottom || skipOuter)) * A.K);
    let sum = 0, mx = 0, n = 0, bright = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * A.w + x) * 4;
        const la = 0.2126 * A.d[i] + 0.7152 * A.d[i + 1] + 0.0722 * A.d[i + 2];
        const lb = 0.2126 * B.d[i] + 0.7152 * B.d[i + 1] + 0.0722 * B.d[i + 2];
        const dl = lb - la;
        sum += dl; n++; if (Math.abs(dl) > mx) mx = Math.abs(dl); if (dl > 1) bright++;
      }
    }
    return { mean: +(sum / n).toFixed(3), max: +mx.toFixed(1), brighterFrac: +(bright / n).toFixed(4), n };
  };
  window.__nr = { dec, innerDelta };
});

/* 平灰底衬（与 T5c 同环境） */
await page.evaluate(() => {
  const d = document.createElement('div'); d.id = 'c6-under';
  d.style.cssText = 'position:fixed;inset:0;background:#3a3f46;z-index:1;pointer-events:none';
  document.body.appendChild(d);
});
await page.mouse.move(4, 700, { steps: 3 });
await sleep(900);
const cardRect = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });

const pairs = [];
let prev = await shot();
for (let i = 0; i < 4; i++) {
  await sleep(800);
  const cur = await shot();
  const r = await page.evaluate(async (a, b, rect) => {
    const A = await window.__nr.dec(a), B = await window.__nr.dec(b);
    return window.__nr.innerDelta(A, B, rect, 14, 14);
  }, prev, cur, cardRect);
  pairs.push(r);
  prev = cur;
}
writeFileSync(`${OUT}/p7c-t5c-noise-1x.png`, Buffer.from(prev, 'base64'));
const med = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const noise = {
  cardRect,
  pairs,
  meanMedian: med(pairs.map((p) => p.mean)),
  maxMedian: med(pairs.map((p) => p.max)),
  brighterFracMedian: med(pairs.map((p) => p.brighterFrac)),
  t5cMeasured: { mean: 0.706, max: 46.1, brighterFrac: 0.0128 },
};
console.log('A) T5c same-state noise ' + JSON.stringify(noise));

/* C) 同标签 reload（用户 F5）→ 遮罩收起时刻画面 */
errs = [];
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
const t0 = Date.now();
await page.reload({ waitUntil: 'load', timeout: 240000 });
let revealWall = null;
for (let i = 0; i < 1500; i++) {
  const st = await page.evaluate(() => {
    const g = window.__gevBoot;
    const el = document.getElementById('loading-screen');
    const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
    return { interactive: !!(g && g.interactive), op };
  }).catch(() => null);
  if (st && (st.interactive || (Number.isFinite(st.op) && st.op < 0.05))) { revealWall = Date.now() - t0; break; }
  await sleep(25);
}
await sleep(100);
const png = await shot();
writeFileSync(`${OUT}/p7c-f5-reveal100.png`, Buffer.from(png, 'base64'));
const b5 = await page.evaluate(async (b64) => {
  const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  const w = Math.min(640, bmp.width), h = Math.min(420, bmp.height);
  const x = Math.max(0, Math.round((bmp.width - w) / 2)), y = Math.max(0, Math.round((bmp.height - h) / 2));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, x, y, w, h, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;
  let sum = 0, sum2 = 0, n = 0; const uniq = new Set();
  for (let p = 0; p < d.length; p += 4) {
    const l = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
    sum += l; sum2 += l * l; n++; uniq.add((d[p] << 16) | (d[p + 1] << 8) | d[p + 2]);
  }
  const mean = sum / n, std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const v = window.__gevViewer, lc = window.__lc;
  return { std: +std.toFixed(2), uniq: uniq.size, mean: +mean.toFixed(2), pass: std >= 18 && uniq.size >= 800,
    globeShow: v ? v.scene.globe.show : null,
    lcReady: !!(lc && lc.api && lc.api.ready),
    interactive: !!(window.__gevBoot && window.__gevBoot.interactive),
    bootReason: window.__gevBoot && window.__gevBoot.snapshot ? window.__gevBoot.snapshot().reason : null };
}, png).catch((e) => ({ err: String(e.message || e) }));
const reload = { revealWall, b5, pageErrors: errs.slice(0, 6) };
console.log('C) F5 reload ' + JSON.stringify(reload));

writeFileSync(`${OUT}/p7c-noise-reload.json`, JSON.stringify({ at: new Date().toISOString(), noise, reload }, null, 1));
await browser.close();
