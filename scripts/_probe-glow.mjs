#!/usr/bin/env node
/** _probe-glow.mjs — .panel-glow / dock-label-icon 的实际绘制参数 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 60000 });
for (let i = 0; i < 100; i++) {
  const loading = await page.evaluate(() => {
    const l = document.getElementById('loading-screen');
    return l ? getComputedStyle(l).display !== 'none' && +getComputedStyle(l).opacity > 0.05 : false;
  });
  if (!loading) break;
  await sleep(400);
}
await sleep(7000);
const info = await page.evaluate(() => {
  const pick = (sel) => [...document.querySelectorAll(sel)].map((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      sel, el: el.tagName + '.' + String(el.className || '').slice(0, 30),
      bg: cs.backgroundColor, bgi: cs.backgroundImage.slice(0, 80),
      opacity: cs.opacity, filter: cs.filter, mixBlend: cs.mixBlendMode,
      rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)],
      vis: cs.visibility, z: cs.zIndex,
    };
  });
  return { glow: pick('.panel-glow'), icons: pick('.dock-label-icon') };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
