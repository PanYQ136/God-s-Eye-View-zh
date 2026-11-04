#!/usr/bin/env node
/**
 * qa-lg-disp-shift2.mjs —— 色散证据（整改复核阻塞项 1）
 *  方法：中性灰白条纹背景（__gevGlTestBg，R=G=B，8 CSS px 条）→ 斜面内任何 R≠B 都只可能来自色散。
 *   A1 色散开 / A2 色散关（etaLo=etaHi=1.52）：
 *     · chroma = 斜面带内 mean|R−B| 与 p95|R−B|（关时≈0，开时>0 → 光谱分离存在）
 *     · lag    = 斜面带内 R(x) 与 B(x+lag) 的归一化互相关峰位 → R/B 轮廓横向错位（设备 px / CSS px）
 *   B 真实地图卡角同样测（证明不是只在合成图上成立）
 * 输出: evidence/lg-glass-shots/p0/disp/*.png + scratch JSON
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const DIR = 'evidence/lg-glass-shots/p0/disp';
const SCR = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(DIR, { recursive: true }); fs.mkdirSync(SCR, { recursive: true });
const out = { url, errors: [], tests: {} };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => out.errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 16000));

const DSF = 2;
const grab = async (clip, tag) => {
  const buf = await page.screenshot({ clip });
  if (tag) fs.writeFileSync(path.join(SCR, tag + '.png'), buf);
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels, buf };
};
const zoomFile = async (buf, file, f = 10) => {
  const m = await sharp(buf).metadata();
  await sharp(buf).resize(m.width * f, m.height * f, { kernel: 'nearest' }).png().toFile(file);
};

/* 斜面带内：R/B 互相关错位 */
function lagRB(img, y, x0, x1) {
  const { data, w, ch } = img;
  const R = [], B = [];
  for (let x = x0; x <= x1; x++) { const i = (y * w + x) * ch; R.push(data[i]); B.push(data[i + 2]); }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mR = mean(R), mB = mean(B);
  const sd = (a, m) => Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length) || 1;
  const sR = sd(R, mR), sB = sd(B, mB);
  let best = -Infinity, bestLag = 0;
  for (let lag = -6; lag <= 6; lag++) {
    let s = 0, n = 0;
    for (let i = 2; i < R.length - 2; i++) {
      const j = i + lag; if (j < 0 || j >= B.length) continue;
      s += ((R[i] - mR) / sR) * ((B[j] - mB) / sB); n++;
    }
    if (n > 6 && s / n > best) { best = s / n; bestLag = lag; }
  }
  return { lag: bestLag, score: +best.toFixed(3), sd: +sR.toFixed(1) };
}
function chroma(img, y0, y1, x0, x1) {
  const v = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * img.w + x) * img.ch;
    v.push(Math.abs(img.data[i] - img.data[i + 2]));
  }
  v.sort((a, b) => a - b);
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * v.length))];
  return { n: v.length, mean: +(v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)).toFixed(2), p50: q(0.5), p95: q(0.95), max: v[v.length - 1] };
}
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const hist = (a) => a.reduce((h, l) => (h[l] = (h[l] || 0) + 1, h), {});

/* ── A. 合成中性条纹 ─────────────────────────────────────────────── */
const card = await page.evaluate(() => {
  const s = window.__gevGlStats().surfaces;
  return s.find((x) => x.id === 'pp-toggles') || s[0];
});
const bezelDev = Math.round(card.bezel * DSF);
await page.evaluate(() => { window.__gevGlTestBg(true, 8); window.__gevGlSet({ etaLo: 1.48, etaHi: 1.56 }); });
await new Promise((r) => setTimeout(r, 1200));
const clipA = { x: card.rect[0] - 2, y: card.rect[1] + 6, width: Math.ceil(bezelDev / DSF) + 2, height: Math.min(30, card.rect[3] - 12) };
const A = await grab(clipA, 'shift-stripes');
await zoomFile(A.buf, path.join(DIR, 'shift-stripes-10x.png'), 10);
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.52, etaHi: 1.52 }));
await new Promise((r) => setTimeout(r, 800));
const A0 = await grab(clipA, 'shift-stripes-off');
await zoomFile(A0.buf, path.join(DIR, 'shift-stripes-off-10x.png'), 10);
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.48, etaHi: 1.56 }));

