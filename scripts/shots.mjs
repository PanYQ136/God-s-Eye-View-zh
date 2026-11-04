#!/usr/bin/env node
/**
 * shots.mjs —— 快速出图（折叠 / 展开 / 特写），用于视觉迭代
 * 用法: node scripts/shots.mjs [tag] [jsHook]
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1536, H = 730, OUT = 'docs/_collab/t_9739e3a7';
const TAG = process.argv[2] || 'shot';
const HOOK = process.argv[3] || '';
const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--window-position=1900,40', '--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (/gev-edge|shader|err/i.test(t)) logs.push(t.slice(0, 200)); });
await page.goto('http://localhost:4173/?gevEdge=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__gevEdge && document.getElementById('data-panel'), { timeout: 120000 });
await sleep(11000);
await page.keyboard.press('Escape');
await sleep(1800);
if (HOOK) await page.evaluate(HOOK);
await sleep(500);
await page.screenshot({ path: `${OUT}/${TAG}-collapsed.png` });
const crop = async (png, r, name, z = 6) => {
  await sharp(png).extract({ left: Math.max(0, r.x), top: Math.max(0, r.y), width: r.w, height: r.h })
    .resize({ width: r.w * z, height: r.h * z, kernel: 'nearest' }).toFile(`${OUT}/${name}.png`);
};
await crop(`${OUT}/${TAG}-collapsed.png`, { x: 1284, y: 80, w: 220, h: 140 }, `${TAG}-rail-3x`, 3);
await crop(`${OUT}/${TAG}-collapsed.png`, { x: 40, y: 82, w: 200, h: 120 }, `${TAG}-left-3x`, 3);
await page.evaluate(() => {
  const el = document.getElementById('data-panel'); const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 30, clientY: r.top + 16 }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + 30, clientY: r.top + 16 }));
});
await sleep(1600);
await page.screenshot({ path: `${OUT}/${TAG}-expanded.png` });
const box = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
await crop(`${OUT}/${TAG}-expanded.png`, { x: box[0] - 6, y: box[1] + 30, w: 60, h: 120 }, `${TAG}-exp-left-6x`);
await crop(`${OUT}/${TAG}-expanded.png`, { x: box[0] + 30, y: box[1] - 6, w: 120, h: 60 }, `${TAG}-exp-top-6x`);
console.log(JSON.stringify({ tag: TAG, box, logs, st: await page.evaluate(() => window.__gevEdge.stats()) }).slice(0, 900));
await browser.close();
