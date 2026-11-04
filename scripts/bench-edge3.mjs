#!/usr/bin/env node
/**
 * bench-edge3.mjs —— 边缘折射环：低噪声 A/B 帧率 + 色散 A/B + 边缘特写 + 回归检查
 *  1) 同页内 A/B：edge off / on / off / on（每次 4s，剔除跨页噪声）
 *  2) 色散 A/B：testBg（R=G=B 黑白条纹）下 dispPx=0 vs dispPx=4.2，
 *     量边缘带里 R/B 空间错位（互相关最优位移）
 *  3) 边缘 4x 特写（真实地图）+ 中心通透度（卡内/卡外亮度比）
 *  4) 回归：展开/收缩 rect、页面 scrollWidth、卡内滚动条
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = 'http://localhost:4173/?gevEdge=1';
const W = 1536, H = 730;
const OUT = 'evidence/_collab/t_9739e3a7';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--window-position=1900,40', '--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--window-size=1536,820'],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (/gev-edge|shader|WebGL|ERR/i.test(t)) logs.push(t.slice(0, 240)); });
page.on('pageerror', (e) => logs.push('PAGEERR ' + String(e).slice(0, 240)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__gevEdge && document.getElementById('data-panel'), { timeout: 120000 });
await sleep(12000);
await page.keyboard.press('Escape');
await sleep(2000);

async function fps(label, ms = 4000) {
  const r = await page.evaluate(async (ms) => {
    const t = []; const t0 = performance.now();
    while (performance.now() - t0 < ms) { const a = performance.now(); await new Promise((res) => requestAnimationFrame(res)); t.push(performance.now() - a); }
    t.sort((x, y) => x - y); const p = (q) => +t[Math.floor(t.length * q)].toFixed(2);
    return { p50: p(0.5), p90: p(0.9), p99: p(0.99), fps50: +(1000 / p(0.5)).toFixed(1), fps90: +(1000 / p(0.9)).toFixed(1) };
  }, ms);
  console.log('  ' + label.padEnd(30), JSON.stringify(r));
  return r;
}
const res = { fps: {}, stats: {}, regress: {}, dispersion: {} };

/* ── 1) 同页 A/B 帧率（折叠态） ─────────────────────────────────────────── */
for (const ph of [['off1', false], ['on1', true], ['off2', false], ['on2', true]]) {
  await page.evaluate((v) => v ? window.__gevEdge.on() : window.__gevEdge.off(), ph[1]);
  await sleep(600);
  res.fps['collapsed_' + ph[0]] = await fps('collapsed ' + ph[0]);
}
/* 展开 data-panel 再 A/B */
await page.evaluate(() => {
  const el = document.getElementById('data-panel'); const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 30, clientY: r.top + 20 }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + 30, clientY: r.top + 20 }));
});
await sleep(1500);
for (const ph of [['off1', false], ['on1', true], ['off2', false], ['on2', true]]) {
  await page.evaluate((v) => v ? window.__gevEdge.on() : window.__gevEdge.off(), ph[1]);
  await sleep(600);
  res.fps['expanded_' + ph[0]] = await fps('expanded ' + ph[0]);
}
res.stats.expanded = await page.evaluate(() => window.__gevEdge.stats());
await page.evaluate(() => window.__gevEdge.on());
await sleep(400);
await page.screenshot({ path: `${OUT}/edge3-real-expanded.png` });

/* 卡 rect（展开态） */
const rectExp = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });

/* ── 2) 色散 A/B（合成条纹底 + 单卡） ───────────────────────────────────── */
await page.evaluate(() => { window.__gevEdge.only(['data-panel']); window.__gevEdge.testBg(true, 8); window.__gevEdge.set({ dispPx: 4.2 }); });
await sleep(900);
await page.screenshot({ path: `${OUT}/edge3-disp-on.png` });
await page.evaluate(() => window.__gevEdge.set({ dispPx: 0 }));
await sleep(700);
await page.screenshot({ path: `${OUT}/edge3-disp-off.png` });
/* 中心带（远离边缘、>25px）在同一张图上作对照 */
async function bandStats(png, box) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels, iw = info.width;
  const get = (x, y) => { const i = (y * iw + x) * ch; return [data[i], data[i + 1], data[i + 2]]; };
  // 左侧边缘带：x 在 [bar.x+1, bar.x+12]，y 在 中部 60%
  const rows = [];
  for (let y = box.y + Math.round(box.h * 0.2); y < box.y + Math.round(box.h * 0.8); y++) {
    const R = [], G = [], B = [];
    for (let x = box.x + 1; x <= box.x + 12; x++) { const c = get(x, y); R.push(c[0]); G.push(c[1]); B.push(c[2]); }
    rows.push({ R, G, B });
  }
  const corr = (a, b, shift) => {
    let s = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { const j = i + shift; if (j < 0 || j >= b.length) continue; s += a[i] * b[j]; na += a[i] * a[i]; nb += b[j] * b[j]; }
    return s / Math.sqrt(Math.max(1e-6, na * nb));
  };
  let bestShift = 0, bestVal = -2;
  const shiftCurve = {};
  for (let sh = -3; sh <= 3; sh++) {
    let acc = 0;
    for (const r of rows) acc += corr(r.R, r.B, sh);
    acc /= rows.length; shiftCurve[sh] = +acc.toFixed(3);
    if (acc > bestVal) { bestVal = acc; bestShift = sh; }
  }
  // 通道均值差（带内 vs 参考：同一帧卡外纯条纹）
  let drg = 0, dgb = 0, n = 0;
  for (const r of rows) for (let i = 0; i < r.R.length; i++) { drg += Math.abs(r.R[i] - r.G[i]); dgb += Math.abs(r.G[i] - r.B[i]); n++; }
  return { bestShift, bestVal: +bestVal.toFixed(3), shiftCurve, meanAbsRG: +(drg / n).toFixed(2), meanAbsGB: +(dgb / n).toFixed(2), rows: rows.length };
}
const box = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
res.dispersion.on = await bandStats(`${OUT}/edge3-disp-on.png`, box);
res.dispersion.off = await bandStats(`${OUT}/edge3-disp-off.png`, box);
res.dispersion.box = box;

