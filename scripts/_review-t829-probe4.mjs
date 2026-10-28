#!/usr/bin/env node
/**
 * _review-t829-probe4.mjs — reviewer probe v4: complete inventory of page chrome
 * outside the 9 cards that is still frosted glass / dark solid.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829');
fs.mkdirSync(OUT, { recursive: true });
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
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(7000);

const inv = await page.evaluate(() => {
  const a = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return /^rgb\(/.test(String(c)) ? 1 : 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.gev-lc')) continue;            // cards excluded (already verified transparent)
    if (el.closest('#cesiumContainer') && !el.id) continue;
    const c = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < .05 || r.width < 6 || r.height < 6) continue;
    const bgA = a(c.backgroundColor);
    const bf = c.backdropFilter && c.backdropFilter !== 'none' ? c.backdropFilter : '';
    const solid = bgA > 0.2 && r.width * r.height > 300;
    if (!bf && !solid) continue;
    out.push({ id: el.id || '', tag: el.tagName, cls: String(el.className).slice(0, 34),
      bg: c.backgroundColor, bgA: +bgA.toFixed(2), bf, color: c.color,
      rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)], text: (el.textContent || '').trim().slice(0, 14) });
  }
  return out;
});
console.log('## chrome_inventory count=' + inv.length);
for (const x of inv) console.log(JSON.stringify(x));
fs.writeFileSync(path.join(OUT, 'probe4-chrome.json'), JSON.stringify(inv, null, 1));
await page.screenshot({ path: path.join(OUT, 'v4-initial-full.png') });
await browser.close();
