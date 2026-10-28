#!/usr/bin/env node
/** dbg-layers.mjs —— 在卡片内某点做 element stack 审计：谁在涂黑 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--window-size=1536,820'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(1200);
const pts = { 'data-panel/header': [200, 115], 'pp-toggles/header': [1450, 118], 'cctv/header': [1450, 176], 'location/body': [660, 660], 'control/body': [900, 660] };
const out = {};
for (const k in pts) {
  out[k] = await page.evaluate(([x, y]) => {
    const stack = document.elementsFromPoint(x, y).slice(0, 8).map((el) => {
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''),
        bg: cs.backgroundColor, bgImg: cs.backgroundImage.slice(0, 24), bd: cs.backdropFilter, opacity: cs.opacity,
        size: [Math.round(b.width), Math.round(b.height)].join('x'),
      };
    });
    return stack;
  }, pts[k]);
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
