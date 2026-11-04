#!/usr/bin/env node
/**
 * qa-gev-dispersion.mjs —— 决定性色散取证
 * 底图换成「纯灰阶」条纹（通道相等）。此时卡片边缘若出现 RGB 不等的像素，
 * 只能来自 SVG 位移图的三通道分离（backdrop blur 不会分通道）。
 * 输出：沿 data-panel 左边框的逐像素 RGB（0–3px 带 / 20px 内 / 卡外参照）+ 12x 放大图。
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
const OUT = 'evidence/_collab/t_8cf06356';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SW = 64, SH = 64, g = Buffer.alloc(SW * SH * 3);
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
  const v = (Math.floor(x / 16) % 2 === 0) ? 235 : 28;   // 16px 黑白竖条
  const k = y % 16 === 0 ? 0.5 : 1;
  const i = (y * SW + x) * 3;
  g[i] = v * k; g[i + 1] = v * k; g[i + 2] = v * k;
}
const gb64 = 'data:image/png;base64,' + (await sharp(g, { raw: { width: SW, height: SH, channels: 3 } }).png().toBuffer()).toString('base64');

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,820'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9500); await page.keyboard.press('Escape'); await sleep(1500);
await page.evaluate((b64) => {
  const st = document.createElement('style'); st.id = '__g';
  st.textContent = `.cesium-widget,.cesium-widget canvas{visibility:hidden!important}
   .cesium-widget-credits,.cesium-viewer-bottom{display:none!important}video{visibility:hidden!important}
   #__gbg{position:fixed;inset:0;z-index:0;background-image:url(${b64});background-repeat:repeat}`;
  document.head.appendChild(st);
  const d = document.createElement('div'); d.id = '__gbg'; document.body.appendChild(d);
}, gb64);
await page.evaluate(() => window.__gevLc.open('data-panel'));
await sleep(1000);
const box = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; });

const scanY = box.y + 200;
const readRow = async (clip, yy) => {
  const buf = await page.screenshot({ clip });
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const row = [];
  for (let x = 0; x < info.width; x++) { const i = ((yy || 0) * info.width + x) * info.channels; row.push([data[i], data[i + 1], data[i + 2]]); }
  return row;
};
// 左侧边框：x = box.x，取 box.x-6 .. box.x+8
const leftClip = { x: box.x - 6, y: scanY, width: 16, height: 1 };
const rightClip = { x: box.x + box.w - 8, y: scanY, width: 16, height: 1 };
const innerClip = { x: box.x + 60, y: scanY, width: 16, height: 1 };
const outsideClip = { x: box.x - 60, y: scanY, width: 16, height: 1 };
const left = await readRow(leftClip), right = await readRow(rightClip), inner = await readRow(innerClip), outside = await readRow(outsideClip);

const chroma = (row) => row.map(([r, gg, b]) => Math.max(Math.abs(r - gg), Math.abs(gg - b), Math.abs(r - b)));
const stats = (row) => {
  const c = chroma(row);
  return { meanChroma: +(c.reduce((a, b) => a + b, 0) / c.length).toFixed(2), maxChroma: Math.max(...c) };
};
// 12x 放大左侧边框（3px 高）
const zoomBuf = await page.screenshot({ clip: { x: box.x - 6, y: scanY - 1, width: 16, height: 3 } });
await sharp(zoomBuf).resize({ width: 16 * 14, height: 3 * 14, kernel: 'nearest' }).png().toFile(path.join(OUT, 'dispersion-left-edge-14x.png'));
const zoomIn = await page.screenshot({ clip: { x: box.x + 56, y: scanY - 1, width: 16, height: 3 } });
await sharp(zoomIn).resize({ width: 16 * 14, height: 3 * 14, kernel: 'nearest' }).png().toFile(path.join(OUT, 'dispersion-inner-14x.png'));
await page.screenshot({ path: path.join(OUT, 'dispersion-full.png') });

const rep = {
  note: '底图是纯灰阶（通道相等）；卡片边缘出现 RGB 不等 = SVG 位移的三通道色散。backdrop blur 不会产生通道差。',
  box, scanY,
  leftEdge: { xFrom: leftClip.x, rgb: left, ...stats(left) },
  rightEdge: { xFrom: rightClip.x, rgb: right, ...stats(right) },
  inner20px: { xFrom: innerClip.x, rgb: inner, ...stats(inner) },
  outsideCard: { xFrom: outsideClip.x, rgb: outside, ...stats(outside) },
};
fs.writeFileSync(path.join(OUT, 'dispersion-report.json'), JSON.stringify(rep, null, 1));
console.log(JSON.stringify(rep, null, 1));
await browser.close();
