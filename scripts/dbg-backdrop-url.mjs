#!/usr/bin/env node
/** dbg-backdrop-url.mjs —— 试试 backdrop-filter: url(#filter) blur() 是否被支持 & 成本 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,820'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9500); await page.keyboard.press('Escape'); await sleep(1500);
const apply = async (css) => { await page.evaluate((c) => { let s = document.getElementById('__x'); if (!s) { s = document.createElement('style'); s.id = '__x'; document.head.appendChild(s); } s.textContent = c; }, css); await sleep(800); };
const bench = async (label) => {
  const r = await page.evaluate(async () => {
    const t = [];
    for (let i = 0; i < 45; i++) { const a = performance.now(); await new Promise((r2) => requestAnimationFrame(r2)); t.push(performance.now() - a); }
    t.sort((x, y) => x - y);
    const w = document.querySelector('.gev-lg-warp');
    return { median: +t[Math.floor(t.length / 2)].toFixed(1), computedBackdrop: getComputedStyle(w).backdropFilter, computedFilter: getComputedStyle(w).filter };
  });
  console.log(label.padEnd(52), JSON.stringify(r));
  return { label, ...r };
};
const out = [];
await apply('');
out.push(await bench('基线：filter:url() + backdrop blur6'));
await apply('.gev-lg-warp{filter:none!important}');
out.push(await bench('只 blur6'));
await apply('.gev-lg-warp{filter:none!important;backdrop-filter:url(#gev-lg-filter) blur(6px) saturate(140%)!important;-webkit-backdrop-filter:url(#gev-lg-filter) blur(6px) saturate(140%)!important}');
out.push(await bench('backdrop-filter 里带 url(#...)'));
await apply('');
console.log(JSON.stringify(out));
await browser.close();