/* 4x 特写（左边缘 + 上边缘） */
async function crop(png, region, name, zoom = 4) {
  await sharp(png).extract({ left: region.x, top: region.y, width: region.w, height: region.h })
    .resize({ width: region.w * zoom, height: region.h * zoom, kernel: 'nearest' })
    .toFile(`${OUT}/${name}.png`);
}
await page.evaluate(() => { window.__gevEdge.only(null); window.__gevEdge.testBg(false); window.__gevEdge.set({ dispPx: 4.2 }); });
await sleep(900);
await page.screenshot({ path: `${OUT}/edge3-real2.png` });
await crop(`${OUT}/edge3-real2.png`, { x: box.x - 6, y: box.y + 40, w: 60, h: 120 }, 'zoom-left-edge-4x', 6);
await crop(`${OUT}/edge3-real2.png`, { x: box.x + 40, y: box.y - 6, w: 120, h: 60 }, 'zoom-top-edge-4x', 6);
await crop(`${OUT}/edge3-real2.png`, { x: box.x + box.w - 54, y: box.y + 40, w: 60, h: 120 }, 'zoom-right-edge-4x', 6);
const collBox = await page.evaluate(() => { const r = document.getElementById('pp-toggles').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
await crop(`${OUT}/edge3-real2.png`, { x: collBox.x - 6, y: collBox.y - 6, w: 60, h: 64 }, 'zoom-pp-toggles-corner-6x', 6);

/* ── 3) 中心通透度（卡内/卡外亮度比） ──────────────────────────────────── */
{
  const { data, info } = await sharp(`${OUT}/edge3-real2.png`).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels, iw = info.width;
  const lum = (x0, y0, w, h) => { let n = 0, s = 0; for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * iw + x) * ch; s += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n++; } return +(s / n).toFixed(1); };
  const inside = lum(box.x + 20, box.y + 150, 100, 60);
  const outside = lum(box.x + box.w + 40, box.y + 150, 100, 60);
  res.center = { inside, outside, ratio: +(inside / Math.max(1, outside)).toFixed(3) };
  // 边缘带亮度（应接近卡内，不是纯黑）
  res.center.edgeBand = lum(box.x + 2, box.y + 150, 8, 60);
}

/* ── 4) 回归：收起回原位 / 滚动条 / 页面宽度 ────────────────────────────── */
const before = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
await page.evaluate(() => {
  const el = document.getElementById('data-panel'); const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 30, clientY: r.top + 20 }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + 30, clientY: r.top + 20 }));
});
await sleep(1400);
const after = await page.evaluate(() => {
  const r = document.getElementById('data-panel').getBoundingClientRect();
  const el = document.getElementById('data-panel');
  return {
    rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    pageScrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
    cardSb: el.scrollWidth - el.clientWidth,
    hiddenCards: document.querySelectorAll('.gev-lc-hid').length,
    edgeCanvas: !!document.getElementById('gev-edge-lens'),
    htmlClass: document.documentElement.className,
    rimCount: document.querySelectorAll('.gev-lg-rim').length,
    warpCount: document.querySelectorAll('.gev-lg-warp').length,
    warpInset: getComputedStyle(document.querySelector('#pp-toggles .gev-lg-warp')).inset,
    warpMask: (getComputedStyle(document.querySelector('#pp-toggles .gev-lg-warp')).maskImage || '').slice(0, 90),
  };
});
res.regress = { beforeExpanded: before, afterCollapsed: after };
await page.screenshot({ path: `${OUT}/edge3-collapsed-after.png` });
res.logs = logs.slice(-15);
fs.writeFileSync(`${OUT}/bench-edge3.json`, JSON.stringify(res, null, 1));
console.log('\nDISPERSION', JSON.stringify(res.dispersion, null, 1));
console.log('CENTER', JSON.stringify(res.center));
console.log('REGRESS', JSON.stringify(res.regress));
console.log('STATS', JSON.stringify({ fps: res.stats.expanded && res.stats.expanded.fps, post: res.stats.expanded && res.stats.expanded.post, tex: res.stats.expanded && res.stats.expanded.tex, err: res.stats.expanded && res.stats.expanded.err }));
await browser.close();
