#!/usr/bin/env node
/* _rv4-e-3card.mjs — reviewer round-4 probe E: 3-card reachable state
   (dock control-panel + right-rail global-context-panel, pp-toggles collapsed by exclusivity)
   -> right-rail mini cards must not overlap and headers must stay clickable. */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r4');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 2500)); };
const IDS = ['pp-toggles', 'cctv-panel', 'global-context-panel', 'control-panel', 'data-panel', 'scene-panel', 'location-bar'];

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
  window.__tr = { down: 0, downT: 0, click: 0, clickT: 0 };
  addEventListener('pointerdown', (e) => { window.__tr.down++; if (e.isTrusted) window.__tr.downT++; }, true);
  addEventListener('click', (e) => { window.__tr.click++; if (e.isTrusted) window.__tr.clickT++; }, true);
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(10000);

const clickCard = async (id, wait = 1000) => {
  const p = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return { ok: false };
    const er = el.getBoundingClientRect(); const cands = [];
    for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]); }
    cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]);
    for (const q of cands) { const e = document.elementFromPoint(q[0], q[1]); if (e && el.contains(e)) return { ok: true, at: q }; }
    return { ok: false, at: cands[cands.length - 1] }; }, id);
  if (!p.ok) return p;
  await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up();
  await sleep(wait); return p;
};
const geom = () => page.evaluate((IDS) => {
  const o = {}; const cs = {};
  for (const id of IDS) { const el = document.getElementById(id); if (!el) continue; const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    o[id] = [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)]; cs[id] = { open: !el.classList.contains('collapsed'), cls: el.className.toString().slice(0, 80), t: c.transform, z: c.zIndex, op: c.opacity, disp: c.display }; }
  const ov = (a, b) => { const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]); const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]); return ix > 0 && iy > 0 ? { ix: +ix.toFixed(1), iy: +iy.toFixed(1), area: Math.round(ix * iy) } : null; };
  const ids = Object.keys(o); const overlaps = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const v = ov(o[ids[i]], o[ids[j]]); if (v) overlaps.push({ a: ids[i], b: ids[j], ...v }); }
  const hits = {};
  for (const id of ['pp-toggles', 'cctv-panel', 'global-context-panel', 'control-panel']) {
    const el = document.getElementById(id); const r = el.getBoundingClientRect();
    const q = [Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(14, r.height / 2))];
    const e = document.elementFromPoint(q[0], q[1]);
    hits[id] = { own: !!(e && el.contains(e)), owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : (e ? e.tagName : null), at: q };
  }
  return { o, cs, overlaps, hits };
}, IDS);

const seqs = [
  ['control-panel', 'pp-toggles', 'global-context-panel'],
  ['control-panel', 'global-context-panel', 'pp-toggles'],
  ['pp-toggles', 'control-panel', 'global-context-panel'],
  ['global-context-panel', 'control-panel', 'pp-toggles'],
];
const res = [];
for (const seq of seqs) {
  // reset
  for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
    const o = await page.evaluate((i) => { const el = document.getElementById(i); return el && !el.classList.contains('collapsed'); }, id);
    if (o) await clickCard(id, 700);
  }
  await sleep(2500);
  for (const id of seq) await clickCard(id, 1200);
  const timeline = [];
  for (const w of [0, 800, 2000, 4000]) { if (w) await sleep(w); const g = await geom(); timeline.push({ after: w, overlaps: g.overlaps, o: g.o, pp: g.cs['pp-toggles'], cctv: g.cs['cctv-panel'] }); }
  const g = await geom();
  const rec = { seq, overlaps: g.overlaps, o: g.o, hits: g.hits, timeline };
  // real click on pp header must open pp
  const c = await page.evaluate(() => { const el = document.getElementById('pp-toggles'); const r = el.getBoundingClientRect(); const q = [Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(14, r.height / 2))]; const e = document.elementFromPoint(q[0], q[1]); return { pre: e ? (e.closest('.gev-lc') ? e.closest('.gev-lc').id : e.tagName) : null, at: q }; });
  await page.mouse.move(c.at[0], c.at[1]); await page.mouse.down(); await page.mouse.up(); await sleep(1200);
  rec.ppClick = { preOwner: c.pre, opened: await page.evaluate(() => !document.getElementById('pp-toggles').classList.contains('collapsed')) };
  res.push(rec);
  console.log('## seq', seq.join('+'), 'overlaps', JSON.stringify(g.overlaps), 'ppClick', JSON.stringify(rec.ppClick), 'hits', JSON.stringify(g.hits));
  if (seq[2] === 'global-context-panel') await page.screenshot({ path: path.join(OUT, 'E-3card-' + seq.join('_') + '.png') });
}
put('seqs', res);
put('trust', await page.evaluate(() => window.__tr));
fs.writeFileSync(path.join(OUT, 'E-3card.json'), JSON.stringify(R, null, 1));
console.log('WROTE E-3card.json');
await browser.close();
