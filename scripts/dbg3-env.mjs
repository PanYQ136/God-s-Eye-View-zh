#!/usr/bin/env node
/** dbg3-env.mjs —— 让 Cesium 在当前环境稳定渲染（关性能模式自适应分辨率 + 关首次引导），带边缘环 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const OUT = 'evidence/_collab/t_3e129970';
const b = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization', '--window-size=1536,820', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await b.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
    localStorage.setItem('gev.gfx', JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'default' }));
  } catch (e) {}
});
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => errs.push('pageerror ' + e.message.slice(0, 160)));
await page.goto(process.argv[2] || 'http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
await page.evaluate(() => { try { window.__gevViewer.resolutionScale = 0.75; } catch (e) {} });
await page.keyboard.press('Escape');
await page.evaluate(() => {
  try {
    const C = window.Cesium || window.__CESIUM__;
    window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-73.9857, 40.7484, 2200), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
  } catch (e) {}
});
await new Promise((r) => setTimeout(r, 12000));
const health = await page.evaluate(() => {
  const v = window.__gevViewer;
  return {
    canvas: [v.canvas.width, v.canvas.height], rs: v.resolutionScale,
    renderError: v.scene.renderError ? String(v.scene.renderError.message || '(object)') : null,
    imagery: v.scene.globe.imageryLayers.length,
    tilesLoaded: v.scene.globe.tilesLoaded,
    lens: (() => { try { const s = window.__gevEdge.stats(); return { frames: s.frames, fps: s.fps, err: s.err, surf: s.surfaces.map((x) => [x.id, x.cornerN]) }; } catch (e) { return String(e && e.message); } })(),
    launcher: (() => { const r = document.getElementById('first-run-launcher'); return r ? r.classList.contains('visible') : null; })(),
    dialogs: document.querySelectorAll('.cesium-widget-errorPanel').length,
  };
});
await page.screenshot({ path: `${OUT}/dbg3-env.png` });
fs.writeFileSync(`${OUT}/dbg3-env.json`, JSON.stringify({ health, errs: errs.slice(0, 8) }, null, 1));
console.log(JSON.stringify({ health, errs: errs.slice(0, 8) }, null, 1));
await b.close();