const x0 = 3, x1 = A.w - 2, y0 = 2, y1 = A.h - 3;
const lags = [], lagsOff = [];
for (let y = y0; y <= y1; y++) {
  const r = lagRB(A, y, x0, x1); if (r.sd > 6) lags.push(r.lag);
  const r0 = lagRB(A0, y, x0, x1); if (r0.sd > 6) lagsOff.push(r0.lag);
}
out.tests.stripes = {
  clip: clipA, bezelCss: card.bezel, card: card.rect,
  rows: lags.length,
  lagDeviceMedian: med(lags), lagCssMedian: med(lags) == null ? null : +(Math.abs(med(lags)) / DSF).toFixed(2),
  lagHistogram: hist(lags),
  lagDeviceMedian_off: med(lagsOff), lagHistogram_off: hist(lagsOff),
  chromaOn: chroma(A, y0, y1, x0, x1), chromaOff: chroma(A0, y0, y1, x0, x1),
};

/* ── B. 真实地图卡角 ───────────────────────────────────────────── */
await page.evaluate(() => window.__gevGlTestBg(false));
await new Promise((r) => setTimeout(r, 600));
await page.evaluate(() => {
  try {
    const C = window.Cesium || window.__CESIUM__;
    window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-73.9857, 40.7484, 900), orientation: { heading: 0.6, pitch: -0.7, roll: 0 } });
  } catch (e) {}
});
await new Promise((r) => setTimeout(r, 10000));
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 1500));
const card2 = await page.evaluate(() => {
  const s = window.__gevGlStats().surfaces;
  return s.find((x) => x.id === 'data-panel') || s[0];
});
const clipB = { x: card2.rect[0] - 6, y: card2.rect[1] - 6, width: 40, height: 32 };
const B1 = await grab(clipB, 'shift-map-corner');
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.52, etaHi: 1.52 }));
await new Promise((r) => setTimeout(r, 700));
const B0 = await grab(clipB, 'shift-map-corner-off');
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.48, etaHi: 1.56 }));
await new Promise((r) => setTimeout(r, 700));
await zoomFile(B1.buf, path.join(DIR, 'shift-map-corner-10x.png'), 10);
const bl = [];
for (let y = 2; y < B1.h - 2; y++) { const r = lagRB(B1, y, 12, 12 + bezelDev); if (r.sd > 6) bl.push(r.lag); }
out.tests.mapCorner = {
  clip: clipB, rows: bl.length, lagDeviceMedian: med(bl),
  lagCssMedian: med(bl) == null ? null : +(Math.abs(med(bl)) / DSF).toFixed(2), lagHistogram: hist(bl),
  chromaOn: chroma(B1, 2, B1.h - 3, 12, 12 + bezelDev), chromaOff: chroma(B0, 2, B0.h - 3, 12, 12 + bezelDev),
};
/* 逐通道 |on − off| */
let mx = { R: 0, G: 0, B: 0 }, mn = { R: 0, G: 0, B: 0 }, n = 0;
for (let i = 0; i < A.data.length; i += A.ch) {
  for (const [k, o] of [['R', 0], ['G', 1], ['B', 2]]) {
    const d = Math.abs(A.data[i + o] - A0.data[i + o]);
    if (d > mx[k]) mx[k] = d; mn[k] += d;
  }
  n++;
}
out.tests.stripes.diffOnOff = { max: mx, mean: Object.fromEntries(['R', 'G', 'B'].map((k) => [k, +(mn[k] / n).toFixed(2)])) };

out.stats = await page.evaluate(() => { const s = window.__gevGlStats(); return { fps: s.fps, scale: s.scale, target: s.scaleTarget, dev: s.devicePx, count: s.count, dispPx: s.config.dispPx }; });
fs.writeFileSync(path.join(SCR, 'qa-lg-disp-shift.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.tests, null, 1));
console.log('stats=' + JSON.stringify(out.stats) + ' errors=' + JSON.stringify(out.errors.slice(0, 3)));
await browser.close();
