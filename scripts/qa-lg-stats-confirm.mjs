#!/usr/bin/env node
/** 运行时自证：__gevGlStats().config（dispN / dispPx / etaLo / etaHi）+ 玻璃层是否正常 */
import puppeteer from 'puppeteer';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 14000));
const out = await page.evaluate(() => {
  const s = window.__gevGlStats ? window.__gevGlStats() : null;
  return {
    hasStats: !!s,
    config: s ? s.config : null,
    surfaces: s ? s.surfaces.length : null,
    glOn: document.documentElement.classList.contains('gev-gl-on'),
    canvas: (() => { const g = document.getElementById('gev-gl-glass'); return g ? [g.width, g.height] : null; })(),
  };
});
out.errors = errs.slice(0, 5);
console.log(JSON.stringify(out, null, 1));
await browser.close();
