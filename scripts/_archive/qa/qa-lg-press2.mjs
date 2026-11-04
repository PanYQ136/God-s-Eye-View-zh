#!/usr/bin/env node
/** qa-lg-press2.mjs —— 按下 flex 实测：玻璃外壳压缩（边缘外移 px）+ 边缘光亮度增量 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const DIR = 'evidence/lg-glass-shots/p0';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(DIR, { recursive: true });
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 14000));
const info0 = await page.evaluate(() => window.__gevLc.info('data-panel'));
const clip = { x: info0.x - 5, y: info0.y + 4, width: 20, height: Math.max(10, info0.h - 8) };

const grab = async (tag) => {
  const buf = await page.screenshot({ clip });
  if (tag) fs.writeFileSync(`${DIR}/${tag}.png`, buf);
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels, buf };
};
/* 边缘位置：取一行里 |dLuma/dx| 最大处（玻璃外壳与外部地图的分界） */
function edgeProfile(img) {
  const y = Math.floor(img.h / 2);
  const prof = [];
  for (let x = 1; x < img.w - 1; x++) {
    const i0 = (y * img.w + x - 1) * img.ch, i1 = (y * img.w + x + 1) * img.ch;
    const l0 = 0.2126 * img.data[i0] + 0.7152 * img.data[i0 + 1] + 0.0722 * img.data[i0 + 2];
    const l1 = 0.2126 * img.data[i1] + 0.7152 * img.data[i1 + 1] + 0.0722 * img.data[i1 + 2];
    prof.push({ x, g: Math.abs(l1 - l0) / 2, l: (l0 + l1) / 2 });
  }
  prof.sort((a, b) => b.g - a.g);
  const rim = prof.slice(0, 6).reduce((s, p) => s + p.l, 0) / 6;
  return { edgeX: prof[0].x, edgeLuma: +rim.toFixed(1), top4: prof.slice(0, 4).map((p) => [p.x, +p.g.toFixed(1), +p.l.toFixed(0)]) };
}

const before = await grab('press2-before');
await page.mouse.move(info0.x + 80, info0.y + 18);
await page.mouse.down();
await new Promise((r) => setTimeout(r, 85));
const during = await grab('press2-during');
const stateDuring = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  return { cls: el.className, w: +el.getBoundingClientRect().width.toFixed(2) };
});
await page.mouse.up();
await new Promise((r) => setTimeout(r, 500));
const after = await grab('press2-after');
const stateAfter = await page.evaluate(() => ({ floating: window.__gevLc.info('data-panel').floating }));

const e0 = edgeProfile(before), e1 = edgeProfile(during), e2 = edgeProfile(after);
console.log(JSON.stringify({
  clip, edgeBefore: e0, edgeDuring: e1, edgeAfter: e2,
  shiftDuring_devicePx: e1.edgeX - e0.edgeX, shiftAfter_devicePx: e2.edgeX - e0.edgeX,
  rimLumaDelta: +(e1.edgeLuma - e0.edgeLuma).toFixed(1),
  stateDuring, stateAfter, errors: errs.slice(0, 4),
}, null, 1));
await browser.close();
