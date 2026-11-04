#!/usr/bin/env node
/** dbg4-tray.mjs —— 查清 .dock-popover-content 的 DOM 关系与 computed 角形 */
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
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
    localStorage.setItem('gev.gfx', JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'default' }));
  } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 11000));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 1500));
// 展开 location-bar 让托盘出现
await page.evaluate(() => window.__gevLc.open('location-bar'));
await new Promise((r) => setTimeout(r, 1600));
const info = await page.evaluate(() => {
  const list = Array.from(document.querySelectorAll('.dock-popover-content'));
  return list.map((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      parentChain: (() => { const o = []; let p = el.parentElement; for (let i = 0; i < 4 && p; i++) { o.push(p.id || p.className || p.tagName); p = p.parentElement; } return o; })(),
      radius: cs.borderTopLeftRadius, shape: cs.cornerShape,
      rect: [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 10) / 10),
      visible: cs.visibility !== 'hidden' && +cs.opacity > 0.05, opacity: cs.opacity, display: cs.display,
      inCommandDock: !!el.closest('#command-dock'),
      cls: el.className,
    };
  });
});
const shot = await page.screenshot({ type: 'png' });
fs.writeFileSync(`${OUT}/dbg4-tray.png`, shot);
fs.writeFileSync(`${OUT}/dbg4-tray.json`, JSON.stringify(info, null, 1));
console.log(JSON.stringify(info, null, 1));
await b.close();
