#!/usr/bin/env node
/** qa-lg-shots-bright.mjs —— 亮/暗场景最终截图（build 后刷新证据） */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const DIR = 'evidence/lg-glass-shots/p0/final';
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 14000));
await page.keyboard.press('Escape');
await page.evaluate(() => { const w = document.querySelector('.welcome-modal, #welcome-modal'); if (w) { const b = w.querySelector('button'); if (b) b.click(); } });
/* 暗场景全景 */
await page.screenshot({ path: `${DIR}/dark-full.png` });
/* 亮场景 */
await page.evaluate(() => {
  try { const C = window.Cesium || window.__CESIUM__; window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-67.5, -20.13, 12000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }); } catch (e) {}
});
await new Promise((r) => setTimeout(r, 16000));
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 1800));
await page.screenshot({ path: `${DIR}/bright-full.png` });
const st = await page.evaluate(() => {
  const s = window.__gevGlStats();
  const t = document.getElementById('top-center-actions');
  return { html: document.documentElement.dataset.gevGlassLum, scale: s.scale, dev: s.devicePx, count: s.count, topbarLum: t ? t.dataset.gevLum : null, lums: s.surfaces.map((x) => [x.id, x.lum]) };
});
/* 亮景特写（右上三卡 + 顶部条） */
await page.screenshot({ path: `${DIR}/bright-right-column.png`, clip: { x: 1290, y: 80, width: 220, height: 190 } });
await page.screenshot({ path: `${DIR}/bright-topbar.png`, clip: { x: 650, y: 26, width: 460, height: 50 } });
console.log(JSON.stringify({ st, errors: errs.slice(0, 3) }));
await browser.close();
