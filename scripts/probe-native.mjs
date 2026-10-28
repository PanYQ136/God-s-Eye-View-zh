#!/usr/bin/env node
/** probe-native.mjs —— 关掉 gev-liquid-cards.css 后，读 App 原生 inner 底色 / 卡片外观 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--window-size=1536,820'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto(process.argv[2] || 'http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(1000);
const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const read = (tag) => page.evaluate(({ ids, tag }) => {
  const out = { tag, cards: {}, inners: {} };
  ids.forEach((id) => {
    const el = document.getElementById(id); if (!el) return;
    const cs = getComputedStyle(el);
    out.cards[id] = { bg: cs.backgroundColor, bgImg: cs.backgroundImage.slice(0, 60), bd: cs.backdropFilter, cls: el.className, collapsed: el.classList.contains('collapsed') };
    const inner = el.querySelector('[class*="-inner"], .pp-panel-body, .panel-header');
    if (inner) { const ics = getComputedStyle(inner); out.inners[id + ' :: ' + (inner.className || '').toString().slice(0, 30)] = { bg: ics.backgroundColor, bd: ics.backdropFilter, bgi: ics.backgroundImage.slice(0, 40) }; }
  });
  return out;
}, { ids, tag });
const withLc = await read('lc-on');
await page.evaluate(() => {
  [...document.styleSheets].forEach((s) => { try { if ((s.href || '').includes('gev-liquid-cards')) s.disabled = true; } catch (e) {} });
});
await sleep(800);
const native = await read('lc-off(app-native)');
// 展开一张卡看原生 inner
await page.evaluate(() => document.getElementById('data-panel').classList.remove('collapsed'));
await sleep(500);
const nativeExpanded = await read('lc-off data expanded');
console.log(JSON.stringify({ withLc, native, nativeExpanded }, null, 1));
await browser.close();
