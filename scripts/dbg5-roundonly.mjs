#!/usr/bin/env node
/** dbg5-roundonly.mjs —— 同一环境、环开启，但 corner-shape 强制 round（=改动前几何/旧 shader 路径 n=2） */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const OUT = 'evidence/_collab/t_3e129970';
const b = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--window-size=1536,820', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await b.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
// 立刻钉住 round（环还没 boot，所以 cornerN 一开始就是 2）
if (process.argv[2] !== 'sq') await page.addStyleTag({ content: '*,*::before,*::after{corner-shape:round !important}' });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 9000));
const st = await page.evaluate(() => {
  const v = window.__gevViewer;
  return {
    rs: +(v.resolutionScale || 0).toFixed(2),
    dialogs: Array.from(document.querySelectorAll('.cesium-widget-errorPanel-message')).map((n) => n.textContent.slice(0, 90)),
    lens: (() => { try { const s = window.__gevEdge.stats(); return { frames: s.frames, cornerN: s.surfaces.map((x) => x.cornerN) }; } catch (e) { return String(e && e.message); } })(),
    imagery: v.scene.globe.imageryLayers.length,
  };
});
await page.screenshot({ path: `${OUT}/dbg5-roundonly.png` });
fs.writeFileSync(`${OUT}/dbg5-roundonly.json`, JSON.stringify({ st, errs: errs.slice(0, 6) }, null, 1));
console.log(JSON.stringify({ st, errs: errs.slice(0, 6) }, null, 1));
await b.close();
