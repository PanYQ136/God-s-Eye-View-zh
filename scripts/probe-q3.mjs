#!/usr/bin/env node
/**
 * probe-q3.mjs —— 边缘锐利 vs 中心磨砂（条纹探针；环 on/off 都测，off 必须先真的清屏）
 * 另外量：内缘羽化带（depth 12–20）的过渡是否平滑（无硬接缝）
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
  const x = r.left + 30, y = r.top + 16;
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y }));
});
await sleep(1600);
const SW = 64, SH = 64, buf = Buffer.alloc(SW * SH * 3);
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) { const v = Math.floor(x / 8) % 2 ? 240 : 16; const i = (y * SW + x) * 3; buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; }
const b64 = 'data:image/png;base64,' + (await sharp(buf, { raw: { width: SW, height: SH, channels: 3 } }).png().toBuffer()).toString('base64');
await page.evaluate((b64) => {
  const st = document.createElement('style'); st.id = '__cssprobe';
  st.textContent = `.cesium-widget, .cesium-widget canvas{visibility:hidden!important}
    #__probe_bg{position:fixed;inset:0;z-index:0;background-image:url(${b64});background-repeat:repeat}
    .gev-lc,.gev-lc *{color:transparent!important;text-shadow:none!important}
    .gev-lc img,.gev-lc svg,.gev-lc video,.gev-lc .material-symbols-outlined{visibility:hidden!important}`;
  document.head.appendChild(st);
  const d = document.createElement('div'); d.id = '__probe_bg'; document.body.appendChild(d);
}, b64);
await sleep(600);
const box = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
async function measure(tag) {
  const p = `${OUT}/q3-${tag}.png`;
  await page.screenshot({ path: p });
  const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels, iw = info.width;
  const stat = (x0, y0, w, h) => {
    let n = 0, s = 0, ss = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * iw + x) * ch; const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n++; s += l; ss += l * l; }
    const m = s / n; return { mean: +m.toFixed(1), sd: +Math.sqrt(Math.max(0, ss / n - m * m)).toFixed(1) };
  };
  // 逐 depth 剖面（取 120 行平均，看有没有硬接缝）
  const prof = [];
  for (let d = 0; d < 30; d++) prof.push(stat(box[0] + d, box[1] + 60, 1, 120).mean);
  return {
    outside: stat(700, 380, 60, 40),
    depth0_8: stat(box[0] + 1, box[1] + 60, 8, 120),
    depth9_13: stat(box[0] + 9, box[1] + 60, 5, 120),
    depth14_20: stat(box[0] + 14, box[1] + 60, 7, 120),
    center: stat(box[0] + 110, box[1] + 150, 80, 60),
    profile: prof.map((v) => +v.toFixed(1)),
  };
}
const out = { box };
await page.evaluate(() => window.__gevEdge.off());
await sleep(600);
out.ringOff = await measure('ringoff');
await page.evaluate(() => window.__gevEdge.on());
await sleep(900);
out.ringOn = await measure('ringon');
// 8x 特写：环开/环关 的同一段左边缘
for (const [tag] of [['ringon'], ['ringoff']]) {
  await sharp(`${OUT}/q3-${tag}.png`).extract({ left: box[0] - 4, top: box[1] + 120, width: 44, height: 60 })
    .resize({ width: 44 * 8, height: 60 * 8, kernel: 'nearest' }).toFile(`${OUT}/q3-${tag}-edge8x.png`);
}
fs.writeFileSync(`${OUT}/q3.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
