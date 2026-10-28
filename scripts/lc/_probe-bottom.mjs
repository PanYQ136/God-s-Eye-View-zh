#!/usr/bin/env node
/* 底部/两侧 chrome 取证：找出会与左右轨道「让位后」的迷你卡相交的固定元素。 */
import puppeteer from 'puppeteer';
const W = 1536,
  H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--hide-scrollbars'],
  protocolTimeout: 600000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
  } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await sleep(12000);
const out = await page.evaluate(() => {
  const hits = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) continue;
    const b = el.getBoundingClientRect();
    if (b.width < 4 || b.height < 4) continue;
    if (b.bottom < 500) continue;
    hits.push({
      tag: el.tagName.toLowerCase() + '#' + (el.id || '') + '.' + String(el.className || '').split(' ').slice(0, 2).join('.'),
      x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
      right: Math.round(b.right), bottom: Math.round(b.bottom), z: cs.zIndex, pos: cs.position,
    });
  }
  hits.sort((a, b) => a.y - b.y);
  return hits;
});
console.log(out.map((h) => `${String(h.y).padStart(4)}..${String(h.bottom).padStart(4)} x${String(h.x).padStart(4)}..${String(h.right).padStart(4)} z=${String(h.z).padStart(5)} ${h.tag}`).join('\n'));
await browser.close();
