#!/usr/bin/env node
/**
 * _rv3-f-matrix.mjs — reviewer round-3 probe F (CONTRACT lens, own harness).
 *  (1) hover material for the r1 chrome targets (real mouse moves, isTrusted)
 *  (2) per-card single-open scenario: pairwise overlap of all 9 cards, inView, every header
 *      hit-test ownership (elementFromPoint BEFORE any click), real click opens own card
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 2400)); };

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
  window.__rv = { down: 0, downT: 0, click: 0, clickT: 0, wheel: 0, wheelT: 0, move: 0 };
  for (const t of ['pointerdown', 'click', 'pointermove']) document.addEventListener(t, (e) => { if (t === 'pointerdown') { window.__rv.down++; if (e.isTrusted) window.__rv.downT++; } else if (t === 'click') { window.__rv.click++; if (e.isTrusted) window.__rv.clickT++; } else window.__rv.move++; }, true);
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9000);

const BODY = `const s=String(c);if(/^rgba?\\(/.test(s)){const p=s.match(/rgba?\\(([^)]+)\\)/)[1].split(/[,\\s\\/]+/).filter(Boolean).map(Number);return p.length>3?p[3]:1;}return 0;`;
const CHROME = ['clear-selected-layers', 'share-btn', 'tilt-map-view', 'north-up-view', 'reset-globe-view', 'key-setup-chip', 'gev-lang-toggle', 'gev-locate-btn', 'gev-perf-btn', 'gev-perf-fps', 'gev-toast'];

// ---------- (1) hover material ----------
const hover = [];
for (const id of CHROME) {
  const box = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return null; const r = el.getBoundingClientRect(); if (r.width < 2) return null; return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }, id);
  if (!box) { hover.push({ id, skipped: 'not visible' }); continue; }
  await page.mouse.move(box.x, box.y); await sleep(260);
  hover.push(await page.evaluate((id, B) => {
    const a = new Function('c', B);
    const el = document.getElementById(id); const c = getComputedStyle(el);
    return { id, bg: c.backgroundColor, bgA: +a(c.backgroundColor).toFixed(2), bgImg: c.backgroundImage === 'none' ? 'none' : c.backgroundImage.slice(0, 40), bf: c.backdropFilter || 'none' };
  }, id, BODY));
}
put('hover', hover);
await page.screenshot({ path: path.join(OUT, 'R3-F-hover.png') });
await page.mouse.move(760, 400); await sleep(200);

// ---------- (2) single-open scenario matrix ----------
const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const snap = () => page.evaluate((IDS) => {
  const o = {};
  for (const id of IDS) { const el = document.getElementById(id); if (!el) continue; const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], open: !el.classList.contains('collapsed'),
      vis: c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05, inView: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 }; }
  const ov = (a, b) => { const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])); const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])); return Math.round(ix * iy); };
  const ids = Object.keys(o).filter((k) => o[k].vis);
  const overlaps = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const area = ov(o[ids[i]].rect, o[ids[j]].rect); if (area > 20) overlaps.push({ a: ids[i], b: ids[j], area }); }
  const hits = {};
  for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
    const el = document.getElementById(id); if (!el) continue;
    const er = el.getBoundingClientRect();
    const e = document.elementFromPoint(Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(12, er.height / 2)));
    hits[id] = { own: !!(e && el.contains(e)), owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : null, hit: e && e.tagName + '.' + String(e.className || '').split(' ')[0] };
  }
  return { cards: o, overlaps, hits };
}, CARDS);

const clickOwned = async (cardId) => {
  const probe = await page.evaluate((cardId) => {
    const el = document.getElementById(cardId); if (!el) return { ok: false };
    const er = el.getBoundingClientRect();
    const pts = [{ x: Math.round(er.x + er.width / 2), y: Math.round(er.y + Math.min(12, er.height / 2)) }];
    for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) pts.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }); }
    for (const p of pts) { const e = document.elementFromPoint(p.x, p.y); if (e && el.contains(e)) return { ok: true, at: [p.x, p.y], hit: e.tagName + '.' + String(e.className || '').split(' ')[0] }; }
    return { ok: false };
  }, cardId);
  if (!probe.ok) return { clicked: false };
  await page.mouse.move(probe.at[0], probe.at[1]);
  await page.mouse.down(); await page.mouse.up(); await sleep(700);
  return { clicked: true, preHit: probe.hit };
};

const scenarios = [];
for (const id of ['location-bar', 'control-panel', 'data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel']) {
  // ensure everything closed first
  for (const j of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
    const open = await page.evaluate((i) => { const el = document.getElementById(i); return el && !el.classList.contains('collapsed'); }, j);
    if (open) await clickOwned(j);
  }
  await sleep(600);
  const c = await clickOwned(id);
  await sleep(500);
  const s = await snap();
  scenarios.push({ open: id, clicked: c.clicked, preHit: c.preHit, openState: s.cards[id] && s.cards[id].open, overlaps: s.overlaps, outOfView: Object.entries(s.cards).filter(([, v]) => !v.inView).map(([k]) => k), badHeaders: Object.entries(s.hits).filter(([, v]) => !v.own).map(([k, v]) => ({ id: k, ...v })) });
  await page.screenshot({ path: path.join(OUT, `R3-F-open-${id}.png`) });
}
put('scenarios', scenarios);
put('trust', await page.evaluate(() => window.__rv));
fs.writeFileSync(path.join(OUT, 'F-matrix.json'), JSON.stringify(R, null, 1));
console.log('WROTE', path.join(OUT, 'F-matrix.json'));
await browser.close();
