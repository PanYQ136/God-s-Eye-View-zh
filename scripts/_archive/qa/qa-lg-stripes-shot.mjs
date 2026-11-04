#!/usr/bin/env node
/** qa-lg-stripes-shot.mjs —— 条纹背景下的整卡截图（看斜面折射/色散形态） */
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
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 16000));
const card = await page.evaluate(() => {
  const s = window.__gevGlStats().surfaces;
  return s.find((x) => x.id === 'pp-toggles') || s[0];
});
await page.evaluate(() => { window.__gevGlTestBg(true, 10); window.__gevGlSet({ etaLo: 1.48, etaHi: 1.56 }); });
await new Promise((r) => setTimeout(r, 1200));
const clip = { x: card.rect[0] - 8, y: card.rect[1] - 8, width: card.rect[2] + 16, height: card.rect[3] + 16 };
const shoot = async (tag) => {
  const buf = await page.screenshot({ clip });
  fs.writeFileSync(`${DIR}/${tag}.png`, buf);
  const m = await sharp(buf).metadata();
  await sharp(buf).resize(m.width * 4, m.height * 4, { kernel: 'nearest' }).png().toFile(`${DIR}/${tag}-4x.png`);
  return buf;
};
await shoot('stripes-card-on');
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.52, etaHi: 1.52 }));
await new Promise((r) => setTimeout(r, 800));
await shoot('stripes-card-off');
await page.evaluate(() => { window.__gevGlTestBg(false); window.__gevGlSet({ etaLo: 1.48, etaHi: 1.56 }); });
await new Promise((r) => setTimeout(r, 600));
await shoot('map-card-on');
console.log('card=' + JSON.stringify(card) + ' errors=' + JSON.stringify(errs.slice(0, 3)));
await browser.close();
