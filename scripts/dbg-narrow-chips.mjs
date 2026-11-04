#!/usr/bin/env node
/** dbg-narrow-chips.mjs —— 收窄态「地图源」chip 换行验证：7 个 chip 是否全在卡内、是否两两压字 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization', '--window-size=1536,820', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => { try { localStorage.removeItem('gev-liquid-cards:v2'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(2000);

const probe = () => page.evaluate(() => {
  const el = document.getElementById('control-panel');
  const b = el.getBoundingClientRect();
  const chips = [...el.querySelectorAll('.map-stack-chip')].map((c) => { const r = c.getBoundingClientRect(); return { t: (c.textContent || '').trim(), x: Math.round(r.left - b.left), y: Math.round(r.top - b.top), w: Math.round(r.width), h: Math.round(r.height), sw: c.scrollWidth, cw: c.clientWidth }; });
  let collide = 0;
  for (let i = 0; i < chips.length; i++) for (let j = i + 1; j < chips.length; j++) {
    const A = chips[i], B = chips[j];
    if (A.x < B.x + B.w && A.x + A.w > B.x && A.y < B.y + B.h && A.y + A.h > B.y) collide++;
  }
  const outside = chips.filter((c) => c.x + c.w > Math.round(b.width) - 4).map((c) => c.t);
  return { w: Math.round(b.width), h: Math.round(b.height), narrow: el.classList.contains('gev-lc-narrow'), rows: [...new Set(chips.map((c) => c.y))].length, collide, outside, chips, cardScroll: [el.scrollWidth, el.clientWidth, el.scrollHeight, el.clientHeight] };
});

await page.evaluate(() => { window.__gevLc.open('data-panel'); window.__gevLc.open('pp-toggles'); window.__gevLc.open('control-panel'); });
await sleep(1400);
const p1 = await probe();
console.log('COMBO(338):', JSON.stringify(p1));
await page.screenshot({ path: 'evidence/_collab/t_f8d97c1c/ctrl-338-narrow-final-2x.png', clip: { x: 820, y: 320, width: 400, height: 400 } });

// 单开（465）应该完全不受影响
await page.evaluate(() => (window.__gevLc._ids() || []).forEach((id) => window.__gevLc.close(id)));
await sleep(900);
await page.evaluate(() => window.__gevLc.open('control-panel'));
await sleep(1200);
const p2 = await probe();
console.log('ALONE(465):', JSON.stringify(p2));
await browser.close();
