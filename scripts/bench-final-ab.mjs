#!/usr/bin/env node
/** bench-final-ab.mjs —— 最终默认（cap 跟随 Cesium）帧率 A/B：off/on/off/on × 2 态 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--window-position=1900,40', '--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--window-size=1536,820'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__gevEdge && window.__gevEdge.stats().frames > 0, { timeout: 120000 });
await sleep(12000); await sleep(6000);
await page.keyboard.press('Escape'); await sleep(2000);
async function fps() {
  return page.evaluate(async () => {
    const t = []; const t0 = performance.now();
    while (performance.now() - t0 < 4000) { const a = performance.now(); await new Promise((r) => requestAnimationFrame(r)); t.push(performance.now() - a); }
    t.sort((x, y) => x - y); const p = (q) => +t[Math.floor(t.length * q)].toFixed(2);
    const s = window.__gevEdge.stats();
    return { fps50: +(1000 / p(0.5)).toFixed(1), p50: p(0.5), p90: p(0.9), ringFps: s.fps, count: s.count, cap: s.cap };
  });
}
const out = { collapsed: {}, expanded: {} };
const phase = async (tag) => {
  for (const on of [false, true, false, true, false, true]) {
    await page.evaluate((v) => (v ? window.__gevEdge.on() : window.__gevEdge.off()), on);
    await sleep(600);
    const r = await fps();
    (out[tag][on ? 'on' : 'off'] ||= []).push(r);
  }
};
await phase('collapsed');
await page.evaluate(() => {
  const el = document.getElementById('data-panel'); const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 30, clientY: r.top + 16 }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + 30, clientY: r.top + 16 }));
});
await sleep(1700);
await phase('expanded');
const med = (a, k) => a.map((x) => x[k]).sort((x, y) => x - y)[Math.floor(a.length / 2)];
const sum = {};
for (const k of ['collapsed', 'expanded']) for (const s of ['off', 'on']) sum[k + '_' + s] = { reps: out[k][s].map((x) => x.fps50), fps50: med(out[k][s], 'fps50'), fps90: med(out[k][s], 'fps90'), p50: med(out[k][s], 'p50') };
sum.ringFps = { collapsed: out.collapsed.on.map((x) => x.ringFps), expanded: out.expanded.on.map((x) => x.ringFps) };
console.log(JSON.stringify(sum, null, 1));
await browser.close();
