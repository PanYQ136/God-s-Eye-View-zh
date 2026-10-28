#!/usr/bin/env node
/* _rv5-i-close-glyph.mjs — reviewer round-5 probe I: with three cards expanded, confirm the
   page still carries zero circular close buttons / ✕ glyphs and zero visible backdrop-filter,
   and capture a full-page screenshot for the visual edge check. */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r5');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};

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
await sleep(10000);
const clickId = async (id, wait = 1200) => {
  const p = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return { ok: false }; const er = el.getBoundingClientRect(); const cands = []; for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]); } cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]); for (const q of cands) { const e = document.elementFromPoint(q[0], q[1]); if (e && el.contains(e)) return { ok: true, at: q }; } return { ok: false }; }, id);
  if (!p.ok) return p; await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); await sleep(wait); return p;
};
for (const id of ['data-panel', 'cctv-panel', 'control-panel']) await clickId(id, 1500);
await sleep(3500);
R.state = await page.evaluate((IDS) => {
  const bf = [];
  for (const n of document.querySelectorAll('body *')) {
    const c = getComputedStyle(n); const r = n.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) continue;
    if (+c.opacity < 0.05 || c.visibility === 'hidden' || c.display === 'none') continue;
    if ((c.backdropFilter || '').includes('blur')) bf.push(n.tagName + '#' + n.id + '.' + ((n.className && n.className.toString().split(' ')[0]) || '') + ' card=' + (n.closest('.gev-lc') ? n.closest('.gev-lc').id : '-'));
  }
  return {
    x_els: document.querySelectorAll('.gev-lc-close').length,
    x_glyph_text: (document.body.innerText.match(/\u2715/g) || []).length,
    x_glyph_any: (document.body.innerText.match(/[\u2715\u2716\u2717\u00d7]/g) || []).length,
    backdrop_filter_visible: bf,
    expanded: IDS.filter((id) => { const el = document.getElementById(id); return el && !el.classList.contains('collapsed'); }),
  };
}, ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']);
await page.screenshot({ path: path.join(OUT, 'I-three-expanded.png') });
console.log('##', JSON.stringify(R));
fs.writeFileSync(path.join(OUT, 'I-close-glyph.json'), JSON.stringify(R, null, 1));
await browser.close();
