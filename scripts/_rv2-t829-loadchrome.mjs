#!/usr/bin/env node
/**
 * _rv2-t829-loadchrome.mjs — reviewer probe G: do the loading/sync chips appear
 * on their own during a normal page load (no reviewer DOM tweaks)?
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r2');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = ['global-loading-status', 'traffic-sync-chip', 'cctv-sync-chip', 'toast', 'gev-toast'];

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });

const read = () => page.evaluate((IDS) => {
  const a = (s) => { if (/^rgba?\(/.test(String(s))) { const p = String(s).match(/rgba?\(([^)]+)\)/)[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; } return 0; };
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id);
    if (!el) { o[id] = null; continue; }
    const c = getComputedStyle(el); const r = el.getBoundingClientRect();
    o[id] = { shown: c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > .05 && r.width > 4,
      bgA: +a(c.backgroundColor).toFixed(2), bf: c.backdropFilter, op: +(+c.opacity).toFixed(2),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
  }
  return o;
}, IDS);

const timeline = [];
let shot = false;
for (let i = 0; i < 26; i++) {
  const s = await read();
  const lit = Object.keys(s).filter((k) => s[k] && s[k].shown);
  timeline.push({ t: i * 500, ms: i * 500, lit, detail: s });
  if (lit.length && !shot) { shot = true; await page.screenshot({ path: path.join(OUT, 'G-load-chips.png'), clip: { x: 600, y: 60, width: 400, height: 130 } }); }
  await sleep(500);
}
const summary = timeline.map((x) => x.ms + ':' + (x.lit.join('|') || '-'));
console.log('TIMELINE', summary.join('  '));
const firstLit = timeline.find((x) => x.lit.length);
console.log('FIRST_LIT', JSON.stringify(firstLit || null, null, 1).slice(0, 900));
fs.writeFileSync(path.join(OUT, 'G-load-timeline.json'), JSON.stringify(timeline, null, 1));
await browser.close();
