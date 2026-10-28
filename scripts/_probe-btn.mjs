#!/usr/bin/env node
/** _probe-btn.mjs —— 检查 .gev-lc-close 的定位上下文 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1560,860', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.removeItem('gev-liquid-cards:v2'); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(11000);

for (const id of ['control-panel', 'pp-toggles', 'cctv-panel']) {
  await page.evaluate((id) => window.__gevLc.open(id), id);
  await sleep(1000);
  const info = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const b = el.querySelector('.gev-lc-close');
    const r = el.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const cs = getComputedStyle(b);
    const ecs = getComputedStyle(el);
    return {
      card: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      cardPos: ecs.position,
      cardPadding: ecs.padding,
      btn: [Math.round(br.left), Math.round(br.top), Math.round(br.width), Math.round(br.height)],
      pos: cs.position,
      top: cs.top,
      right: cs.right,
      offsetParent: b.offsetParent ? (b.offsetParent.id || b.offsetParent.tagName) : null,
      parentIsCard: b.parentElement === el,
      cardOffsetW: el.offsetWidth,
      cardOffsetH: el.offsetHeight,
    };
  }, id);
  console.log(id, JSON.stringify(info));
  await page.evaluate((id) => window.__gevLc.close(id), id);
  await sleep(800);
}
await browser.close();
