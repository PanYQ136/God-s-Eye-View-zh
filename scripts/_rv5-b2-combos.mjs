#!/usr/bin/env node
/* _rv5-b2-combos.mjs — reviewer round-5 probe B2: pairwise overlap / header ownership over
   a matrix of open combinations (2-card and 3-card), real mouse clicks only. */
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

const hitOf = (id) => page.evaluate((id) => {
  const el = document.getElementById(id); if (!el) return { ok: false };
  const er = el.getBoundingClientRect(); const cands = [];
  for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) {
    const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]);
  }
  cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]);
  for (const q of cands) { const e = document.elementFromPoint(q[0], q[1]); if (e && el.contains(e)) return { ok: true, at: q }; }
  return { ok: false, at: cands[cands.length - 1] };
}, id);
const clickId = async (id, wait = 1000) => { const p = await hitOf(id); if (!p.ok) return p; await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); await sleep(wait); return p; };
const geo = () => page.evaluate((IDS) => {
  const alpha = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return 0; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
  const o = {};
  for (const id of IDS) { const el = document.getElementById(id); if (!el) continue; const c = getComputedStyle(el); if (c.display === 'none' || +c.opacity < 0.05) continue; const r = el.getBoundingClientRect(); o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], open: !el.classList.contains('collapsed'), bgA: alpha(c.backgroundColor), inView: r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 }; }
  const ids = Object.keys(o); const ov = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = o[ids[i]].rect, b = o[ids[j]].rect;
    const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    if (ix > 0.5 && iy > 0.5) ov.push({ a: ids[i], b: ids[j], ix: +ix.toFixed(1), iy: +iy.toFixed(1), area: Math.round(ix * iy) });
  }
  return { o, ov, out: ids.filter((id) => !o[id].inView) };
}, IDS);

const combos = [];
for (const a of ['pp-toggles', 'cctv-panel', 'global-context-panel']) for (const b of ['data-panel', 'scene-panel', 'location-bar', 'control-panel']) combos.push([b, a]);
combos.push(
  ['control-panel', 'pp-toggles', 'global-context-panel'],
  ['control-panel', 'cctv-panel', 'global-context-panel'],
  ['pp-toggles', 'control-panel', 'cctv-panel'],
  ['data-panel', 'control-panel', 'pp-toggles'],
  ['scene-panel', 'control-panel', 'cctv-panel'],
  ['location-bar', 'pp-toggles', 'global-context-panel'],
);
const results = [];
for (const c of combos) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pp-toggles', { timeout: 120000 });
  await sleep(7500);
  const clicks = [];
  for (const id of c) clicks.push({ id, ok: (await clickId(id, 1000)).ok });
  await sleep(4200);
  const g = await geo();
  const own = {};
  for (const id of COLLAPSIBLE) own[id] = (await hitOf(id)).ok;
  results.push({ combo: c, clicks_ok: clicks.every((x) => x.ok), overlaps: g.ov, out: g.out, expanded: Object.keys(g.o).filter((k) => g.o[k].open), headers_own: own, shell: Object.fromEntries(Object.entries(g.o).map(([k, v]) => [k, v.bgA])) });
  console.log('### combo', c.join('+'), 'ov', g.ov.length, 'out', g.out.length, 'own', Object.values(own).filter(Boolean).length + '/7', JSON.stringify(g.ov));
  if (c.length >= 3) await page.screenshot({ path: path.join(OUT, `B2-combo-${c.join('_')}.png`) });
}
put('combos', { count: results.length, bad: results.filter((x) => x.overlaps.length || x.out.length || !x.clicks_ok).map((x) => ({ combo: x.combo, overlaps: x.overlaps, out: x.out })), hdr_own: results.map((x) => ({ combo: x.combo, own: Object.values(x.headers_own).filter(Boolean).length, expanded: x.expanded })), shell_alpha_max: Math.max(...results.flatMap((x) => Object.values(x.shell))) });
put('trust', await page.evaluate(() => window.__tr));
put('consoleErrors', R.consoleErrors || []);
fs.writeFileSync(path.join(OUT, 'B2-combos.json'), JSON.stringify(R, null, 1));
console.log('WROTE B2-combos.json');
await browser.close();
