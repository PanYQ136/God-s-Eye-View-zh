#!/usr/bin/env node
/**
 * qa-lg-disp-zoom.mjs —— 色散视觉/量化：冻结 Cesium，卡角与卡边 8x 放大对比（dispersion on / off）
 * 输出 PNG 到 evidence/lg-glass-shots/p0/disp/ + JSON（逐通道最大差、R/B 横向错位）
 * 用法: node scripts/qa-lg-disp-zoom.mjs [url]
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const DIR = 'evidence/lg-glass-shots/p0/disp';
const SCR = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(DIR, { recursive: true }); fs.mkdirSync(SCR, { recursive: true });
const out = { url, errors: [], regions: [] };

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
await new Promise((r) => setTimeout(r, 13000));
await page.evaluate(() => {
  try {
    const C = window.Cesium || window.__CESIUM__;
    window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-73.9857, 40.7484, 900), orientation: { heading: 0.6, pitch: -0.7, roll: 0 } });
  } catch (e) {}
});
await new Promise((r) => setTimeout(r, 11000));
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 1800));
out.stats = await page.evaluate(() => { const s = window.__gevGlStats(); return { fps: s.fps, scale: s.scale, target: s.scaleTarget, dev: s.devicePx, count: s.count }; });

const DSF = 2;
const grab = async (clip, tag) => {
  const buf = await page.screenshot({ clip });
  if (tag) fs.writeFileSync(path.join(SCR, tag + '.png'), buf);
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels, buf };
};
const zoom = async (buf, file, f = 8) => {
  const m = await sharp(buf).metadata();
  await sharp(buf).resize(m.width * f, m.height * f, { kernel: 'nearest' }).png().toFile(file);
};

/* 卡角（左上，曲率最强）+ 卡左边中段 */
const card = await page.evaluate(() => {
  const s = window.__gevGlStats().surfaces;
  return s.find((x) => x.id === 'data-panel') || s[0];
});
const regions = [
  { name: 'corner-tl', clip: { x: card.rect[0] - 6, y: card.rect[1] - 6, width: 34, height: 30 } },
  { name: 'edge-left', clip: { x: card.rect[0] - 6, y: card.rect[1] + 4, width: 26, height: Math.min(24, card.rect[3] - 10) } },
];

for (const R of regions) {
  const on = await grab(R.clip);
  await page.evaluate(() => window.__gevGlSet({ etaLo: 1.52, etaHi: 1.52 }));
  await new Promise((r) => setTimeout(r, 500));
  const off = await grab(R.clip);
  await page.evaluate(() => window.__gevGlSet({ etaLo: 1.48, etaHi: 1.56 }));
  await new Promise((r) => setTimeout(r, 500));
  await zoom(on.buf, path.join(DIR, R.name + '-disp-on.png'));
  await zoom(off.buf, path.join(DIR, R.name + '-disp-off.png'));

  /* 逐通道最大差 + 差值图 */
  let max = { R: 0, G: 0, B: 0 }, mean = { R: 0, G: 0, B: 0 }, n = 0;
  const diff = Buffer.alloc(on.w * on.h * on.ch);
  for (let i = 0; i < on.data.length; i += on.ch) {
    for (const [k, o] of [['R', 0], ['G', 1], ['B', 2]]) {
      const d = Math.abs(on.data[i + o] - off.data[i + o]);
      if (d > max[k]) max[k] = d; mean[k] += d;
      diff[i + o] = Math.min(255, d * 12);       // 放大 12x 显示
    }
    diff[i + 3] = 255; n++;
  }
  ['R', 'G', 'B'].forEach((k) => { mean[k] = +(mean[k] / n).toFixed(2); });
  const dbuf = await sharp(diff, { raw: { width: on.w, height: on.h, channels: on.ch } }).png().toBuffer();
  fs.writeFileSync(path.join(DIR, R.name + '-disp-diff12x.png'), dbuf);
  await zoom(dbuf, path.join(DIR, R.name + '-disp-diff12x-8x.png'), 8);

  /* R/B 横向错位：差值剖面的互相关（逐行，取对比最强的一半行） */
  const W = on.w, H = on.h, ch = on.ch;
  const rows = [];
  for (let y = 0; y < H; y++) {
    const pr = new Float32Array(W), pb = new Float32Array(W);
    let e = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * ch;
      pr[x] = on.data[i] - off.data[i];
      pb[x] = on.data[i + 2] - off.data[i + 2];
      e += Math.abs(pr[x]) + Math.abs(pb[x]);
    }
    if (e / W < 0.8) continue;                       // 无信号行跳过
    let best = -99, bestLag = 0;
    for (let lag = -8; lag <= 8; lag++) {
      let s = 0;
      for (let x = 4; x < W - 4; x++) s += pr[x] * pb[x + lag];
      if (s > best) { best = s; bestLag = lag; }
    }
    rows.push({ y, lag: bestLag, energy: +(e / W).toFixed(2) });
  }
  const lags = rows.map((r) => r.lag).sort((a, b) => a - b);
  const med = lags.length ? lags[Math.floor(lags.length / 2)] : null;
  R.result = {
    maxAbsDiff: max, meanAbsDiff: mean, rowsWithSignal: rows.length,
    rbLagDevicePx: med, rbLagCssPx: med == null ? null : +(Math.abs(med) / DSF).toFixed(2),
    lagHistogram: lags.reduce((a, l) => (a[l] = (a[l] || 0) + 1, a), {}),
  };
  out.regions.push({ name: R.name, clip: R.clip, ...R.result });
  console.log(R.name + ' ' + JSON.stringify(R.result));
}
fs.writeFileSync(path.join(SCR, 'qa-lg-disp-zoom.json'), JSON.stringify(out, null, 1));
console.log('stats=' + JSON.stringify(out.stats) + ' errors=' + JSON.stringify(out.errors.slice(0, 3)));
await browser.close();
