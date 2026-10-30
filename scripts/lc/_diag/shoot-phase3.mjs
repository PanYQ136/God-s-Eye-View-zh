#!/usr/bin/env node
/* 证据截图：全页 mini / data 展开 / pp 展开 / 状态带（含 中·EN 与 GPU chip）。 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = '.gev-logs/lc';
import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1560,890', '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  protocolTimeout: 600000,
  defaultViewport: { width: 1536, height: 730, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) { if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break; await sleep(400); }
await sleep(12000);
const click = async (sel) => {
  const p = await page.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + Math.min(12, b.height / 2)) }; }, sel);
  await page.mouse.click(p.x, p.y);
  await sleep(2200);
};
const shot = async (name, clip) => { const p = `${OUT}/${name}.png`; await page.screenshot({ path: p, clip }); return p; };
console.log("GPU", JSON.stringify(await page.evaluate(() => { const g = window.__lc.api.gpu(); const b = document.getElementById('gev-perf-wrap').getBoundingClientRect(); return { tier: g.tier, renderer: String(g.renderer).slice(0, 60), band: [Math.round(b.x), Math.round(b.y), Math.round(b.width)] }; })));
console.log("ERR", JSON.stringify(await page.evaluate(() => { const e = document.querySelector('.cesium-widget-errorPanel'); return e ? (e.innerText || '').slice(0, 120) : null; })));
console.log("MINI", await shot('p3-mini'));
await click('#data-panel .panel-header');
console.log("DATA", await shot('p3-data-open'));
await click('#data-panel .panel-header');
await sleep(1500);
await click('#pp-toggles .pp-header-row');
console.log("PP", await shot('p3-pp-open'));
const band = await page.evaluate(() => {
  const ids = ['gev-lang-toggle', 'gev-perf-wrap', 'gev-locate-btn'];
  const xs = ids.map((id) => { const b = document.getElementById(id).getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; });
  const x = Math.min(...xs.map((r) => r[0])) - 12, y = Math.min(...xs.map((r) => r[1])) - 10;
  const right = Math.max(...xs.map((r) => r[0] + r[2])) + 12, bottom = Math.max(...xs.map((r) => r[1] + r[3])) + 10;
  return { clip: { x, y, width: right - x, height: bottom - y }, boxes: xs };
});
console.log("BAND", JSON.stringify(band));
console.log("CHIPS", await shot('p3-status-band', band.clip));
await click('#pp-toggles .pp-header-row');
await sleep(1500);
await click('#location-bar .dock-tray-toggle');
console.log("LOC", await shot('p3-loc-open'));
console.log("VIOL", JSON.stringify(await page.evaluate(() => (window.__lc.violations || []).slice(0, 5))));
await browser.close();
