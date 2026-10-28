#!/usr/bin/env node
/** _r3-console.mjs — 页面 console error / 未捕获异常检查（改动后） */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errs = [];
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)));
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9000);
// 触发一遍 dock 溢出路径 + toast/chip
const click = async (id) => {
  const p = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const SEL = '.panel-header, .pp-header-row, .panel-title, .pp-header-label';
    for (const h of el.querySelectorAll(SEL)) {
      const r = h.getBoundingClientRect();
      if (r.width < 4) continue;
      const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
      const e = document.elementFromPoint(x, y);
      const hh = e && e.closest ? e.closest(SEL) : null;
      if (hh && el.contains(hh) && (e.closest('.gev-lc') || {}).id === id) return { x, y };
    }
    return null;
  }, id);
  if (!p) return;
  await page.mouse.move(p.x, p.y); await sleep(50); await page.mouse.down(); await sleep(45); await page.mouse.up(); await sleep(1000);
};
await click('control-panel');
await click('cctv-panel');
const tilt = await page.evaluate(() => { const r = document.getElementById('tilt-map-view').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
await page.mouse.move(tilt.x, tilt.y); await sleep(50); await page.mouse.down(); await sleep(45); await page.mouse.up();
await sleep(2000);
console.log('ERRORS', JSON.stringify(errs, null, 1));
await browser.close();
