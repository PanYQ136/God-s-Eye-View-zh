#!/usr/bin/env node
/**
 * qa-gev-glass.mjs —— 3:25 rdev SVG 折射的像素级取证
 *  A) 边缘色散 / 中心干净：开/关 filter:url(#gev-lg-filter) 两帧逐像素差分，
 *     按「到最近卡片边框的距离」分桶 → 边缘 0–3px 变化大、内部 ≥6px 变化≈0（EDGE_MASK 成立）
 *  B) 中心透明：把卡片底色/折射层临时去掉拍一帧「纯地图」，与正常帧同区域做相关系数 + 亮度比
 *  C) 亮/暗档：读 data-gev-glass-lum 下的卡壳底色
 * 用法: node scripts/qa-gev-glass.mjs
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'evidence/_collab/t_8cf06356';
fs.mkdirSync(OUT, { recursive: true });
const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', `--window-size=${W},${H + 90}`],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(1500);
// 关掉 Cesium 自带的时间动画影响：等一帧稳定
await page.evaluate(() => { document.querySelectorAll('.cesium-widget-credits').forEach((e) => e.style.visibility = 'hidden'); });
await sleep(400);

const rects = await page.evaluate(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
  const out = {};
  ids.forEach((id) => { const el = document.getElementById(id); if (!el) return; const b = el.getBoundingClientRect(); out[id] = [b.left, b.top, b.width, b.height].map(Math.round); });
  return out;
});
const shots = {};

// ① 正常帧
const p1 = path.join(OUT, 'glass-on.png');
await page.screenshot({ path: p1 }); shots.normal = p1;

// ② 关掉 SVG 位移滤镜（保留 backdrop blur6）→ 差分包住的就是「折射/色散」
await page.evaluate(() => document.querySelectorAll('.gev-lg-warp').forEach((w) => { w.style.filter = 'none'; }));
await sleep(700);
const p2 = path.join(OUT, 'glass-filter-off.png');
await page.screenshot({ path: p2 }); shots.noFilter = p2;

// ③ 纯地图参照帧（去掉卡壳底色 + 折射层）
await page.evaluate(() => {
  const st = document.createElement('style'); st.id = '__probe_map_only';
  st.textContent = '.gev-lc{background:transparent!important;box-shadow:none!important}.gev-lg-warp{display:none!important}';
  document.head.appendChild(st);
});
await sleep(700);
const p3 = path.join(OUT, 'glass-map-only.png');
await page.screenshot({ path: p3 }); shots.mapOnly = p3;

// ④ 亮底档取值
const lumProbe = await page.evaluate(() => {
  const h = document.documentElement;
  const before = getComputedStyle(document.getElementById('data-panel')).backgroundColor;
  h.dataset.gevGlassLum = 'bright';
  const bright = getComputedStyle(document.getElementById('data-panel')).backgroundColor;
  h.dataset.gevGlassLum = 'dark';
  const dark = getComputedStyle(document.getElementById('data-panel')).backgroundColor;
  delete h.dataset.gevGlassLum;
  const dflt = getComputedStyle(document.getElementById('data-panel')).backgroundColor;
  return { dflt, dark, bright };
});

// ── 像素分析 ────────────────────────────────────────────────────────────────
const raw = async (p) => { const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true }); return { data, info }; };
const A = await raw(shots.normal), B = await raw(shots.noFilter), C = await raw(shots.mapOnly);
const { width: w, height: h, channels: ch } = A.info;

// 到最近卡片边框的距离
function edgeDist(x, y) {
  let best = 1e9;
  for (const id in rects) {
    const [rx, ry, rw, rh] = rects[id];
    if (x < rx - 4 || x > rx + rw + 4 || y < ry - 4 || y > ry + rh + 4) continue;
    const d = Math.min(Math.abs(x - rx), Math.abs(x - (rx + rw)), Math.abs(y - ry), Math.abs(y - (ry + rh)));
    if (d < best) best = d;
  }
  return best;
}
const buckets = { '0-1px': { n: 0, diff: 0, maxdiff: 0 }, '2-3px': { n: 0, diff: 0, maxdiff: 0 }, '4-6px': { n: 0, diff: 0, maxdiff: 0 }, '7-20px': { n: 0, diff: 0, maxdiff: 0 }, '>20px': { n: 0, diff: 0, maxdiff: 0 } };
let chanSpread = { n: 0, sumR: 0, sumG: 0, sumB: 0 };
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const d = edgeDist(x, y);
    if (d > 30) continue;
    const i = (y * w + x) * ch;
    const dr = Math.abs(A.data[i] - B.data[i]), dg = Math.abs(A.data[i + 1] - B.data[i + 1]), db = Math.abs(A.data[i + 2] - B.data[i + 2]);
    const m = Math.max(dr, dg, db);
    const key = d <= 1 ? '0-1px' : d <= 3 ? '2-3px' : d <= 6 ? '4-6px' : d <= 20 ? '7-20px' : '>20px';
    buckets[key].n++; buckets[key].diff += m; buckets[key].maxdiff = Math.max(buckets[key].maxdiff, m);
    if (d <= 2 && m > 8) { chanSpread.n++; chanSpread.sumR += dr; chanSpread.sumG += dg; chanSpread.sumB += db; }
  }
}
const bucketOut = {};
for (const k in buckets) bucketOut[k] = { pixels: buckets[k].n, meanDiff: +(buckets[k].diff / Math.max(1, buckets[k].n)).toFixed(2), maxDiff: buckets[k].maxdiff };

// B) 中心透明：卡片内部（去掉文字/边缘）patch 与「纯地图」参照帧的相关系数 / 亮度比
function patchStats(x0, y0, ww, hh) {
  const lum = (buf, i) => 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, la = 0, lb = 0;
  for (let y = y0; y < y0 + hh; y++) for (let x = x0; x < x0 + ww; x++) {
    const i = (y * w + x) * ch;
    const a = lum(A.data, i), b = lum(C.data, i);
    n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; la += a; lb += b;
  }
  const ma = sa / n, mb = sb / n;
  const cov = sab / n - ma * mb;
  const va = saa / n - ma * ma, vb = sbb / n - mb * mb;
  const r = cov / Math.sqrt(Math.max(1e-6, va * vb));
  return { meanCard: +ma.toFixed(1), meanMap: +mb.toFixed(1), ratio: +(ma / mb).toFixed(3), corr: +r.toFixed(3), sdCard: +Math.sqrt(va).toFixed(1) };
}
const samples = {
  'data-panel header': [150, 100, 66, 30],
  'pp-toggles header': [1400, 100, 70, 34],
  'location-bar body': [600, 650, 60, 50],
  'control-panel body': [900, 650, 60, 50],
  'map control (no card)': [760, 300, 60, 50],
};
const transparency = {};
for (const k in samples) transparency[k] = patchStats(...samples[k]);

// C) 边缘色散证据：取 data-panel 左边框上下 1px 带内的 RGB 平均差
const fringe = (() => {
  const [rx, ry, rw, rh] = rects['data-panel'];
  let n = 0, sr = 0, sg = 0, sb = 0;
  for (let y = ry + 4; y < ry + rh - 4; y++) for (let x = rx - 2; x <= rx + 3; x++) {
    const i = (y * w + x) * ch;
    const dr = A.data[i] - B.data[i], dg = A.data[i + 1] - B.data[i + 1], db = A.data[i + 2] - B.data[i + 2];
    if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) < 4) continue;
    n++; sr += Math.abs(dr); sg += Math.abs(dg); sb += Math.abs(db);
  }
  return { px: n, meanAbsDr: +(sr / Math.max(1, n)).toFixed(2), meanAbsDg: +(sg / Math.max(1, n)).toFixed(2), meanAbsDb: +(sb / Math.max(1, n)).toFixed(2) };
})();

// 放大截图：左上 data-panel + 右栏 pp 的边缘细节
await page.evaluate(() => { const s = document.getElementById('__probe_map_only'); if (s) s.remove(); document.querySelectorAll('.gev-lg-warp').forEach((w) => { w.style.filter = 'url(#gev-lg-filter)'; }); });
await sleep(800);
await page.screenshot({ path: path.join(OUT, 'zoom-data-panel.png'), clip: { x: 40, y: 82, width: 200, height: 70 } });
await page.screenshot({ path: path.join(OUT, 'zoom-pp.png'), clip: { x: 1296, y: 82, width: 200, height: 70 } });
await page.screenshot({ path: path.join(OUT, 'zoom-dock.png'), clip: { x: 520, y: 620, width: 500, height: 110 } });

const report = { errs, rects, lumProbe, edgeBuckets: bucketOut, fringeRGB: fringe, chanSpreadPx: chanSpread, transparency, shots };
fs.writeFileSync(path.join(OUT, 'glass-report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
