#!/usr/bin/env node
/**
 * _rv2-t829-statechrome.mjs — reviewer probe F: state-conditional page chrome that
 * status.css still paints with a dark solid + backdrop blur (the same family as
 * the #toast miss). Reads computed styles in the live page, then lights them up
 * (reviewer-side DOM only, no files touched) for a visual screenshot.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r2');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
await sleep(8000);

const IDS = ['toast', 'global-loading-status', 'traffic-sync-chip', 'cctv-sync-chip', 'gev-toast', 'key-setup-chip', 'gev-perf-btn'];
const read = () => page.evaluate((IDS) => {
  const a = (s) => { if (/^rgba?\(/.test(String(s))) { const p = String(s).match(/rgba?\(([^)]+)\)/)[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; } return 0; };
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id);
    if (!el) { o[id] = 'absent'; continue; }
    const c = getComputedStyle(el); const r = el.getBoundingClientRect();
    o[id] = { bg: c.backgroundColor, bgA: +a(c.backgroundColor).toFixed(2), bf: c.backdropFilter,
      opacity: c.opacity, visibility: c.visibility, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      text: (el.textContent || '').trim().slice(0, 24) };
  }
  return o;
}, IDS);

const before = await read();
console.log('BEFORE ' + JSON.stringify(before, null, 1));

// light them up for the screenshot (DOM-only, reviewer evidence)
await page.evaluate(() => {
  for (const id of ['traffic-sync-chip', 'cctv-sync-chip']) {
    const el = document.getElementById(id);
    if (el) { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)'; el.style.top = id === 'traffic-sync-chip' ? '100px' : '130px'; }
  }
  const g = document.getElementById('global-loading-status');
  if (g) { g.hidden = false; g.style.opacity = '1'; }
  const t = document.getElementById('toast');
  if (t) { t.textContent = 'TILTED VIEW'; t.classList.add('visible'); }
});
await sleep(500);
const after = await read();
console.log('LIT ' + JSON.stringify(after, null, 1));
await page.screenshot({ path: path.join(OUT, 'F-state-chrome.png'), clip: { x: 400, y: 60, width: 700, height: 120 } });
await page.screenshot({ path: path.join(OUT, 'F-state-chrome-toast.png'), clip: { x: 620, y: 560, width: 320, height: 90 } });
fs.writeFileSync(path.join(OUT, 'F-state-chrome.json'), JSON.stringify({ before, after }, null, 1));
await browser.close();
