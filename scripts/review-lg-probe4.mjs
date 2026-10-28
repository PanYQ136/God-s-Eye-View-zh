#!/usr/bin/env node
/**
 * review-lg-probe4.mjs —— 亮背景验证：clear 变体 35% dim 是否真的在像素上生效
 * 做法：切到盐湖白背景 → 冻结 → 同一区域「玻璃开 vs 玻璃关」比较平均亮度比
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
out.cam = await page.evaluate(() => {
  try {
    window.__gevViewer.camera.setView({ destination: (window.__CESIUM__ || window.Cesium || window.__gevViewer.scene.globe.ellipsoid && window.Cesium).Cartesian3.fromDegrees(-67.5, -20.13, 14000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
    return 'ok';
  } catch (e) { return 'err:' + e.message; }
});
await new Promise((r) => setTimeout(r, 14000));
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 1200));
const st = await page.evaluate(() => window.__gevGlStats());
out.stats = { count: st.count, scale: st.scale, fps: st.fps };
out.surfaces = st.surfaces.map((s) => [s.id, s.variant, s.lum, s.fill, s.dim, s.rect]);
out.htmlLum = await page.evaluate(() => document.documentElement.dataset.gevGlassLum);
const grab = async (x, y, w, h, tag) => {
  const buf = await page.screenshot({ clip: { x, y, width: w, height: h } });
  fs.writeFileSync(path.join(OUT, tag + '.png'), buf);
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
};
const mean = (im, x0, y0, x1, y1) => {
  let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * im.w + x) * im.ch; s += (im.data[i] + im.data[i + 1] + im.data[i + 2]) / 3; n++;
  }
  return s / Math.max(1, n);
};
const fab = st.surfaces.find((s) => s.id === 'gev-gfx-fab');
out.fab = fab;
if (fab) {
  const [fx, fy, fw, fh] = fab.rect;
  const cx = Math.round(fx + fw / 2), cy = Math.round(fy + fh / 2);
  const w = 10, h = 10;
  const on = await grab(cx - w / 2, cy - h / 2, w, h, 'p4-fab-on');
  await page.evaluate(() => { document.getElementById('gev-gl-glass').style.visibility = 'hidden'; });
  await new Promise((r) => setTimeout(r, 500));
  const off = await grab(cx - w / 2, cy - h / 2, w, h, 'p4-fab-off');
  await page.evaluate(() => { document.getElementById('gev-gl-glass').style.visibility = ''; });
  out.fabCenterLum = { on: +mean(on, 0, 0, w, h).toFixed(1), off: +mean(off, 0, 0, w, h).toFixed(1) };
}
// 亮背景整页截图供人工判读
const st2 = await page.evaluate(() => window.__gevGlStats());
out.finalLum = st2.surfaces.map((s) => [s.id, s.lum]);
fs.writeFileSync(path.join(OUT, 'p4-bright-full.png'), await page.screenshot());
fs.writeFileSync(path.join(OUT, 'review-probe4.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ cam: out.cam, stats: out.stats, htmlLum: out.htmlLum, surfaces: out.surfaces, fabCenter: out.fabCenterLum, errors: out.errors.slice(0, 4) }, null, 1));
await browser.close();
