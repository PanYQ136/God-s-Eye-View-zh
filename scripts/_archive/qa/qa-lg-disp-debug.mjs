#!/usr/bin/env node
/** qa-lg-disp-debug.mjs —— 排查：dispPx 生效性 + 斜面内 R/B 逐像素剖面 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const DIR = 'evidence/lg-glass-shots/p0/disp';
fs.mkdirSync(DIR, { recursive: true });
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = [], warns = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 16000));
const card = await page.evaluate(() => {
  const s = window.__gevGlStats().surfaces;
  return s.find((x) => x.id === 'pp-toggles') || s[0];
});
await page.evaluate(() => window.__gevGlTestBg(true, 10));
await new Promise((r) => setTimeout(r, 1000));
const clip = { x: card.rect[0] - 2, y: card.rect[1] + 10, width: 16, height: 20 };
const grab = async (tag) => {
  const buf = await page.screenshot({ clip });
  fs.writeFileSync(`${DIR}/${tag}.png`, buf);
  const m = await sharp(buf).metadata();
  await sharp(buf).resize(m.width * 12, m.height * 12, { kernel: 'nearest' }).png().toFile(`${DIR}/${tag}-12x.png`);
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
};
for (const dp of [0, 6.5, 40]) {
  await page.evaluate((dp) => window.__gevGlSet({ dispPx: dp }), dp);
  await new Promise((r) => setTimeout(r, 700));
  const img = await grab('dbg-disp' + dp);
  const y = Math.floor(img.h / 2);
  const row = [];
  for (let x = 0; x < img.w; x++) {
    const i = (y * img.w + x) * img.ch;
    row.push(`${x}:${img.data[i]},${img.data[i + 1]},${img.data[i + 2]}`);
  }
  console.log('dispPx=' + dp + ' row(y=' + y + '): ' + row.join(' '));
}
console.log('warns=' + JSON.stringify(warns.slice(0, 6)));
console.log('errors=' + JSON.stringify(errs.slice(0, 3)));
await browser.close();
