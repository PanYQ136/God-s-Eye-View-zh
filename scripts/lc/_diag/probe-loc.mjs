#!/usr/bin/env node
/* 探针 11：点开位置面板后相位是否卡在 opening（含动画列表）。 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1560,890', '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  protocolTimeout: 300000,
  defaultViewport: { width: 1536, height: 730, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
try { await page.bringToFront(); } catch (e) {}
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) { if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break; await sleep(400); }
await sleep(12000);
const c = await page.evaluate(() => { const b = document.querySelector('#location-bar .dock-tray-toggle').getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; });
await page.mouse.move(c.x - 10, c.y - 6, { steps: 3 }); await sleep(30);
await page.mouse.move(c.x, c.y, { steps: 3 }); await sleep(30);
await page.mouse.down(); await sleep(25); await page.mouse.up();
for (let i = 0; i < 12; i++) {
  await sleep(500);
  const s = await page.evaluate(() => {
    const e = document.getElementById('location-bar');
    const b = e.getBoundingClientRect();
    return { t: Math.round(performance.now()), phase: window.__lc.api.phases()['location-bar'], anims: e.getAnimations().map((a) => [a.playState, Math.round(a.effect.getTiming().duration)]), rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], scroll: e.scrollHeight + '/' + e.clientHeight };
  });
  console.log(JSON.stringify(s));
}
await browser.close();
