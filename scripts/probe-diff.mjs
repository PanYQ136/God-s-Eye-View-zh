#!/usr/bin/env node
/**
 * probe-diff.mjs —— 冻结地图后 ring on/off 差分：证明「只有边缘 16px 被改，中心 0 变化」
 * 输出：ring-diff.png（放大 6x 的差分图）、ring-diff.json（分区改动像素统计）
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
await sleep(11000);
await page.keyboard.press('Escape');
await sleep(1800);
await page.evaluate(() => {
  const el = document.getElementById('data-panel'); const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 30, clientY: r.top + 16 }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + 30, clientY: r.top + 16 }));
});
await sleep(1600);
// 冻结地图：停 Cesium 渲染循环（我们的 rAF 兜底仍会用旧纹理重画几何）
await page.evaluate(() => {
  const v = window.__gevViewer;
  if (v) { v.useDefaultRenderLoop = false; }
  const vid = document.querySelectorAll('video'); vid.forEach((x) => { x.pause && x.pause(); });
});
await sleep(1200);
const box = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
await page.evaluate(() => window.__gevEdge.on());
await sleep(600);
await page.screenshot({ path: `${OUT}/diff-on.png` });
await page.evaluate(() => window.__gevEdge.off());
await sleep(600);
await page.screenshot({ path: `${OUT}/diff-off.png` });
await page.evaluate(() => window.__gevEdge.on());

const A = await sharp(`${OUT}/diff-on.png`).raw().toBuffer({ resolveWithObject: true });
const B = await sharp(`${OUT}/diff-off.png`).raw().toBuffer({ resolveWithObject: true });
const ch = A.info.channels, iw = A.info.width, ih = A.info.height;
const diff = Buffer.alloc(iw * ih * 3);
let bandPx = 0, bandHit = 0, centerPx = 0, centerHit = 0, outHit = 0, outPx = 0;
let bandMax = 0, centerMax = 0;
for (let y = 0; y < ih; y++) {
  for (let x = 0; x < iw; x++) {
    const i = (y * iw + x) * ch, o = (y * iw + x) * 3;
    const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
    diff[o] = Math.min(255, d * 8); diff[o + 1] = Math.min(255, d * 8); diff[o + 2] = Math.min(255, d * 8);
    const inX = x >= box[0] && x < box[0] + box[2], inY = y >= box[1] && y < box[1] + box[3];
    if (!inX || !inY) { outPx++; if (d > 3) outHit++; continue; }
    const depth = Math.min(x - box[0], box[0] + box[2] - 1 - x, y - box[1], box[1] + box[3] - 1 - y);
    if (depth < 16) { bandPx++; if (d > 3) bandHit++; if (d > bandMax) bandMax = d; }
    else { centerPx++; if (d > 3) centerHit++; if (d > centerMax) centerMax = d; }
  }
}
const res = {
  card: box,
  changedThreshold: 3,
  band_0_16: { px: bandPx, hit: bandHit, pct: +(100 * bandHit / Math.max(1, bandPx)).toFixed(1), maxDelta: bandMax },
  center: { px: centerPx, hit: centerHit, pct: +(100 * centerHit / Math.max(1, centerPx)).toFixed(2), maxDelta: centerMax },
  outsideCard: { px: outPx, hit: outHit, pct: +(100 * outHit / Math.max(1, outPx)).toFixed(2) },
};
fs.writeFileSync(`${OUT}/ring-diff.json`, JSON.stringify(res, null, 1));
await sharp(diff, { raw: { width: iw, height: ih, channels: 3 } }).png().toFile(`${OUT}/ring-diff.png`);
await sharp(`${OUT}/ring-diff.png`).extract({ left: box[0] - 10, top: box[1] + 60, width: 60, height: 180 })
  .resize({ width: 60 * 5, height: 180 * 5, kernel: 'nearest' }).toFile(`${OUT}/ring-diff-edge5x.png`);
// 并排：on / off 特写
const cw = 60, chh = 180;
for (const t of ['on', 'off']) {
  await sharp(`${OUT}/diff-${t}.png`).extract({ left: box[0] - 10, top: box[1] + 60, width: cw, height: chh })
    .resize({ width: cw * 5, height: chh * 5, kernel: 'nearest' }).toFile(`${OUT}/diff-${t}-edge5x.png`);
}
console.log(JSON.stringify(res, null, 1));
await browser.close();
