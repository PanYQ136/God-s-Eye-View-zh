#!/usr/bin/env node
/**
 * qa-lg-scene.mjs —— 指定经纬度场景验收（亮背景/暗背景）
 * 用法: node scripts/qa-lg-scene.mjs <url> <label> <lon> <lat> <heightMeters>
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const url = process.argv[2] || 'http://localhost:5183/';
const label = process.argv[3] || 'scene';
const lon = Number(process.argv[4] || -67.5);
const lat = Number(process.argv[5] || -20.13);
const hgt = Number(process.argv[6] || 12000);
const outDir = 'evidence/lg-glass-shots/p0';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('c:' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 9000));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => { const w = document.querySelector('.welcome-modal, #welcome-modal'); if (w) { const c = w.querySelector('input'); if (c) c.click(); const b = w.querySelector('button'); if (b) b.click(); } });
await new Promise((r) => setTimeout(r, 1500));

const moved = await page.evaluate((lon, lat, hgt) => {
  try {
    const C = window.__CESIUM__, v = window.__gevViewer;
    if (!C || !v) return 'no viewer';
    v.camera.setView({ destination: C.Cartesian3.fromDegrees(lon, lat, hgt), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
    return 'ok';
  } catch (e) { return 'err: ' + e.message; }
}, lon, lat, hgt);
// 等瓦片加载 + 玻璃层就绪
for (let i = 0; i < 20; i++) {
  const ok = await page.evaluate(() => !!(window.__gevGlStats && window.__gevGlStats().count >= 9));
  if (ok) break;
  await new Promise((r) => setTimeout(r, 1200));
}
await new Promise((r) => setTimeout(r, 6000));
// 再补一次（瓦片细化后）
await page.evaluate((lon, lat, hgt) => {
  try { window.__gevViewer.camera.setView({ destination: window.__CESIUM__.Cartesian3.fromDegrees(lon, lat, hgt), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }); } catch (e) {}
}, lon, lat, hgt);
await new Promise((r) => setTimeout(r, 4000));

const diag = await page.evaluate(() => {
  const g = window.__gevGlStats ? window.__gevGlStats() : null;
  return {
    fps: g && g.fps, count: g && g.count, scale: g && g.scale,
    lum: document.documentElement.dataset.gevGlassLum,
    probe: window.__gevGlProbe ? window.__gevGlProbe() : null,
    surfaces: g && g.surfaces.map((s) => ({ id: s.id, v: s.variant, lum: s.lum, fill: s.fill, dim: s.dim })),
  };
});
await page.screenshot({ path: `${outDir}/${label}.png` });
await page.screenshot({ path: `${outDir}/${label}-rail.png`, clip: { x: 1230, y: 60, width: 306, height: 240 } });
await page.screenshot({ path: `${outDir}/${label}-left.png`, clip: { x: 30, y: 70, width: 320, height: 170 } });
await page.screenshot({ path: `${outDir}/${label}-dock.png`, clip: { x: 500, y: 600, width: 560, height: 130 } });
await page.screenshot({ path: `${outDir}/${label}-fab.png`, clip: { x: 1420, y: 560, width: 116, height: 110 } });
fs.writeFileSync(`${outDir}/${label}-diag.json`, JSON.stringify({ errs, moved, diag }, null, 1));
console.log('moved:', moved, 'errs:', errs.length);
console.log('diag:', JSON.stringify(diag));
await browser.close();
