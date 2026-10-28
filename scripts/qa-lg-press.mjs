#!/usr/bin/env node
/** qa-lg-press.mjs —— 按下 flex 诊断 + 实测（class 是否落上 / transform 是否生效 / rim 亮度变化） */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(OUT, { recursive: true });
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

/* 合成 pointerdown（不触发 click 副作用），看 class / transform */
const diag = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const tgt = el.querySelector('.panel-header') || el;
  tgt.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, clientX: 80, clientY: 110, pointerId: 1 }));
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { cls: el.className, transform: cs.transform, transition: cs.transition, w: +r.width.toFixed(2), h: +r.height.toFixed(2), target: tgt.className };
});
await new Promise((r) => setTimeout(r, 140));
const dur = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const r = el.getBoundingClientRect();
  return { cls: el.className, transform: getComputedStyle(el).transform, w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
});
await new Promise((r) => setTimeout(r, 300));
const after = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const r = el.getBoundingClientRect();
  return { cls: el.className, transform: getComputedStyle(el).transform, w: +r.width.toFixed(2) };
});

/* 真实鼠标按下 + rim 亮度实测 */
const strip = { x: info0.x - 3, y: info0.y + 6, width: 12, height: Math.max(8, info0.h - 12) };
const lum = async (buf) => {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let mx = 0, s = 0, n = 0;
  for (let i = 0; i < data.length; i += info.channels) { const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; s += l; n++; if (l > mx) mx = l; }
  return { mean: +(s / n).toFixed(1), max: +mx.toFixed(1) };
};
const before = await page.screenshot({ clip: strip });
await page.mouse.move(info0.x + 80, info0.y + 18);
await page.mouse.down();
await new Promise((r) => setTimeout(r, 90));
const during = await page.screenshot({ clip: strip });
const duringInfo = await page.evaluate(() => { const el = document.getElementById('data-panel'); const r = el.getBoundingClientRect(); return { cls: el.className, transform: getComputedStyle(el).transform, w: +r.width.toFixed(2) }; });
await page.mouse.up();
await new Promise((r) => setTimeout(r, 400));
fs.writeFileSync(`${OUT}/press-before.png`, before);
fs.writeFileSync(`${OUT}/press-during.png`, during);
console.log(JSON.stringify({ info0, diag, dur, after, duringInfo, rim: { before: await lum(before), during: await lum(during) }, errors: errs.slice(0, 4) }, null, 1));
await browser.close();
