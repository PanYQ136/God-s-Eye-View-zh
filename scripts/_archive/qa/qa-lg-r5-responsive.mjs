#!/usr/bin/env node
/* qa-lg-r5-responsive.mjs —— 第五轮回归：语言芯片加宽后各档宽度的溢出/重叠检查 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = path.resolve('evidence/lg-glass-shots/p0/final/r5');
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 2000));

const widths = [1536, 1440, 1280, 1024, 768, 375];
const out = { probe: 'qa-lg-r5-responsive', rows: [] };
const ids = ['gev-locate-btn', 'gev-perf-wrap', 'gev-lang-toggle'];
for (const w of widths) {
  await page.setViewport({ width: w, height: 730, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 1200));
  const row = await page.evaluate((ids) => {
    const r = {};
    for (const id of ids) { const e = document.getElementById(id); if (!e) { r[id] = null; continue; } const b = e.getBoundingClientRect(); r[id] = { x: +b.left.toFixed(1), y: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; }
    const overlap = (a, b) => (a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) ? true : false;
    return {
      rects: r,
      overlaps: {
        locate_perf: overlap(r['gev-locate-btn'], r['gev-perf-wrap']),
        perf_lang: overlap(r['gev-perf-wrap'], r['gev-lang-toggle']),
        locate_lang: overlap(r['gev-locate-btn'], r['gev-lang-toggle']),
      },
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      langW: r['gev-lang-toggle'] ? r['gev-lang-toggle'].w : null,
    };
  }, ids);
  row.width = w;
  out.rows.push(row);
}
out.errors = errs;
fs.writeFileSync(path.join(OUT, 'responsive.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
