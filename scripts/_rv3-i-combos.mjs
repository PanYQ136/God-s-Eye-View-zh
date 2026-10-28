#!/usr/bin/env node
/**
 * _rv3-i-combos.mjs — reviewer round-3 probe I (contract lens): pairwise overlap audit for
 * every reachable 2-card / 3-card combination (one expanded per group + dock cards), settled,
 * including header hit-test ownership.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 2500)); };

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
await sleep(9000);

const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const clickCard = async (cardId) => {
  const probe = await page.evaluate((cardId) => {
    const el = document.getElementById(cardId); if (!el) return { ok: false };
    const er = el.getBoundingClientRect();
    const pts = [{ x: Math.round(er.x + er.width / 2), y: Math.round(er.y + Math.min(12, er.height / 2)) }];
    for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) pts.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }); }
    for (const p of pts) { const e = document.elementFromPoint(p.x, p.y); if (e && el.contains(e)) return { ok: true, at: [p.x, p.y] }; }
    return { ok: false };
  }, cardId);
  if (!probe.ok) return false;
  await page.mouse.move(probe.at[0], probe.at[1]);
  await page.mouse.down(); await page.mouse.up();
  await sleep(900);
  return true;
};
const snap = () => page.evaluate((IDS) => {
  const o = {};
  for (const id of IDS) { const el = document.getElementById(id); if (!el) continue; const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], open: !el.classList.contains('collapsed'), vis: c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05 }; }
  const ov = (a, b) => { const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])); const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])); return { x: +ix.toFixed(1), y: +iy.toFixed(1), area: Math.round(ix * iy) }; };
  const ids = Object.keys(o).filter((k) => o[k].vis);
  const overlaps = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const v = ov(o[ids[i]].rect, o[ids[j]].rect); if (v.area > 20) overlaps.push({ a: ids[i], b: ids[j], ...v }); }
  const hits = {};
  for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
    const el = document.getElementById(id); if (!el) continue; const r = el.getBoundingClientRect();
    const e = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(12, r.height / 2)));
    hits[id] = { own: !!(e && el.contains(e)), owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : null };
  }
  return { o, overlaps, hits };
}, CARDS);

const closeAll = async () => {
  for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
    const open = await page.evaluate((i) => { const el = document.getElementById(i); return el && !el.classList.contains('collapsed'); }, id);
    if (open) await clickCard(id);
  }
  await sleep(700);
};

const combos = [
  ['control-panel', 'pp-toggles'],
  ['pp-toggles', 'control-panel'],
  ['location-bar', 'pp-toggles'],
  ['pp-toggles', 'location-bar'],
  ['control-panel', 'cctv-panel'],
  ['control-panel', 'global-context-panel'],
  ['control-panel', 'data-panel'],
  ['control-panel', 'scene-panel'],
  ['data-panel', 'pp-toggles'],
  ['scene-panel', 'pp-toggles'],
  ['control-panel', 'location-bar'],
  ['control-panel', 'location-bar', 'pp-toggles'],
];
const results = [];
for (const steps of combos) {
  await closeAll();
  for (const s of steps) await clickCard(s);
  await sleep(1200);
  const sn = await snap();
  results.push({ steps: steps.join(' -> '), overlaps: sn.overlaps, outOfView: Object.entries(sn.o).filter(([, v]) => v.vis && (v.rect[0] < -1 || v.rect[1] < -1 || v.rect[0] + v.rect[2] > W + 1 || v.rect[1] + v.rect[3] > H + 1)).map(([k]) => k),
    occludedHeaders: Object.entries(sn.hits).filter(([, v]) => !v.own).map(([k, v]) => ({ id: k, owner: v.owner })),
    rects: Object.fromEntries(Object.entries(sn.o).map(([k, v]) => [k, [v.rect[1], v.rect[1] + v.rect[3]]])) });
  if (steps.join('->') === 'control-panel->pp-toggles') await page.screenshot({ path: path.join(OUT, 'R3-I-control-pp.png') });
}
put('combos', results);
fs.writeFileSync(path.join(OUT, 'I-combos.json'), JSON.stringify(R, null, 1));
console.log('WROTE', path.join(OUT, 'I-combos.json'));
await browser.close();
