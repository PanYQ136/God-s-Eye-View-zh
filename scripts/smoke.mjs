#!/usr/bin/env node
/** smoke.mjs —— 最终冒烟：默认加载 / 环 stats / lensSvg 互斥 / off 清屏 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--window-position=1900,40', '--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => window.__gevEdge && document.getElementById('data-panel'), { timeout: 120000 });
await sleep(10000);
await page.keyboard.press('Escape');
await sleep(1500);
const r = {};
r.stats0 = await page.evaluate(() => { const s = window.__gevEdge.stats(); return { count: s.count, tex: s.tex, err: s.err, band: s.band, fps: s.fps }; });
r.svgOn = await page.evaluate(async () => {
  window.__gevLc.lensSvg(true);
  await new Promise((r2) => setTimeout(r2, 800));
  return {
    html: document.documentElement.className,
    warpFilter: getComputedStyle(document.querySelector('#data-panel .gev-lg-warp')).filter,
    ringStats: (() => { const s = window.__gevEdge.stats(); return { count: s.count }; })(),
  };
});
r.svgOff = await page.evaluate(async () => {
  window.__gevLc.lensSvg(false);
  await new Promise((r2) => setTimeout(r2, 900));
  return { html: document.documentElement.className, ringStats: (() => { const s = window.__gevEdge.stats(); return { count: s.count, err: s.err }; })() };
});
r.errs = errs.slice(-8);
console.log(JSON.stringify(r, null, 1));
await browser.close();
