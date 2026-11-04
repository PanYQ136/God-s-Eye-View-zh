#!/usr/bin/env node
/**
 * qa-gev-dispersion2.mjs —— 决定性色散 A/B（灰阶底图 + html.gev-nofilter 开关）
 *  A = 折射开（当前实现），B = 折射关（html.gev-nofilter）
 *  底图纯灰阶（R=G=B），卡壳自带蓝调（12/18/26）会在 A、B 两帧里同时存在，
 *  所以「A-B 的通道差」只可能来自 SVG 位移的三通道分离。
 *  分桶：边框 0-1px / 2-3px / 4-8px / 中心 >30px。
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
const OUT = 'evidence/_collab/t_8cf06356';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SW = 64, SH = 64, g = Buffer.alloc(SW * SH * 3);
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
  const v = (Math.floor(x / 16) % 2 === 0) ? 235 : 28;
  const k = y % 16 === 0 ? 0.5 : 1;
  const i = (y * SW + x) * 3; g[i] = v * k; g[i + 1] = v * k; g[i + 2] = v * k;
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
await sleep(1200);
const box = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; });

const pA = path.join(OUT, 'dispA-on.png'); await page.screenshot({ path: pA });
const toggled = await page.evaluate(() => window.__gevLc.nofilter(true));
await sleep(900);
const pB = path.join(OUT, 'dispB-off.png'); await page.screenshot({ path: pB });
const compB = await page.evaluate(() => getComputedStyle(document.querySelector('.gev-lg-warp')).filter);
await page.screenshot({ path: path.join(OUT, 'dispB-off.png') });
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 3 });
await sleep(900);
await page.screenshot({ path: path.join(OUT, 'dispB-off-3x.png'), clip: { x: box.x - 4, y: box.y + 150, width: 24, height: 12 } });
await page.evaluate(() => window.__gevLc.nofilter(false));
await sleep(900);
await page.screenshot({ path: path.join(OUT, 'dispA-on-3x.png'), clip: { x: box.x - 4, y: box.y + 150, width: 24, height: 12 } });
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await sleep(600);
await page.screenshot({ path: path.join(OUT, 'dispA-on.png') });

const raw = async (p) => { const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true }); return { data, info }; };
const A = await raw(pA), B = await raw(pB);
const { width: w, channels: ch } = A.info;
const buckets = {};
const put = (k, dr, dg, db) => { const b = buckets[k] = buckets[k] || { n: 0, sr: 0, sg: 0, sb: 0, max: 0 }; b.n++; b.sr += dr; b.sg += dg; b.sb += db; b.max = Math.max(b.max, dr, dg, db); };
for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) {
  const d = Math.min(x - box.x, box.x + box.w - x, y - box.y, box.y + box.h - y);
  const i = (y * w + x) * ch;
  const dr = Math.abs(A.data[i] - B.data[i]), dg = Math.abs(A.data[i + 1] - B.data[i + 1]), db = Math.abs(A.data[i + 2] - B.data[i + 2]);
  put(d <= 1 ? 'edge 0-1px' : d <= 3 ? 'edge 2-3px' : d <= 8 ? 'edge 4-8px' : d <= 30 ? 'edge 9-30px' : 'center >30px', dr, dg, db);
}
const out = {};
for (const k in buckets) {
  const b = buckets[k];
  out[k] = { px: b.n, meanAbsDr: +(b.sr / b.n).toFixed(2), meanAbsDg: +(b.sg / b.n).toFixed(2), meanAbsDb: +(b.sb / b.n).toFixed(2), maxChannelDiff: b.max,
    spreadBetweenChannels: +(Math.max(b.sr, b.sg, b.sb) / b.n - Math.min(b.sr, b.sg, b.sb) / b.n).toFixed(2) };
}
const rep = { toggled, computedFilterWhenOff: compB, box, buckets: out, note: 'spreadBetweenChannels>0 = 三个通道被位移了不同量（色散）；center 应≈0（中心干净）' };
fs.writeFileSync(path.join(OUT, 'dispersion-ab.json'), JSON.stringify(rep, null, 1));
console.log(JSON.stringify(rep, null, 1));
await browser.close();
