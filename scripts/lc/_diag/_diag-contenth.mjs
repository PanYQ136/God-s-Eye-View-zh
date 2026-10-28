#!/usr/bin/env node
/* 找出 dock 卡在被测「内容高度」时是谁把 scrollHeight 撑到 478 */
import puppeteer from 'puppeteer';
const URL = 'http://127.0.0.1:4173/';
const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
await sleep(8000);
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ACTIVATE', id: 'location-bar' }));
await sleep(1200);
const out = await page.evaluate(() => {
  const el = document.getElementById('location-bar');
  const save = el.getAttribute('style');
  el.style.width = '476px';
  el.style.height = 'auto';
  el.style.overflowY = 'visible';
  const rows = [];
  const walk = (n, d) => {
    const cs = getComputedStyle(n);
    const b = n.getBoundingClientRect();
    rows.push({ d, cls: (n.className || n.tagName) + '', h: Math.round(b.height), sh: n.scrollHeight, ch: n.clientHeight, pos: cs.position, disp: cs.display, minH: cs.minHeight, hh: cs.height, ov: cs.overflowY });
    for (const c of n.children) if (d < 3) walk(c, d + 1);
  };
  walk(el, 0);
  const sh = el.scrollHeight;
  el.setAttribute('style', save || '');
  return { sh, rows };
});
console.log('scrollHeight(auto) =', out.sh);
for (const r of out.rows) console.log(`${' '.repeat(r.d * 2)}${r.cls}  h=${r.h} sh=${r.sh} ch=${r.ch} pos=${r.pos} disp=${r.disp} cssH=${r.hh} minH=${r.minH} ov=${r.ov}`);
await browser.close();
