#!/usr/bin/env node
/**
 * _rv3-h-overlap.mjs — reviewer round-3 probe H: minimal repro for the right-rail mini
 * overlap (cctv-panel bottom vs global-context-panel top) seen with pp expanded + a dock
 * card expanded. Tests 5 orderings/subsets at settled state (t+2s) plus elementFromPoint.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 1800)); };

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

const clickCard = async (cardId) => {
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
  await page.mouse.down(); await page.mouse.up();
  await sleep(1400);
  return { clicked: true, preHit: probe.hit };
};

const measure = () => page.evaluate(() => {
  const ids = ['pp-toggles', 'cctv-panel', 'global-context-panel', 'control-panel', 'location-bar', 'gev-voice-control', 'data-panel', 'scene-panel'];
  const o = {};
  for (const id of ids) { const el = document.getElementById(id); if (!el) continue; const r = el.getBoundingClientRect(); o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], open: !el.classList.contains('collapsed') }; }
  const ov = (a, b) => { const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])); const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])); return { x: +ix.toFixed(1), y: +iy.toFixed(1), area: Math.round(ix * iy) }; };
  const hits = {};
  for (const id of ['pp-toggles', 'cctv-panel', 'global-context-panel']) {
    const el = document.getElementById(id); const r = el.getBoundingClientRect();
    const e = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + 10));
    hits[id] = { own: !!(e && el.contains(e)), owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : null };
  }
  return { o, cctvGlobal: ov(o['cctv-panel'].rect, o['global-context-panel'].rect), ppCctv: ov(o['pp-toggles'].rect, o['cctv-panel'].rect), hits };
});

const closeAll = async () => {
  for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
    const open = await page.evaluate((i) => { const el = document.getElementById(i); return el && !el.classList.contains('collapsed'); }, id);
    if (open) await clickCard(id);
  }
  await sleep(900);
};

const cases = [];
// case 1: pp only
await closeAll();
cases.push({ name: 'pp-only', steps: [], result: null });
await clickCard('pp-toggles'); await sleep(1200);
cases[cases.length - 1].result = await measure();
await page.screenshot({ path: path.join(OUT, 'R3-H-pp-only.png') });

// case 2: control first, then pp
await closeAll();
await clickCard('control-panel'); await sleep(600);
await clickCard('pp-toggles'); await sleep(1400);
cases.push({ name: 'control-then-pp', result: await measure() });
await page.screenshot({ path: path.join(OUT, 'R3-H-control-then-pp.png') });

// case 3: pp first, then control
await closeAll();
await clickCard('pp-toggles'); await sleep(600);
await clickCard('control-panel'); await sleep(1400);
cases.push({ name: 'pp-then-control', result: await measure() });
await page.screenshot({ path: path.join(OUT, 'R3-H-pp-then-control.png') });

// case 4: location first, then pp
await closeAll();
await clickCard('location-bar'); await sleep(600);
await clickCard('pp-toggles'); await sleep(1400);
cases.push({ name: 'location-then-pp', result: await measure() });

// case 5: pp only again (regression repeat after all the churn)
await closeAll();
await clickCard('pp-toggles'); await sleep(1400);
cases.push({ name: 'pp-only-repeat', result: await measure() });

put('cases', cases.map((c) => ({ name: c.name, cctv: c.result.o['cctv-panel'].rect, global: c.result.o['global-context-panel'].rect,
  pp: c.result.o['pp-toggles'].rect, cctvGlobal: c.result.cctvGlobal, ppCctv: c.result.ppCctv, hits: c.result.hits,
  control: c.result.o['control-panel'] })));
fs.writeFileSync(path.join(OUT, 'H-overlap.json'), JSON.stringify(R, null, 1));
console.log('WROTE', path.join(OUT, 'H-overlap.json'));
await browser.close();
