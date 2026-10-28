#!/usr/bin/env node
/* _rv4-b-combos.mjs — reviewer round-4 probe B (contract lens): the round-3 blocking geometry
   (dock card + right-rail card expanded -> right-rail mini cards must not overlap) across
   all reachable combos, both orders, plus header hit ownership and real click open. */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r4');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { combos: [] };
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 3000)); };

const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const COLLAPSIBLE = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];

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
  window.__tr = { down: 0, downT: 0, click: 0, clickT: 0 };
  addEventListener('pointerdown', (e) => { window.__tr.down++; if (e.isTrusted) window.__tr.downT++; }, true);
  addEventListener('click', (e) => { window.__tr.click++; if (e.isTrusted) window.__tr.clickT++; }, true);
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(10000);

const clickCard = async (id, wait = 900) => {
  const probe = await page.evaluate((id) => {
    const el = document.getElementById(id); if (!el) return { ok: false };
    const er = el.getBoundingClientRect(); const cands = [];
    for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) {
      const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]);
    }
    cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]);
    for (const p of cands) { const e = document.elementFromPoint(p[0], p[1]); if (e && el.contains(e)) return { ok: true, at: p }; }
    const p0 = cands[cands.length - 1]; const e0 = document.elementFromPoint(p0[0], p0[1]);
    return { ok: false, at: p0, blockedBy: e0 ? (e0.closest('.gev-lc') ? e0.closest('.gev-lc').id : e0.tagName) : 'null' };
  }, id);
  if (!probe.ok) return probe;
  await page.mouse.move(probe.at[0], probe.at[1]);
  await page.mouse.down(); await page.mouse.up();
  await sleep(wait);
  return probe;
};

const state = () => page.evaluate((IDS) => {
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id); if (!el) continue;
    const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    if (c.display === 'none' || +c.opacity < 0.05) continue;
    o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], open: !el.classList.contains('collapsed') };
  }
  const ov = (a, b) => { const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]); const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    return ix > 0 && iy > 0 ? { ix: +ix.toFixed(1), iy: +iy.toFixed(1), area: Math.round(ix * iy) } : { ix: 0, iy: 0, area: 0 }; };
  const ids = Object.keys(o); const overlaps = []; let minGap = 999;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = o[ids[i]].rect, b = o[ids[j]].rect; const v = ov(a, b);
    if (v.area > 0) overlaps.push({ a: ids[i], b: ids[j], ...v });
    // vertical gap for same-column cards
    if (Math.abs(a[0] - b[0]) < 2) { const g = a[1] < b[1] ? b[1] - (a[1] + a[3]) : a[1] - (b[1] + b[3]); if (g >= -0.5) minGap = Math.min(minGap, +g.toFixed(1)); }
  }
  const hits = {};
  for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
    const el = document.getElementById(id); if (!el) continue; const r = el.getBoundingClientRect();
    const e = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(14, r.height / 2)));
    hits[id] = { own: !!(e && el.contains(e)), owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : null, open: !el.classList.contains('collapsed') };
  }
  const outOfView = ids.filter((id) => o[id].rect[0] < -1 || o[id].rect[1] < -1 || o[id].rect[0] + o[id].rect[2] > innerWidth + 1 || o[id].rect[1] + o[id].rect[3] > innerHeight + 1);
  return { o, overlaps, minGap, hits, outOfView, expanded: ids.filter((id) => o[id].open) };
}, IDS);

const closeAll = async () => {
  for (const id of COLLAPSIBLE) {
    const open = await page.evaluate((i) => { const el = document.getElementById(i); return el && !el.classList.contains('collapsed'); }, id);
    if (open) await clickCard(id, 800);
  }
  await sleep(900);
};

const combos = [
  ['control-panel', 'pp-toggles'], ['pp-toggles', 'control-panel'],   // round-3 blocker, both orders
  ['control-panel', 'cctv-panel'], ['cctv-panel', 'control-panel'],
  ['control-panel', 'global-context-panel'], ['global-context-panel', 'control-panel'],
  ['location-bar', 'pp-toggles'], ['pp-toggles', 'location-bar'],
  ['data-panel', 'pp-toggles'], ['scene-panel', 'pp-toggles'],
  ['data-panel', 'control-panel'], ['control-panel', 'pp-toggles', 'global-context-panel'],
];
let idx = 0;
for (const seq of combos) {
  await closeAll();
  const steps = [];
  for (const id of seq) { const c = await clickCard(id, 1400); steps.push({ id, click: c }); }
  await sleep(3200); // let WAAPI morph + push settle fully
  const s = await state();
  const rec = { seq, steps, expanded: s.expanded, overlaps: s.overlaps, minGap: s.minGap, outOfView: s.outOfView,
    headerHits: Object.fromEntries(Object.entries(s.hits).filter(([, v]) => !v.open ? true : true)),
    blockedClicks: steps.filter((x) => !x.click.ok) };
  // real click on each COLLAPSED header must open its own card
  const openTargets = [];
  for (const id of COLLAPSIBLE) {
    if (s.expanded.includes(id)) continue;
    const c = await clickCard(id, 1200);
    const st = await page.evaluate((i) => { const el = document.getElementById(i); const r = el.getBoundingClientRect(); return { open: !el.classList.contains('collapsed'), rect: [+r.x.toFixed(1), +r.y.toFixed(1)] }; }, id);
    openTargets.push({ id, clicked: c, opened: st.open });
  }
  rec.openCollapsedHeaders = openTargets;
  R.combos.push(rec);
  console.log('## combo', idx++, seq.join('+'), 'overlaps', JSON.stringify(s.overlaps), 'minGap', s.minGap, 'outOfView', JSON.stringify(s.outOfView), 'openFails', openTargets.filter((o) => !o.opened).length);
  if (seq.join('+') === 'control-panel+pp-toggles') await page.screenshot({ path: path.join(OUT, 'B-control-panel_pp-toggles.png') });
  if (seq.join('+') === 'pp-toggles+control-panel') await page.screenshot({ path: path.join(OUT, 'B-pp-toggles_control-panel.png') });
  if (seq.join('+') === 'control-panel+cctv-panel') await page.screenshot({ path: path.join(OUT, 'B-control-panel_cctv-panel.png') });
}

put('totalCombos', R.combos.length);
put('combosWithOverlap', R.combos.filter((c) => c.overlaps.length).map((c) => ({ seq: c.seq, overlaps: c.overlaps })));
put('combosOutOfView', R.combos.filter((c) => c.outOfView.length).map((c) => ({ seq: c.seq, outOfView: c.outOfView })));
put('combosBlockedClicks', R.combos.filter((c) => c.blockedClicks.length).map((c) => ({ seq: c.seq, blocked: c.blockedClicks })));
put('combosOpenFailures', R.combos.flatMap((c) => c.openCollapsedHeaders.filter((o) => !o.opened).map((o) => ({ seq: c.seq, ...o }))));
put('trust', await page.evaluate(() => window.__tr));

fs.writeFileSync(path.join(OUT, 'B-combos.json'), JSON.stringify(R, null, 1));
console.log('WROTE B-combos.json');
await browser.close();
