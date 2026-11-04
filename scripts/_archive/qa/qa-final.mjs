#!/usr/bin/env node
/**
 * qa-final.mjs —— 最终构建：帧率 A/B（3 次取中位）+ 回归 + 出图
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1536, H = 730, OUT = 'evidence/_collab/t_9739e3a7';
const res = {};
const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--window-position=1900,40', '--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--window-size=1536,820'],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (/gev-edge|shader|PAGEERR/i.test(t)) logs.push(t.slice(0, 200)); });
page.on('pageerror', (e) => logs.push('PAGEERR ' + String(e).slice(0, 200)));
await page.goto('http://localhost:4173/?gevEdge=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__gevEdge && document.getElementById('data-panel'), { timeout: 120000 });
await sleep(13000);
await page.keyboard.press('Escape');
await sleep(2000);

async function fpsOnce(ms = 4000) {
  return page.evaluate(async (ms) => {
    const t = []; const t0 = performance.now();
    while (performance.now() - t0 < ms) { const a = performance.now(); await new Promise((r) => requestAnimationFrame(r)); t.push(performance.now() - a); }
    t.sort((x, y) => x - y); const p = (q) => +t[Math.floor(t.length * q)].toFixed(2);
    return { p50: p(0.5), p90: p(0.9), fps50: +(1000 / p(0.5)).toFixed(1), fps90: +(1000 / p(0.9)).toFixed(1) };
  }, ms);
}
async function ab(on, reps = 3) {
  const a = [];
  for (let i = 0; i < reps; i++) { await page.evaluate((v) => (v ? window.__gevEdge.on() : window.__gevEdge.off()), on); await sleep(500); a.push(await fpsOnce()); }
  const med = (k) => a.map((x) => x[k]).sort((x, y) => x - y)[Math.floor(a.length / 2)];
  return { reps: a.map((x) => x.fps50), fps50: med('fps50'), fps90: med('fps90'), p50: med('p50') };
}
res.collapsed = { off: await ab(false), on: await ab(true) };
await page.evaluate(() => window.__gevEdge.on()); await sleep(600);
await page.screenshot({ path: `${OUT}/final-collapsed.png` });
await page.evaluate(() => {
  const el = document.getElementById('data-panel'); const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 30, clientY: r.top + 16 }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + 30, clientY: r.top + 16 }));
});
await sleep(1700);
res.expanded = { off: await ab(false), on: await ab(true) };
await page.evaluate(() => window.__gevEdge.on()); await sleep(700);
await page.screenshot({ path: `${OUT}/final-expanded.png` });
res.stats = await page.evaluate(() => window.__gevEdge.stats());
const box = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
await sharp(`${OUT}/final-expanded.png`).extract({ left: box[0] - 6, top: box[1] + 28, width: 58, height: 116 })
  .resize({ width: 58 * 6, height: 116 * 6, kernel: 'nearest' }).toFile(`${OUT}/final-exp-left-6x.png`);
await sharp(`${OUT}/final-expanded.png`).extract({ left: box[0] + 30, top: box[1] - 6, width: 120, height: 58 })
  .resize({ width: 120 * 6, height: 58 * 6, kernel: 'nearest' }).toFile(`${OUT}/final-exp-top-6x.png`);

/* 回归 */
const r1 = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
await page.evaluate(() => {
  const el = document.getElementById('data-panel'); const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 30, clientY: r.top + 16 }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + 30, clientY: r.top + 16 }));
});
await sleep(1900);
res.regress = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const r = el.getBoundingClientRect();
  const pp = document.getElementById('pp-toggles');
  const w = pp.querySelector('.gev-lg-warp');
  const cs = getComputedStyle(w);
  return {
    collapsedRect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    pageScrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
    cardSbW: el.scrollWidth - el.clientWidth, cardSbH: el.scrollHeight - el.clientHeight,
    hidden: document.querySelectorAll('.gev-lc-hid').length, floating: document.querySelectorAll('.gev-lc-floating').length,
    placeholder: document.querySelectorAll('.gev-lc-placeholder').length,
    rim: document.querySelectorAll('.gev-lg-rim').length, warp: document.querySelectorAll('.gev-lg-warp').length,
    inset: cs.inset, maskComposite: cs.maskComposite, backdrop: cs.backdropFilter, filter: cs.filter,
    edgeCanvas: !!document.getElementById('gev-edge-lens'), htmlClass: document.documentElement.className,
    scrollbarW: getComputedStyle(pp, '::-webkit-scrollbar').width,
  };
});
await page.screenshot({ path: `${OUT}/final-after-collapse.png` });
res.logs = logs.slice(-10);
fs.writeFileSync(`${OUT}/qa-final.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify({ collapsed: res.collapsed, expanded: res.expanded, regress: res.regress, count: res.stats.count, tex: res.stats.tex, err: res.stats.err, renderer: res.stats.renderer, logs: res.logs }, null, 1));
await browser.close();
