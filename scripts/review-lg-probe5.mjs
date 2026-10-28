#!/usr/bin/env node
/**
 * review-lg-probe5.mjs —— 亮背景下各面「玻璃开 vs 玻璃关」亮度比（clear dim 实测）
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(OUT, { recursive: true });
const out = { url, errors: [] };
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
page.on('pageerror', (e) => out.errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('c:' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
await page.evaluate(() => {
  try { window.__gevViewer.camera.setView({ destination: (window.Cesium || window.__CESIUM__).Cartesian3.fromDegrees(-67.5, -20.13, 12000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }); } catch (e) {}
});
await new Promise((r) => setTimeout(r, 14000));
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 1200));
const st = await page.evaluate(() => window.__gevGlStats());
const grabMean = async (r) => {
  const buf = await page.screenshot({ clip: { x: r[0], y: r[1], width: r[2], height: r[3] } });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let s = 0;
  for (let i = 0; i < data.length; i += info.channels) s += (data[i] + data[i + 1] + data[i + 2]) / 3;
  return s / (data.length / info.channels);
};
const targets = st.surfaces.filter((s) => ['perf-chip', 'locate-chip', 'lang-chip', 'gev-gfx-fab', 'data-panel', 'control-panel', 'global-context-panel'].includes(s.id));
const rows = [];
for (const t of targets) {
  const [x, y, w, h] = t.rect;
  const ix = Math.round(x + w * 0.25), iy = Math.round(y + h * 0.3);
  const iw = Math.max(4, Math.round(w * 0.5)), ih = Math.max(3, Math.round(h * 0.4));
  const on = await grabMean([ix, iy, iw, ih]);
  await page.evaluate(() => { document.getElementById('gev-gl-glass').style.visibility = 'hidden'; });
  await new Promise((r) => setTimeout(r, 350));
  const off = await grabMean([ix, iy, iw, ih]);
  await page.evaluate(() => { document.getElementById('gev-gl-glass').style.visibility = ''; });
  await new Promise((r) => setTimeout(r, 350));
  rows.push({ id: t.id, variant: t.variant, lum: t.lum, on: +on.toFixed(1), off: +off.toFixed(1), dropPct: +(((off - on) / Math.max(1, off)) * 100).toFixed(1), interiorAlpha: t.interior });
}
out.rows = rows;
fs.writeFileSync(path.join(OUT, 'review-probe5.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ htmlLum: await page.evaluate(() => document.documentElement.dataset.gevGlassLum), rows, errors: out.errors.slice(0, 4) }, null, 1));
await browser.close();
