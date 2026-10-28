#!/usr/bin/env node
/* _rv5-l-frame.mjs — reviewer round-5 probe L: dump the 监控 card's frame subtree (elements and
   ::before/::after) so the black rectangle seen in screenshots is attributed correctly. */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r5');
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
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {} });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(10000);
const clickId = async (id, wait = 4500) => {
  const p = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return { ok: false }; const er = el.getBoundingClientRect(); const cands = []; for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]); } cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]); for (const q of cands) { const e = document.elementFromPoint(q[0], q[1]); if (e && el.contains(e)) return { ok: true, at: q }; } return { ok: false }; }, id);
  if (!p.ok) return p; await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); await sleep(wait); return p;
};
await clickId('cctv-panel', 4500);
R.wrapHTML = await page.evaluate(() => { const w = document.getElementById('cctv-frame-wrap'); return w ? w.outerHTML.slice(0, 1500) : null; });
R.nodes = await page.evaluate(() => {
  const w = document.getElementById('cctv-frame-wrap');
  if (!w) return null;
  const alpha = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return 0; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
  const rows = [];
  const push = (n, tag) => {
    const c = getComputedStyle(n, tag); const r = getComputedStyle(n); const b = n.getBoundingClientRect();
    rows.push({ el: n.tagName + (n.id ? '#' + n.id : '') + '.' + ((n.className && n.className.toString().split(' ')[0]) || ''), pseudo: tag || '', bg: c.backgroundColor, bgA: +alpha(c.backgroundColor).toFixed(3), bgImg: c.backgroundImage.slice(0, 50), op: +c.opacity, content: c.content, anim: r.animationName, rect: [+b.left.toFixed(0), +b.top.toFixed(0), +b.width.toFixed(0), +b.height.toFixed(0)] });
  };
  push(w); push(w, '::before'); push(w, '::after');
  for (const n of w.querySelectorAll('*')) { push(n); push(n, '::before'); push(n, '::after'); }
  return rows.filter((x) => x.bgA > 0.02 || x.bgImg !== 'none' || x.content !== 'none' || x.el.startsWith('IMG') || x.el.startsWith('CANVAS'));
});
await sleep(2500);
R.after2s = await page.evaluate(() => { const i = document.getElementById('cctv-frame'); if (!i) return null; const c = getComputedStyle(i); return { op: c.opacity, filter: c.filter, mix: c.mixBlendMode, src: i.getAttribute('src'), complete: i.complete, naturalW: i.naturalWidth, naturalH: i.naturalHeight, bg: c.backgroundColor }; });
await page.screenshot({ path: path.join(OUT, 'L-frame.png') });
console.log('##', JSON.stringify(R).slice(0, 4000));
fs.writeFileSync(path.join(OUT, 'L-frame.json'), JSON.stringify(R, null, 1));
await browser.close();
