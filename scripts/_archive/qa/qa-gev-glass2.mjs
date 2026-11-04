#!/usr/bin/env node
/**
 * qa-gev-glass2.mjs —— 3:25 rdev SVG 折射取证的「冻结底图」版
 *  底图 = 静态高对比条纹（Cesium 画布隐藏），所以任何两帧差分都只反映滤镜本身。
 *  A) 边缘色散 / 中心干净：filter 开 vs 关 逐像素差分，按到最近卡片边框距离分桶
 *  B) 中心透明：卡壳底色+折射层临时去掉（纯条纹）vs 正常帧，同区域相关 / 亮度比
 *  C) 亮/暗档卡壳底色取值
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'evidence/_collab/t_8cf06356';
fs.mkdirSync(OUT, { recursive: true });
const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 生成 64x64 条纹底图（4 条 16px 竖条 + 1px 细线），base64 注入 */
const SW = 64, SH = 64, buf = Buffer.alloc(SW * SH * 3);
const cols = [[235, 55, 55], [55, 225, 90], [70, 95, 240], [245, 245, 245]];
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
  const c = cols[Math.floor(x / 16) % 4];
  let k = 1;
  if (y % 16 === 0) k = 0.45;            // 细横线：给位移提供高频参照
  const i = (y * SW + x) * 3;
  buf[i] = c[0] * k; buf[i + 1] = c[1] * k; buf[i + 2] = c[2] * k;
}
const patternPng = await sharp(buf, { raw: { width: SW, height: SH, channels: 3 } }).png().toBuffer();
const patternB64 = 'data:image/png;base64,' + patternPng.toString('base64');
fs.writeFileSync(path.join(OUT, 'probe-pattern.png'), patternPng);

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
await sleep(1200);

// 冻结底图：隐藏 Cesium 画布 + 铺静态条纹 + 隐藏版权/CCTV 视频等动态内容
await page.evaluate((b64) => {
  const st = document.createElement('style'); st.id = '__probe_freeze';
  st.textContent = `
    .cesium-widget, .cesium-widget canvas, .cesium-viewer, #cesiumContainer canvas { visibility: hidden !important; }
    .cesium-widget-credits, .cesium-viewer-bottom { display: none !important; }
    #__probe_bg { position: fixed; inset: 0; z-index: 0; background-image: url(${b64}); background-repeat: repeat; }
    video { visibility: hidden !important; }
  `;
  document.head.appendChild(st);
  const d = document.createElement('div'); d.id = '__probe_bg'; document.body.appendChild(d);
}, patternB64);
await sleep(900);

const rects = await page.evaluate(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
  const out = {};
  ids.forEach((id) => { const el = document.getElementById(id); if (!el) return; const b = el.getBoundingClientRect(); out[id] = [b.left, b.top, b.width, b.height].map(Math.round); });
  return out;
});

const shot = async (name) => { const p = path.join(OUT, name); await page.screenshot({ path: p }); return p; };

const pOn = await shot('frozen-glass-on.png');

// ① 关 filter（保留 blur6）
await page.evaluate(() => document.querySelectorAll('.gev-lg-warp').forEach((w) => { w.style.filter = 'none'; }));
await sleep(600);
const pOff = await shot('frozen-filter-off.png');

// ② 关 blur 也关 filter（只剩卡壳底色）—— 用来量「中心是否干净=无位移」
await page.evaluate(() => { const s = document.createElement('style'); s.id = '__probe_nofx'; s.textContent = '.gev-lg-warp{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;display:none!important}'; document.head.appendChild(s); });
await sleep(600);
const pPlain = await shot('frozen-plain.png');
await page.evaluate(() => { const s = document.getElementById('__probe_nofx'); if (s) s.remove(); document.querySelectorAll('.gev-lg-warp').forEach((w) => { w.style.filter = 'url(#gev-lg-filter)'; }); });
await sleep(600);

// ③ 纯条纹参照（去掉卡壳底色 + 折射层）
await page.evaluate(() => { const s = document.createElement('style'); s.id = '__probe_map'; s.textContent = '.gev-lc{background:transparent!important;box-shadow:none!important;color:transparent!important}.gev-lc *{color:transparent!important}.gev-lg-warp{display:none!important}'; document.head.appendChild(s); });
await sleep(600);
const pMap = await shot('frozen-pattern-only.png');
await page.evaluate(() => { const s = document.getElementById('__probe_map'); if (s) s.remove(); });
await sleep(600);

const lumProbe = await page.evaluate(() => {
  const h = document.documentElement, el = document.getElementById('data-panel');
  const dflt = getComputedStyle(el).backgroundColor;
  h.dataset.gevGlassLum = 'bright'; const bright = getComputedStyle(el).backgroundColor;
  h.dataset.gevGlassLum = 'dark'; const dark = getComputedStyle(el).backgroundColor;
  delete h.dataset.gevGlassLum;
  return { dflt, dark, bright };
});

