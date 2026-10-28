#!/usr/bin/env node
/**
 * _rv3-g-rail.mjs — reviewer round-3 probe G: is the cctv<->global mini overlap
 * (seen in probe F with pp expanded, area 1232) transient mid-morph or persistent?
 * Samples the three right-rail cards at t+0.3..4s in two paths:
 *   path A: fresh page -> click pp once
 *   path B: the probe-F sequence (location, control, data, scene, then pp)
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 2000)); };

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

const clickOwned = async (cardId) => {
  const probe = await page.evaluate((cardId) => {
    const el = document.getElementById(cardId); if (!el) return { ok: false };
    const er = el.getBoundingClientRect();
    const pts = [{ x: Math.round(er.x + er.width / 2), y: Math.round(er.y + Math.min(12, er.height / 2)) }];
    for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) pts.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }); }
    for (const p of pts) { const e = document.elementFromPoint(p.x, p.y); if (e && el.contains(e)) return { ok: true, at: [p.x, p.y] }; }
    return { ok: false };
  }, cardId);
  if (!probe.ok) return { clicked: false };
  await page.mouse.move(probe.at[0], probe.at[1]);
  await page.mouse.down(); await page.mouse.up();
  return { clicked: true };
};

const rail = () => page.evaluate(() => {
  const ids = ['pp-toggles', 'cctv-panel', 'global-context-panel', 'control-panel', 'gev-voice-control', 'location-bar'];
  const o = {};
  for (const id of ids) { const el = document.getElementById(id); if (!el) continue; const r = el.getBoundingClientRect(); o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], open: !el.classList.contains('collapsed') }; }
  const ov = (a, b) => { const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])); const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])); return Math.round(ix * iy); };
  return { o, cctvGlobal: ov(o['cctv-panel'].rect, o['global-context-panel'].rect), ppCctv: ov(o['pp-toggles'].rect, o['cctv-panel'].rect), ppGlobal: ov(o['pp-toggles'].rect, o['global-context-panel'].rect),
    cctvHit: (() => { const el = document.getElementById('cctv-panel'); const r = el.getBoundingClientRect(); const e = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + 10)); return { own: !!(e && el.contains(e)), hit: e && e.tagName + '.' + String(e.className || '').split(' ')[0], owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : null }; })(),
    globalHit: (() => { const el = document.getElementById('global-context-panel'); const r = el.getBoundingClientRect(); const e = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + 10)); return { own: !!(e && el.contains(e)), hit: e && e.tagName + '.' + String(e.className || '').split(' ')[0], owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : null }; })() };
});

const series = async (label) => {
  const out = {};
  for (const t of [0.3, 0.6, 1.0, 1.6, 2.4, 3.2, 4.2]) {
    await sleep(t * 1000 - (out.__last || 0));
    out.__last = t * 1000;
    out['t+' + t] = await rail();
  }
  delete out.__last;
  return out;
};

// path A
await clickOwned('pp-toggles');
put('pathA_fresh_pp_open', await series('A'));
await page.screenshot({ path: path.join(OUT, 'R3-G-pathA.png') });
await clickOwned('pp-toggles'); await sleep(900);

// path B: mimic probe F
for (const id of ['location-bar', 'control-panel', 'data-panel', 'scene-panel']) { await clickOwned(id); await sleep(900); await clickOwned(id); await sleep(800); }
await clickOwned('pp-toggles');
put('pathB_after_sequence_pp_open', await series('B'));
await page.screenshot({ path: path.join(OUT, 'R3-G-pathB.png') });

fs.writeFileSync(path.join(OUT, 'G-rail.json'), JSON.stringify(R, null, 1));
console.log('WROTE', path.join(OUT, 'G-rail.json'));
await browser.close();
