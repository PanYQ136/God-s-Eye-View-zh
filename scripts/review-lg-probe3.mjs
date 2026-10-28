#!/usr/bin/env node
/**
 * review-lg-probe3.mjs —— 冻结 Cesium 渲染循环后，隔离测量：折射带 / 白 rim / 色散
 * 关键点：先 useDefaultRenderLoop=false 冻结地图纹理，再做 A/B，排除「场景变化」混淆
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
mkdir(OUT);
function mkdir(p) { fs.mkdirSync(p, { recursive: true }); }
const out = { url, errors: [], tests: {} };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => out.errors.push('pageerror: ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));

out.viewer = await page.evaluate(() => {
  const v = window.__gevViewer;
  return { has: !!v, hasCesium: !!window.Cesium, renderLoop: v ? v.useDefaultRenderLoop : null };
});
if (out.viewer.has) {
  out.cam = await page.evaluate(() => {
    try {
      const v = window.__gevViewer;
      const C = window.Cesium || window.__CESIUM__;
      v.camera.setView({ destination: C.Cartesian3.fromDegrees(-73.9857, 40.7484, 1800), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
      return 'ok';
    } catch (e) { return 'err:' + e.message; }
  });
}
await new Promise((r) => setTimeout(r, 9000));
out.frozen = await page.evaluate(() => {
  try { window.__gevViewer.useDefaultRenderLoop = false; return true; } catch (e) { return 'err:' + e.message; }
});
await new Promise((r) => setTimeout(r, 1500));

const DSF = 2;
const grab = async (x, y, w, h, tag) => {
  const buf = await page.screenshot({ clip: { x, y, width: w, height: h } });
  if (tag) fs.writeFileSync(path.join(OUT, tag + '.png'), buf);
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
};
const st = await page.evaluate(() => window.__gevGlStats());
out.stats = { fps: st.fps, count: st.count, scale: st.scale };
out.glassCanvas = await page.evaluate(() => { const c = document.getElementById('gev-gl-glass'); return [c.width, c.height, c.clientWidth, c.clientHeight, window.devicePixelRatio]; });
const card = st.surfaces.find((s) => s.id === 'data-panel') || st.surfaces[0];
out.card = card;
const x0 = Math.max(0, Math.round(card.rect[0] - 12)), y0 = Math.round(card.rect[1] + 4);
const w = 44, h = Math.max(8, Math.round(card.rect[3] - 8));
const edge = Math.round(card.rect[0]) - x0;

/* 顺序采样，全部在冻结状态下 */
const A = await grab(x0, y0, w, h, 'p3-on');
await page.evaluate(() => window.__gevGlSet({ gain: 0 }));
await new Promise((r) => setTimeout(r, 400));
const B = await grab(x0, y0, w, h, 'p3-gain0');
await page.evaluate(() => window.__gevGlSet({ gain: 0.9 }));
await new Promise((r) => setTimeout(r, 400));
const C = await grab(x0, y0, w, h, 'p3-on2');   // 稳定性对照：应与 A 几乎相同
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.52, etaHi: 1.52 }));
await new Promise((r) => setTimeout(r, 400));
const D = await grab(x0, y0, w, h, 'p3-eta-const');
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.48, etaHi: 1.56 }));
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.visibility = 'hidden'; });
await new Promise((r) => setTimeout(r, 400));
const R = await grab(x0, y0, w, h, 'p3-raw');
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.visibility = ''; });
await new Promise((r) => setTimeout(r, 400));
const A2 = await grab(x0, y0, w, h, 'p3-on3');  // 恢复后稳定性对照

const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
const perCol = (X, Y, fn) => {
  const rows = [];
  for (let cx = 0; cx < w; cx++) {
    let acc = 0, n = 0, mx = 0;
    for (let px = 0; px < DSF; px++) {
      const sx = cx * DSF + px; if (sx >= X.w) continue;
      for (let y = 0; y < h * DSF; y++) {
        const i = (y * X.w + sx) * X.ch;
        const v = fn(X.data, Y.data, i);
        acc += v; n++; if (v > mx) mx = v;
      }
    }
    rows.push({ d: cx - edge, mean: +(acc / Math.max(1, n)).toFixed(2), max: +mx.toFixed(1) });
  }
  return rows;
};

out.tests.stability = perCol(A, C, (a, b, i) => Math.abs(lum(a, i) - lum(b, i))).filter((r) => r.d >= 0 && r.d <= 20);
out.tests.refraction = perCol(A, B, (a, b, i) => Math.abs(lum(a, i) - lum(b, i))).filter((r) => r.d >= -2 && r.d <= 24);
out.tests.rim = perCol(A, R, (a, b, i) => (a[i] + a[i + 1] + a[i + 2]) / 3 - (b[i] + b[i + 1] + b[i + 2]) / 3).filter((r) => r.d >= -2 && r.d <= 20);
out.tests.dispersion = perCol(A, D, (a, b, i) => Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])).filter((r) => r.d >= 0 && r.d <= 20);
// 分通道色散最大值
let chMax = { R: 0, G: 0, B: 0 }, chMean = { R: 0, G: 0, B: 0 }, n = 0;
for (let cx = 0; cx < 14; cx++) {
  for (let px = 0; px < DSF; px++) {
    const sx = (edge + cx) * DSF + px; if (sx >= A.w) continue;
    for (let y = 0; y < h * DSF; y++) {
      const i = (y * A.w + sx) * A.ch;
      ['R', 'G', 'B'].forEach((k, o) => {
        const dv = Math.abs(A.data[i + o] - D.data[i + o]);
        if (dv > chMax[k]) chMax[k] = dv;
        chMean[k] += dv;
      });
      n++;
    }
  }
}
out.tests.dispersionChannels = { max: chMax, mean: Object.fromEntries(['R', 'G', 'B'].map((k) => [k, +(chMean[k] / Math.max(1, n)).toFixed(3)])), n };

fs.writeFileSync(path.join(OUT, 'review-probe3.json'), JSON.stringify(out, null, 1));
const fmt = (rows) => rows.map((r) => `${r.d}:${r.mean}${r.max !== undefined ? '/' + r.max : ''}`).join('  ');
console.log('viewer=' + JSON.stringify(out.viewer) + ' cam=' + out.cam + ' frozen=' + out.frozen);
console.log('stats=' + JSON.stringify(out.stats) + ' canvas(css,client,dpr)=' + JSON.stringify(out.glassCanvas) + ' card=' + JSON.stringify(card.rect) + ' clip=' + [x0, y0, w, h] + ' edge=' + edge);
console.log('STABILITY(on vs on2) ' + fmt(out.tests.stability));
console.log('REFRACTION(gain .9 vs 0) ' + fmt(out.tests.refraction));
console.log('RIM(on - raw, +/-) ' + fmt(out.tests.rim));
console.log('DISP(|on - etaConst| sumRGB) ' + fmt(out.tests.dispersion));
console.log('DISP_CHANNELS ' + JSON.stringify(out.tests.dispersionChannels));
console.log('errors=' + JSON.stringify(out.errors.slice(0, 5)));
await browser.close();
