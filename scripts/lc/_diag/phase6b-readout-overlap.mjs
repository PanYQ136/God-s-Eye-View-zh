#!/usr/bin/env node
/* 快检：voice 卡底部行 语音待命 vs ~$0.00 是否重叠 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch {} });
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 120; i++) { const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false); if (ok) break; await sleep(400); }
await sleep(4500);
const b = await page.evaluate(() => { const r = document.getElementById('gev-voice-control').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; });
await page.mouse.move(Math.round(b[0] + b[2] / 2), Math.round(b[1] + b[3] - 12), { steps: 6 });
await sleep(800);
const out = await page.evaluate(() => {
  const el = document.getElementById('gev-voice-control');
  const rr = (x) => { const r = x.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right) }; };
  const detail = el.querySelector('#gev-voice-detail');
  const val = el.querySelector('.gev-voice-cost-value');
  const a = rr(detail), c = rr(val);
  return { card: rr(el), detail: { ...a, txt: (detail.textContent || '').trim() }, value: { ...c, txt: (val.textContent || '').trim() },
    overlap: !(a.right <= c.x || c.right <= a.x || a.y + a.h <= c.y || c.y + c.h <= a.y) };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
