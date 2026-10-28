#!/usr/bin/env node
/* _rv5-b-3click.mjs — reviewer round-5 probe B (contract lens, fresh harness).
   Round-4 blocker determinism: clean reload -> click 3 headers (right-rail family) in the
   reviewer-reported order, settle, verify 0 overlap, both headers own=true, and that a real
   click on each header opens its own card. 5 rounds x 2 pacings + reversed orders.
   Also: pairwise overlap audit over a matrix of open combinations. */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r5');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};
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
page.on('pageerror', (e) => (R.consoleErrors = R.consoleErrors || []).push(String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(10000);

/* ---- helpers ---- */
const hitOf = (id) => page.evaluate((id) => {
  const el = document.getElementById(id); if (!el) return { ok: false };
  const er = el.getBoundingClientRect(); const cands = [];
  for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) {
    const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]);
  }
  cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]);
  for (const q of cands) {
    const e = document.elementFromPoint(q[0], q[1]);
    if (e && el.contains(e)) return { ok: true, at: q, sel: e.tagName + '.' + ((e.className && e.className.toString().split(' ')[0]) || '') };
  }
  const q = cands[cands.length - 1];
  const e0 = document.elementFromPoint(q[0], q[1]);
  return { ok: false, at: q, hit: e0 ? (e0.tagName + '.' + ((e0.className && e0.className.toString().split(' ')[0]) || '')) : 'null', owner: e0 && e0.closest('.gev-lc') ? e0.closest('.gev-lc').id : null };
}, id);
const clickId = async (id, wait = 1000) => { const p = await hitOf(id); if (!p.ok) return p; await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); await sleep(wait); return p; };
const geo = () => page.evaluate((IDS) => {
  const alpha = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return 0; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id); if (!el) continue;
    const c = getComputedStyle(el); if (c.display === 'none' || +c.opacity < 0.05) continue;
    const r = el.getBoundingClientRect();
    o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], open: !el.classList.contains('collapsed'), bgA: alpha(c.backgroundColor), inView: r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
  }
  const ids = Object.keys(o); const ov = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = o[ids[i]].rect, b = o[ids[j]].rect;
    const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    if (ix > 0.5 && iy > 0.5) ov.push({ a: ids[i], b: ids[j], ix: +ix.toFixed(1), iy: +iy.toFixed(1), area: Math.round(ix * iy) });
  }
  return { o, ov, out: ids.filter((id) => !o[id].inView) };
}, IDS);

/* ---- A) the exact reviewer round-4 3-click sequence ---- */
const seqs = [
  { name: 'pp->control->global', order: ['pp-toggles', 'control-panel', 'global-context-panel'], pace: 1200 },
  { name: 'control->pp->global', order: ['control-panel', 'pp-toggles', 'global-context-panel'], pace: 1200 },
  { name: 'global->control->pp', order: ['global-context-panel', 'control-panel', 'pp-toggles'], pace: 1200 },
  { name: 'pp->control->global', order: ['pp-toggles', 'control-panel', 'global-context-panel'], pace: 2500 },
  { name: 'pp->control->cctv', order: ['pp-toggles', 'control-panel', 'cctv-panel'], pace: 2500 },
];
const seqResults = [];
for (const s of seqs) {
  for (let round = 1; round <= 3; round++) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#pp-toggles', { timeout: 120000 });
    await sleep(9000);
    const clicks = [];
    for (const id of s.order) { clicks.push({ id, hit: await clickId(id, s.pace) }); }
    await sleep(4200); // settle past the 1.8s normalizeRail window
    const g = await geo();
    // header ownership at the terminal state (hit test BEFORE any click)
    const hdrs = {};
    for (const id of ['pp-toggles', 'cctv-panel', 'global-context-panel']) hdrs[id] = await hitOf(id);
    seqResults.push({ seq: s.name, pace: s.pace, round, clicks_ok: clicks.every((c) => c.hit.ok), rects: g.o, overlaps: g.ov, out: g.out, headers_own: Object.fromEntries(Object.entries(hdrs).map(([k, v]) => [k, v.ok])), hdr_hits: hdrs, expanded: Object.keys(g.o).filter((k) => g.o[k].open) });
    console.log('### seq', s.name, 'r', round, 'ov', g.ov.length, 'hdrs', JSON.stringify(Object.fromEntries(Object.entries(hdrs).map(([k, v]) => [k, v.ok]))));
    if (round === 1) await page.screenshot({ path: path.join(OUT, `B-${s.name.replace(/->/g, '_')}.png`) });
  }
}
put('three_click', {
  rounds: seqResults.length,
  failures: seqResults.filter((s) => s.overlaps.length || s.out.length || !s.clicks_ok || !Object.values(s.headers_own).every(Boolean)).map((s) => ({ seq: s.seq, pace: s.pace, round: s.round, overlaps: s.overlaps, out: s.out, clicks_ok: s.clicks_ok, headers_own: s.headers_own })),
  terminal_rects: seqResults.map((s) => ({ seq: s.seq, round: s.round, pp: s.rects['pp-toggles'], cctv: s.rects['cctv-panel'], global: s.rects['global-context-panel'], ctrl: s.rects['control-panel'], expanded: s.expanded })),
});

/* ---- A2) at that terminal state: real click each right-rail header -> opens itself ---- */
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9000);
for (const id of ['pp-toggles', 'control-panel', 'global-context-panel']) await clickId(id, 1200);
await sleep(4500);
const clickOwn = [];
for (const id of ['cctv-panel', 'pp-toggles', 'global-context-panel', 'cctv-panel']) {
  const h = await hitOf(id);
  if (!h.ok) { clickOwn.push({ id, hit: h, ok: false }); continue; }
  await page.mouse.move(h.at[0], h.at[1]); await page.mouse.down(); await page.mouse.up();
  await sleep(2000);
  const g = await geo();
  const others = ['pp-toggles', 'cctv-panel', 'global-context-panel'].filter((x) => x !== id);
  clickOwn.push({ id, hit_at: h.at, opened_self: !!(g.o[id] && g.o[id].open), others_closed: others.every((x) => !g.o[x] || !g.o[x].open), overlaps: g.ov, out: g.out });
  await page.screenshot({ path: path.join(OUT, `B-own-${id}.png`) });
}
put('header_click_opens_self', clickOwn);
put('trust', await page.evaluate(() => window.__tr));
put('consoleErrors', R.consoleErrors || []);
fs.writeFileSync(path.join(OUT, 'B-3click.json'), JSON.stringify(R, null, 1));
console.log('WROTE B-3click.json');
await browser.close();
