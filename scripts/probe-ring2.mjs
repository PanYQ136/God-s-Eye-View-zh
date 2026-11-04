#!/usr/bin/env node
/**
 * probe-ring2.mjs —— GL canvas 内容 vs 屏幕截图（同一 y 行），定位「画了但看不见」
 *  testBg（灰阶条纹）下：
 *   A 环内像素（readPixels）
 *   B 屏幕截图同一行（应 ≈ 0.48*A + 0.52*卡壳色 + rim）
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1536, H = 730, OUT = 'evidence/_collab/t_9739e3a7';
const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--window-position=1900,40', '--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.goto('http://localhost:4173/?gevEdge=1', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__gevEdge && document.getElementById('data-panel'), { timeout: 120000 });
await sleep(10000);
await page.keyboard.press('Escape');
await sleep(1500);
await page.evaluate(() => {
  const el = document.getElementById('data-panel'); const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 30, clientY: r.top + 20 }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + 30, clientY: r.top + 20 }));
});
await sleep(1500);
const r = await page.evaluate(async () => {
  window.__gevEdge.only(['data-panel']);
  window.__gevEdge.testBg(true, 8);
  window.__gevEdge.set({ dispPx: 4.2 });
  await new Promise((res) => setTimeout(res, 600));
  const b = document.getElementById('data-panel').getBoundingClientRect();
  const y = Math.round(b.top + b.height / 2);
  window.__gevEdgeGrab = null; window.__gevEdgeGrabOut = null;
  window.__gevEdgeGrab = { x: b.left, y: y, w: 40 };
  await new Promise((res) => setTimeout(res, 400));
  return { box: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], y, gl: window.__gevEdgeGrabOut };
});
await sleep(300);
await page.screenshot({ path: `${OUT}/ring2-screen.png` });
// 同时裁一张 8x 放大
await sharp(`${OUT}/ring2-screen.png`).extract({ left: r.box[0] - 8, top: r.y - 18, width: 60, height: 36 })
  .resize({ width: 60 * 8, height: 36 * 8, kernel: 'nearest' }).toFile(`${OUT}/ring2-band-8x.png`);
const { data, info } = await sharp(`${OUT}/ring2-screen.png`).raw().toBuffer({ resolveWithObject: true });
const ch = info.channels;
const line = [];
for (let x = r.box[0]; x < r.box[0] + 40; x++) { const i = (r.y * info.width + x) * ch; line.push([data[i], data[i + 1], data[i + 2]]); }
console.log('box', r.box, 'y', r.y);
console.log('GL row R,G,B,A:');
console.log((r.gl && r.gl.row ? r.gl.row : []).slice(0, 26).map((p, i) => i + ':' + p.join('/')).join('  '));
console.log('SCREEN row R,G,B:');
console.log(line.slice(0, 26).map((p, i) => i + ':' + p.join('/')).join('  '));
fs.writeFileSync(`${OUT}/ring2.json`, JSON.stringify({ r, screenRow: line }, null, 1));
await browser.close();
