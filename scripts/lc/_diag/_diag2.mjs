#!/usr/bin/env node
/* 诊断：左/右轨道为何从 y=190 起（基线是 94） */
import puppeteer from 'puppeteer';
const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=1980,20', '--hide-scrollbars'],
  protocolTimeout: 600000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await sleep(14000);
const out = await page.evaluate(() => {
  const info = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return null;
    const b = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { sel, rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], pos: cs.position, top: cs.top, margin: cs.margin, padding: cs.padding, transform: cs.transform, parent: e.parentElement && (e.parentElement.id || e.parentElement.className) };
  };
  const stack = info('.left-panel-stack');
  const grid = stack && stack.parent ? info('#' + stack.parent) : null;
  const hits = [];
  for (const e of document.querySelectorAll('body *')) {
    const b = e.getBoundingClientRect();
    if (b.width < 6 || b.height < 6) continue;
    if (b.bottom < 60 || b.top > 200) continue;
    if (b.left > 500 && b.right < 1100) continue;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    hits.push(`${e.tagName.toLowerCase()}#${e.id || ''}.${String(e.className || '').split(' ')[0]} [${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)}] pos=${cs.position} z=${cs.zIndex}`);
  }
  return { stack, grid, hits: hits.slice(0, 40) };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
