#!/usr/bin/env node
/** bench-cap.mjs —— 环绘制上限 60 vs 不限（跟着 Cesium postRender 跑）的成本 */
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
await sleep(12000);
await page.keyboard.press('Escape'); await sleep(2000);
await page.evaluate(() => {
  const el = document.getElementById('data-panel'); const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 30, clientY: r.top + 16 }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + 30, clientY: r.top + 16 }));
});
await sleep(1600);
async function fps() {
  return page.evaluate(async () => {
    const t = []; const t0 = performance.now();
    while (performance.now() - t0 < 4000) { const a = performance.now(); await new Promise((r) => requestAnimationFrame(r)); t.push(performance.now() - a); }
    t.sort((x, y) => x - y); const p = (q) => +t[Math.floor(t.length * q)].toFixed(2);
    const s = window.__gevEdge.stats();
    return { fps50: +(1000 / p(0.5)).toFixed(1), p50: p(0.5), p90: p(0.9), ringFps: s.fps, ringP50: s.p50 };
  });
}
const out = {};
for (const cap of [60, 0, 60, 0]) {
  await page.evaluate((c) => { window.__gevEdge.off(); window.__gevEdge.cap(c); window.__gevEdge.on(); }, cap);
  await sleep(700);
  out['cap' + cap + '_' + Object.keys(out).length] = await fps();
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
