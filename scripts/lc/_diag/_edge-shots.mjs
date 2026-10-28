#!/usr/bin/env node
/* 抓 4x/8x 真栅格边缘图：data-panel 左上角 + location-bar dock 面板顶边 */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const URL = 'http://127.0.0.1:4173/';
const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync('.gev-logs/lc/edges', { recursive: true });
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'],
  protocolTimeout: 300000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 120; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break;
  await sleep(400);
}
await sleep(7000);
const cdp = await page.createCDPSession();
async function shot(name, rect, pad, scale) {
  const clip = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), width: rect.w + pad * 2, height: rect.h + pad * 2, scale };
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false });
  writeFileSync(`.gev-logs/lc/edges/${name}-${scale}x.png`, Buffer.from(data, 'base64'));
  return `.gev-logs/lc/edges/${name}-${scale}x.png`;
}
async function click(id, sel) {
  const p = await page.evaluate((sel) => {
    const b = document.querySelector(sel).getBoundingClientRect();
    return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
  }, sel);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down(); await sleep(30); await page.mouse.up();
  await sleep(1200);
}
const rectOf = (id) => page.evaluate((id) => { const b = document.getElementById(id).getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; }, id);

// ① data-panel 左上角
await click('data-panel', '#data-panel .panel-header');
let r = await rectOf('data-panel');
const a4 = await shot('data-tl', { x: r.x, y: r.y, w: 40, h: 30 }, 8, 8);
const a8 = await shot('data-tl-wide', { x: r.x, y: r.y, w: 120, h: 90 }, 8, 4);
// ② 打开 location（dock 面板）
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(800);
await click('location-bar', '#location-bar .dock-tray-toggle');
r = await rectOf('location-bar');
const b8 = await shot('dock-top', { x: r.x, y: r.y, w: 160, h: 40 }, 6, 8);
const b4 = await shot('dock-all', r, 6, 2);
console.log(JSON.stringify({ a4, a8, b8, b4, dockRect: r }, null, 1));
await browser.close();
