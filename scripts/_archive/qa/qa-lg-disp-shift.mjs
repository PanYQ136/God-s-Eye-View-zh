#!/usr/bin/env node
/**
 * qa-lg-disp-shift.mjs —— 色散证据（整改复核阻塞项 1）
 *  A. 合成条纹背景（8 CSS px 黑白竖条，__gevGlTestBg）：沿卡边缘取水平扫描线，
 *     用归一化互相关求 R 轮廓相对 B 轮廓的横向错位（设备 px / CSS px）。
 *     —— 这是「R/G/B 不同偏移 1–2.5px」的直接测量，不是亮度差。
 *  B. 真实地图（曼哈顿 900m）：卡角区域同样测（用来证明不是只在合成图上成立）。
 *  C. 逐通道 |色散开 − 色散关| 最大/均值，作为辅助证据。
 * 输出: evidence/lg-glass-shots/p0/disp/*.png + JSON(scratch)
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
const zoomFile = async (buf, file, f = 8) => {
  const m = await sharp(buf).metadata();
  await sharp(buf).resize(m.width * f, m.height * f, { kernel: 'nearest' }).png().toFile(file);
};

/* 归一化互相关：R 行对 B 行的最佳 lag（正 lag 表示 R 相对 B 向右偏） */
function lagRB(img, y) {
  const { data, w, ch } = img;
  const R = new Float64Array(w), B = new Float64Array(w);
  for (let x = 0; x < w; x++) { const i = (y * w + x) * ch; R[x] = data[i]; B[x] = data[i + 2]; }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mR = mean(R), mB = mean(B);
  const std = (a, m) => Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
  const sR = std(R, mR) || 1, sB = std(B, mB) || 1;
  let best = -Infinity, bestLag = 0;
  for (let lag = -8; lag <= 8; lag++) {
    let s = 0, n = 0;
    for (let x = 8; x < w - 8; x++) {
      const xx = x + lag; if (xx < 0 || xx >= w) continue;
      s += ((R[x] - mR) / sR) * ((B[xx] - mB) / sB); n++;
    }
    if (n > 10 && s / n > best) { best = s / n; bestLag = lag; }
  }
  return { lag: bestLag, score: +best.toFixed(3), contrast: +(sR / 1).toFixed(1) };
}
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

/* ── A. 合成条纹背景 ─────────────────────────────────────────────── */
const card = await page.evaluate(() => {
  const s = window.__gevGlStats().surfaces;
  return s.find((x) => x.id === 'data-panel') || s[0];
});
await page.evaluate(() => window.__gevGlTestBg(true, 8));
await new Promise((r) => setTimeout(r, 900));
const clipA = { x: card.rect[0] - 4, y: card.rect[1] + 6, width: 26, height: Math.max(10, card.rect[3] - 12) };
const A = await grab(clipA, 'shift-stripes');
await zoomFile(A.buf, path.join(DIR, 'shift-stripes-8x.png'), 8);
const lagRows = [];
for (let y = 2; y < A.h - 2; y++) {
  const r = lagRB(A, y);
  if (r.contrast > 6) lagRows.push(r.lag);
}
out.tests.stripes = {
  clip: clipA, rows: lagRows.length,
  lagDeviceMedian: lagRows.length ? med(lagRows) : null,
  lagCssMedian: lagRows.length ? +(Math.abs(med(lagRows)) / DSF).toFixed(2) : null,
  histogram: lagRows.reduce((a, l) => (a[l] = (a[l] || 0) + 1, a), {}),
};

/* 关色散对照（etaLo==etaHi）→ R/B 错位应回到 0 */
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.52, etaHi: 1.52 }));
await new Promise((r) => setTimeout(r, 700));
const A0 = await grab(clipA, 'shift-stripes-off');
await zoomFile(A0.buf, path.join(DIR, 'shift-stripes-off-8x.png'), 8);
const lagRows0 = [];
for (let y = 2; y < A0.h - 2; y++) { const r = lagRB(A0, y); if (r.contrast > 6) lagRows0.push(r.lag); }
out.tests.stripesOff = {
  rows: lagRows0.length, lagDeviceMedian: lagRows0.length ? med(lagRows0) : null,
  histogram: lagRows0.reduce((a, l) => (a[l] = (a[l] || 0) + 1, a), {}),
};
/* 逐通道差（A vs A0） */
let mx = { R: 0, G: 0, B: 0 }, mn = { R: 0, G: 0, B: 0 }, n = 0;
for (let i = 0; i < A.data.length; i += A.ch) {
  for (const [k, o] of [['R', 0], ['G', 1], ['B', 2]]) {
    const d = Math.abs(A.data[i + o] - A0.data[i + o]);
    if (d > mx[k]) mx[k] = d; mn[k] += d;
  }
  n++;
}
out.tests.stripes.diffOnOff = { max: mx, mean: Object.fromEntries(['R', 'G', 'B'].map((k) => [k, +(mn[k] / n).toFixed(2)])) };
await page.evaluate(() => { window.__gevGlTestBg(false); window.__gevGlSet({ etaLo: 1.48, etaHi: 1.56 }); });
await new Promise((r) => setTimeout(r, 900));

/* ── B. 真实地图卡角 ───────────────────────────────────────────── */
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
const clipB = { x: card2.rect[0] - 6, y: card2.rect[1] - 6, width: 34, height: 30 };
const B1 = await grab(clipB, 'shift-map-corner');
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.52, etaHi: 1.52 }));
await new Promise((r) => setTimeout(r, 600));
const B0 = await grab(clipB, 'shift-map-corner-off');
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.48, etaHi: 1.56 }));
await new Promise((r) => setTimeout(r, 600));
const lagB = [];
for (let y = 2; y < B1.h - 2; y++) { const r = lagRB(B1, y); if (r.contrast > 5) lagB.push(r.lag); }
out.tests.mapCorner = {
  clip: clipB, rows: lagB.length, lagDeviceMedian: lagB.length ? med(lagB) : null,
  lagCssMedian: lagB.length ? +(Math.abs(med(lagB)) / DSF).toFixed(2) : null,
  histogram: lagB.reduce((a, l) => (a[l] = (a[l] || 0) + 1, a), {}),
};
await zoomFile(B1.buf, path.join(DIR, 'shift-map-corner-8x.png'), 8);

out.stats = await page.evaluate(() => { const s = window.__gevGlStats(); return { fps: s.fps, scale: s.scale, target: s.scaleTarget, dev: s.devicePx, count: s.count, dispPx: s.config.dispPx }; });
fs.writeFileSync(path.join(SCR, 'qa-lg-disp-shift.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.tests, null, 1));
console.log('stats=' + JSON.stringify(out.stats) + ' errors=' + JSON.stringify(out.errors.slice(0, 3)));
await browser.close();
