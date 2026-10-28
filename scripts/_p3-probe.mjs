#!/usr/bin/env node
/**
 * _p3-probe.mjs —— Phase 3 现场探针（基线 / 应用后同一口径）
 *  - 应用 rAF 3s×3 中位（禁 glassStats）
 *  - 卡壳与 warp 的 computed 材质（fill / backdrop / inset）
 *  - __gevEdge.stats()（环带 surfaces / err / 自报 fps）
 *  - 1536×730 全图 + dsf2 边缘/角部特写
 *
 * 用法: node scripts/_p3-probe.mjs --tag=base [--headful]
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const TAG = (process.argv.find((a) => a.startsWith('--tag=')) || '--tag=probe').split('=')[1];
const OUT = path.resolve('.gev-logs/phase3', TAG);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: !process.argv.includes('--headful'),
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
    '--window-size=1560,860', '--window-position=1900,40', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
  ],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
    localStorage.setItem('gev.gfx', JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'default' }));
  } catch (e) {}
});
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 300)); });

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
// 等加载幕消失（与 Phase 1 同口径）
for (let i = 0; i < 120; i++) {
  const gone = await page.evaluate(() => {
    const l = document.querySelector('#loading-screen');
    if (!l) return true;
    return parseFloat(getComputedStyle(l).opacity || '1') < 0.05;
  }).catch(() => false);
  if (gone) break;
  await sleep(500);
}
await sleep(6000); // 等自动展开/布局沉降

const fps = [];
for (let i = 0; i < 3; i++) {
  const v = await page.evaluate(
    (ms) => new Promise((res) => {
      let n = 0; const t0 = performance.now();
      (function f() { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(+(n / ((performance.now() - t0) / 1000)).toFixed(1)); })();
    }), 3000);
  fps.push(v);
  await sleep(400);
}
const mat = await page.evaluate(() => {
  const one = (sel, props) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const o = {};
    for (const p of props) o[p] = cs.getPropertyValue(p);
    const r = el.getBoundingClientRect();
    o.rect = [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    return o;
  };
  return {
    shell: one('.gev-lc', ['background-color', 'backdrop-filter', 'box-shadow', 'border-radius', 'corner-shape']),
    warp: one('.gev-lg-warp', ['inset', 'backdrop-filter', 'filter', 'mask-image', 'border-radius']),
    lum: document.documentElement.getAttribute('data-gev-glass-lum'),
    cards: [...document.querySelectorAll('.gev-lc')].map((c) => ({
      id: c.id || c.getAttribute('data-panel-id') || c.className.slice(0, 40),
      rect: (() => { const r = c.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })(),
    })),
    edge: (() => { try { const s = window.__gevEdge && window.__gevEdge.stats(); if (!s) return null; return { fps: s.fps, fpsRaw: s.fpsRaw, p50: s.p50, p90: s.p90, frames: s.frames, post: s.post, raf: s.raf, tex: s.tex, err: s.err, scale: s.scale, surfaces: (s.surfaces || []).map((x) => ({ id: x.id, band: x.band, rect: x.rect })) }; } catch (e) { return { err: String(e && e.message) }; } })(),
    lensSvg: document.documentElement.classList.contains('gev-lens-svg'),
  };
});
await page.screenshot({ path: path.join(OUT, 'full-1536x730.png') });
// dsf2 特写：data-panel 右上角 + 右边缘 + dock 托盘
const cards = mat.cards;
const pick = (id) => cards.find((c) => String(c.id).includes(id)) || cards[0];
const crops = {};
for (const [name, r] of [
  ['data-tr', pick('data-panel')],
  ['dock', pick('location-bar') || pick('control-panel')],
]) {
  if (!r) continue;
  const [x, y, w, h] = r.rect;
  const box = name === 'data-tr'
    ? { x: x + w - 90, y: y - 8, width: 110, height: 110 }
    : { x: x - 8, y: y - 8, width: w + 16, height: h + 16 };
  await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
  await sleep(600);
  await page.screenshot({ path: path.join(OUT, name + '-dsf2.png'), clip: { ...box, captureBeyondViewport: false } });
  crops[name] = box;
  await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
  await sleep(400);
}
const sorted = [...fps].sort((a, b) => a - b);
const out = { tag: TAG, at: new Date().toISOString(), fpsRuns: fps, fpsMedian: sorted[1], mat, crops, errs };
fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ tag: TAG, fpsRuns: fps, fpsMedian: sorted[1], shell: mat.shell, warp: mat.warp, lum: mat.lum, cards: mat.cards.length, edge: mat.edge && { fps: mat.edge.fps, p50: mat.edge.p50, tex: mat.edge.tex, err: mat.edge.err, n: (mat.edge.surfaces || []).length, band: (mat.edge.surfaces || [])[0] && mat.edge.surfaces[0].band }, errs: errs.slice(0, 5) }, null, 2));
await browser.close();
