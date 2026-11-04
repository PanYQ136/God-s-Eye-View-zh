#!/usr/bin/env node
/** qa-lg-quick.mjs —— 快速迭代：诊断 + 局部放大截图 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const url = process.argv[2] || 'http://localhost:5183/';
const label = process.argv[3] || 'quick';
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('c:' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 9000));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => { const w = document.querySelector('.welcome-modal, #welcome-modal'); if (w) { const c = w.querySelector('input'); if (c) c.click(); const b = w.querySelector('button'); if (b) b.click(); } });
for (let i = 0; i < 16; i++) {
  const ok = await page.evaluate(() => !!(window.__gevGlStats && window.__gevGlStats().count >= 1));
  if (ok) break;
  await new Promise((r) => setTimeout(r, 1200));
}
await new Promise((r) => setTimeout(r, 2500));
const diag = await page.evaluate(() => ({
  probe: window.__gevGlProbe ? window.__gevGlProbe() : null,
  stats: window.__gevGlStats ? { fps: window.__gevGlStats().fps, count: window.__gevGlStats().count, scale: window.__gevGlStats().scale, surfaces: window.__gevGlStats().surfaces } : null,
  lum: document.documentElement.dataset.gevGlassLum,
  lcCount: document.querySelectorAll('.gev-lc').length,
}));
console.log('ERRORS:', errs.slice(0, 8));
fs.writeFileSync(`evidence/lg-glass-shots/p0/${label}-diag.json`, JSON.stringify({ errs, diag }, null, 1));
console.log('DIAG:', JSON.stringify(diag.probe), JSON.stringify(diag.stats && { fps: diag.stats.fps, count: diag.stats.count }));
await page.screenshot({ path: `evidence/lg-glass-shots/p0/${label}-full.png` });
await page.screenshot({ path: `evidence/lg-glass-shots/p0/${label}-rail.png`, clip: { x: 1230, y: 60, width: 306, height: 240 } });
await page.screenshot({ path: `evidence/lg-glass-shots/p0/${label}-left.png`, clip: { x: 30, y: 70, width: 320, height: 160 } });
await page.screenshot({ path: `evidence/lg-glass-shots/p0/${label}-dock.png`, clip: { x: 500, y: 600, width: 560, height: 130 } });
await browser.close();
