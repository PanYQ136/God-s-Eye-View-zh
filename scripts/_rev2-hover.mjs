#!/usr/bin/env node
/** _rev2-hover.mjs — hover/pressed 态也不能回填深色底：逐个真实 hover + 读 computed */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('.gev-logs/rev2-accept');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = ['clear-selected-layers', 'share-btn', 'tilt-map-view', 'north-up-view',
  'reset-globe-view', 'key-setup-chip', 'gev-lang-toggle', 'gev-locate-btn', 'gev-perf-btn'];
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(7000);

const read = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const c = getComputedStyle(el);
  const a = (v) => { const m = String(v).match(/rgba?\(([^)]+)\)/); if (!m) return 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
  return { bg: c.backgroundColor, bgA: +a(c.backgroundColor).toFixed(3), bgImg: c.backgroundImage, bf: c.backdropFilter,
    shadow: c.boxShadow.slice(0, 70), color: c.color };
}, id);

const out = {};
for (const id of IDS) {
  const box = await page.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }, id);
  await page.mouse.move(box.x, box.y); await sleep(350);
  out[id] = { hover: await read(id) };
  if (id === 'tilt-map-view') {
    await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(600);
    out[id].afterClickPressed = await read(id);
    out[id].ariaPressed = await page.evaluate(() => document.getElementById('tilt-map-view').getAttribute('aria-pressed'));
    // 还原
    const b2 = await page.evaluate(() => { const r = document.getElementById('tilt-map-view').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
    await page.mouse.move(b2.x, b2.y); await sleep(80); await page.mouse.down(); await sleep(60); await page.mouse.up(); await sleep(400);
  }
  await page.mouse.move(760, 400); await sleep(150);
}
await page.screenshot({ path: path.join(OUT, 'after-hover-cycle.png') });
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(OUT, 'hover.json'), JSON.stringify(out, null, 1));
await browser.close();
