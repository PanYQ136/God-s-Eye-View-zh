#!/usr/bin/env node
/** qa-lg-open-times.mjs —— 首次/后续展开的帧时对比（定位一次性长帧）+ 新 CSS 下的展开特写 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const DIR = 'evidence/lg-glass-shots/p0/final';
const SCR = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 13000));
await page.evaluate(() => {
  window.__ft = [];
  let last = performance.now();
  const tick = (t) => { window.__ft.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const runs = [];
for (let i = 0; i < 3; i++) {
  const r = await page.evaluate(async () => {
    const ft0 = window.__ft.length;
    window.__gevLc.open('data-panel');
    await new Promise((r) => setTimeout(r, 1200));
    const ft = window.__ft.slice(ft0).sort((a, b) => a - b);
    const q = (p) => +(ft[Math.min(ft.length - 1, Math.floor(p * ft.length))] || 0).toFixed(1);
    const out = { frames: ft.length, p50: q(0.5), p90: q(0.9), p95: q(0.95), max: +ft[ft.length - 1].toFixed(1), over25: ft.filter((v) => v > 25).length };
    window.__gevLc.close('data-panel');
    await new Promise((r) => setTimeout(r, 900));
    return out;
  });
  runs.push(r);
}
await page.evaluate(() => window.__gevLc.open('data-panel'));
await new Promise((r) => setTimeout(r, 1300));
await page.screenshot({ path: `${DIR}/expanded-zoom2.png`, clip: { x: 40, y: 150, width: 360, height: 420 } });
await page.screenshot({ path: `${DIR}/expanded2.png` });
const info = await page.evaluate(() => window.__gevLc.info('data-panel'));
fs.writeFileSync(`${SCR}/qa-lg-open-times.json`, JSON.stringify({ runs, info, errors: errs }, null, 1));
console.log(JSON.stringify({ runs, info, errors: errs.slice(0, 3) }));
await browser.close();
