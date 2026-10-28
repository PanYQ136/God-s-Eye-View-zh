#!/usr/bin/env node
import puppeteer from 'puppeteer';
const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9500);
const out = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  const er = el.getBoundingClientRect();
  const cands = [];
  for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) {
    const r = h.getBoundingClientRect();
    if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2), h.className || h.tagName]);
  }
  cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2)), 'cardrect']);
  return cands.map((c) => {
    const e = document.elementFromPoint(c[0], c[1]);
    return { at: c, hit: e ? (e.closest('.gev-lc') ? e.closest('.gev-lc').id : e.tagName + '.' + e.className) : null,
      inside: !!(e && el.contains(e)), contain: !!el.contains(document.elementFromPoint(c[0], c[1])) };
  });
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
