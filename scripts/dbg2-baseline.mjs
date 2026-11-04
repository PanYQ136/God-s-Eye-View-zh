#!/usr/bin/env node
/** dbg2-baseline.mjs —— 基线健康检查：welcome 关闭 + Cesium 是否在渲染（与本次 CSS 改动无关） */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const OUT = 'evidence/_collab/t_3e129970';
const b = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,820', '--window-position=1900,40', '--enable-gpu-rasterization'],
});
const page = await b.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('pageerror ' + e.message.slice(0, 200)));
await page.goto(process.argv[2] || 'http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 13000));
const st0 = await page.evaluate(() => {
  const r = document.getElementById('first-run-launcher');
  return { launcher: !!r, visible: r ? r.classList.contains('visible') : null, choices: r ? r.querySelectorAll('[data-first-run-choice]').length : 0 };
});
await page.keyboard.press('Escape');
await page.evaluate(() => { const btn = document.querySelector('#first-run-launcher [data-first-run-choice]'); if (btn) btn.click(); });
await new Promise((r) => setTimeout(r, 1500));
const st1 = await page.evaluate(() => {
  const r = document.getElementById('first-run-launcher');
  return { visible: r ? r.classList.contains('visible') : null, body: document.body.className };
});
// 相机去纽约俯视
await page.evaluate(() => {
  try {
    const C = window.Cesium || window.__CESIUM__;
    window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-73.9857, 40.7484, 2200), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
  } catch (e) {}
});
await new Promise((r) => setTimeout(r, 15000));
const health = await page.evaluate(() => {
  let scene = null;
  try {
    const v = window.__gevViewer;
    scene = {
      renderError: v.scene.renderError ? JSON.stringify({ msg: String(v.scene.renderError.message || v.scene.renderError), stack: String(v.scene.renderError.stack || '').slice(0, 300) }) : null,
      tilesLoaded: v.scene.globe.tilesLoaded,
      mode: v.scene.mode,
      cameraH: Math.round(v.camera.positionCartographic.height),
      canvas: [v.canvas.width, v.canvas.height],
      globeImagery: v.scene.globe.imageryLayers.length,
      lensFrames: (() => { try { return window.__gevEdge.stats().frames; } catch (e) { return -1; } })(),
    };
  } catch (e) { scene = { err: String(e && e.message) }; }
  return { scene, dialogs: Array.from(document.querySelectorAll('.cesium-widget-errorPanel, .cesium-widget-errorPanel-message')).map((n) => n.textContent.slice(0, 120)), html: document.documentElement.className };
});
await page.screenshot({ path: `${OUT}/dbg2-baseline.png` });
fs.writeFileSync(`${OUT}/dbg2-baseline.json`, JSON.stringify({ st0, st1, health, errs: errs.slice(0, 10) }, null, 1));
console.log(JSON.stringify({ st0, st1, health, errs: errs.slice(0, 6) }, null, 1));
await b.close();