/* ── 像素分析 ───────────────────────────────────────────────────────────── */
const raw = async (p) => { const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true }); return { data, info }; };
const A = await raw(pOn), B = await raw(pOff), C = await raw(pMap);
const { width: w, height: h, channels: ch } = A.info;

function edgeDist(x, y) {
  let best = 1e9;
  for (const id in rects) {
    const [rx, ry, rw, rh] = rects[id];
    if (x < rx - 2 || x > rx + rw + 2 || y < ry - 2 || y > ry + rh + 2) continue;
    const d = Math.min(Math.abs(x - rx), Math.abs(x - (rx + rw)), Math.abs(y - ry), Math.abs(y - (ry + rh)));
    if (d < best) best = d;
  }
  return best;
}
const buckets = {};
const add = (k, m) => { (buckets[k] = buckets[k] || { n: 0, sum: 0, max: 0 }).n++; buckets[k].sum += m; buckets[k].max = Math.max(buckets[k].max, m); };
// 只看卡片区域内部/边缘（到边框 ≤24px），排除卡外地图
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const d = edgeDist(x, y);
  if (d > 24) continue;
  const i = (y * w + x) * ch;
  const m = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
  add(d <= 1 ? 'edge 0-1px' : d <= 3 ? 'edge 2-3px' : d <= 8 ? 'inner 4-8px' : 'inner 9-24px', m);
}
const edgeBuckets = {};
for (const k in buckets) edgeBuckets[k] = { px: buckets[k].n, meanDiff: +(buckets[k].sum / buckets[k].n).toFixed(2), maxDiff: buckets[k].max };

// 边缘 RGB 通道差（色散证据）
const [drx, dry, drw, drh] = rects['data-panel'];
const fringe = (() => {
  let n = 0, sr = 0, sg = 0, sb = 0;
  for (let y = dry + 3; y < dry + drh - 3; y++) for (let x = drx - 1; x <= drx + 2; x++) {
    const i = (y * w + x) * ch;
    const dr = A.data[i] - B.data[i], dg = A.data[i + 1] - B.data[i + 1], db = A.data[i + 2] - B.data[i + 2];
    if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) < 3) continue;
    n++; sr += Math.abs(dr); sg += Math.abs(dg); sb += Math.abs(db);
  }
  return { px: n, meanAbsDr: +(sr / Math.max(1, n)).toFixed(2), meanAbsDg: +(sg / Math.max(1, n)).toFixed(2), meanAbsDb: +(sb / Math.max(1, n)).toFixed(2), note: 'R/G/B 位移量不同（-24/-26.4/-28.8）→ 三个通道差分不应相等' };
})();

// 中心透明：卡内 patch 与「纯条纹」帧的相关 / 亮度比 / 对比度保留
function patchStats(x0, y0, ww, hh) {
  const lum = (b, i) => 0.2126 * b[i] + 0.7152 * b[i + 1] + 0.0722 * b[i + 2];
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let y = y0; y < y0 + hh; y++) for (let x = x0; x < x0 + ww; x++) {
    const i = (y * w + x) * ch; const a = lum(A.data, i), b = lum(C.data, i);
    n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
  }
  const ma = sa / n, mb = sb / n;
  const va = saa / n - ma * ma, vb = sbb / n - mb * mb;
  const cov = sab / n - ma * mb;
  return {
    meanCard: +ma.toFixed(1), meanPattern: +mb.toFixed(1),
    ratio: +(ma / Math.max(1, mb)).toFixed(3),
    corr: +(cov / Math.sqrt(Math.max(1e-6, va * vb))).toFixed(3),
    sdCard: +Math.sqrt(Math.max(0, va)).toFixed(1), sdPattern: +Math.sqrt(Math.max(0, vb)).toFixed(1),
  };
}
const samples = {
  'data-panel 卡内': [150, 100, 64, 30],
  'pp-toggles 卡内': [1408, 104, 60, 30],
  'location-bar 卡内': [640, 648, 40, 40],
  'control-panel 卡内': [900, 648, 40, 40],
  '卡外条纹参照': [700, 300, 60, 50],
};
const transparency = {};
for (const k in samples) transparency[k] = patchStats(...samples[k]);

// 缩略/放大证据图
const zoom = async (name, clip) => { await page.screenshot({ path: path.join(OUT, name), clip }); };
await page.evaluate(() => { const s = document.getElementById('__probe_map'); if (s) s.remove(); });
await sleep(700);
await zoom('frozen-zoom-data.png', { x: 40, y: 82, width: 210, height: 74 });
await zoom('frozen-zoom-pp.png', { x: 1292, y: 82, width: 210, height: 74 });
await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
await sleep(900);
await zoom('frozen-zoom2-data-edge.png', { x: 46, y: 88, width: 100, height: 60 });
await zoom('frozen-zoom2-pp-edge.png', { x: 1300, y: 88, width: 100, height: 60 });
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

const report = { errs, rects, lumProbe, edgeBuckets, fringeRGB: fringe, transparency };
fs.writeFileSync(path.join(OUT, 'glass-report2.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
