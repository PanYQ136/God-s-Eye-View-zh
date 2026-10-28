#!/usr/bin/env node
/** dbg3.mjs —— 打印展开卡自身的 transform / animations / 父链 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const id = process.argv[2] || 'control-panel';
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
await sleep(1000);
await page.evaluate((id) => window.__gevLc.open(id), id);
for (const t of [200, 500, 900, 1600]) {
  await sleep(t === 200 ? 200 : 300);
  const o = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    return {
      t: Date.now(), rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)],
      transform: cs.transform, inlineTransform: el.style.transform,
      parent: el.parentElement.tagName + '#' + (el.parentElement.id || ''),
      parentTransform: getComputedStyle(el.parentElement).transform,
      anims: el.getAnimations().map((a) => ({ state: a.playState, name: a.animationName || (a.effect && a.effect.getKeyframes && 'kf') })),
      tl: [cs.left, cs.top, cs.width, cs.height],
    };
  }, id);
  console.log(JSON.stringify(o));
}
await browser.close();
