#!/usr/bin/env node
/** _dump-dom.mjs —— 打印 9 张卡的 DOM 骨架 + header 候选（给交互修复定位） */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1560,860', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.removeItem('gev-liquid-cards:v2'); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(8000);
const out = await page.evaluate(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
  const desc = (el, d = 0) => {
    if (d > 2) return '';
    let s = '';
    for (const c of el.children) {
      if (!c.tagName) continue;
      if (c.classList && c.classList.contains('gev-lc-edge')) continue;
      if (c.classList && c.classList.contains('gev-lg-warp')) continue;
      const r = c.getBoundingClientRect();
      s += '  '.repeat(d + 1) + '<' + c.tagName.toLowerCase() + (c.id ? '#' + c.id : '') +
        (c.className ? '.' + String(c.className).trim().split(/\s+/).join('.') : '') +
        '> [' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ']' +
        (getComputedStyle(c).display === 'none' ? ' display:none' : '') + '\n';
      s += desc(c, d + 1);
    }
    return s;
  };
  const o = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { o[id] = 'MISSING'; continue; }
    const r = el.getBoundingClientRect();
    o[id] = '\n#' + id + ' [' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ']' +
      ' collapsed=' + el.classList.contains('collapsed') + ' parent=' + (el.parentElement.id || el.parentElement.tagName) +
      '\n' + desc(el);
  }
  // 顶部 60px 内的 header 候选
  return o;
});
for (const k in out) console.log('=== ' + k + ' ===' + out[k]);
await browser.close();
