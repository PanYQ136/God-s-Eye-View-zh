#!/usr/bin/env node
/**
 * _rv2-t829-chrome.mjs — REVIEWER round-2 (execution lens) probe A.
 * Independent harness (not the implementer's): verify the 11 chrome targets the
 * implementer claims were made transparent, their hover/pressed states, and a
 * whole-page inventory of any remaining dark solid / frosted surface.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r2');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TARGETS = ['clear-selected-layers', 'share-btn', 'tilt-map-view', 'north-up-view',
  'reset-globe-view', 'key-setup-chip', 'gev-lang-toggle', 'gev-locate-btn',
  'gev-perf-btn', 'gev-perf-fps', 'gev-toast', 'gev-dossier'];

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
  window.__rv = { down: 0, downT: 0, click: 0, clickT: 0, move: 0 };
  for (const t of ['pointerdown', 'click']) {
    document.addEventListener(t, (e) => {
      if (t === 'pointerdown') { window.__rv.down++; if (e.isTrusted) window.__rv.downT++; }
      else { window.__rv.click++; if (e.isTrusted) window.__rv.clickT++; }
    }, true);
  }
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(8000);

const snap = () => page.evaluate((IDS) => {
  const alpha = (c) => {
    const s = String(c);
    if (/^rgba?\(/.test(s)) { const p = s.match(/rgba?\(([^)]+)\)/)[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; }
    return 0;
  };
  const imgAlpha = (bi) => {
    if (!bi || bi === 'none') return 0;
    const m = [...String(bi).matchAll(/rgba?\(([^)]+)\)/g)].map((x) => { const p = x[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; });
    return m.length ? Math.max(...m) : 0.5;
  };
  const out = {};
  for (const id of IDS) {
    const el = document.getElementById(id);
    if (!el) { out[id] = null; continue; }
    const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    out[id] = {
      rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)],
      bg: c.backgroundColor, bgA: +alpha(c.backgroundColor).toFixed(3),
      bgI: c.backgroundImage === 'none' ? 'none' : String(c.backgroundImage).slice(0, 40),
      bgIA: +imgAlpha(c.backgroundImage).toFixed(3),
      bf: c.backdropFilter, wbf: c.webkitBackdropFilter,
      color: c.color, opacity: +(+c.opacity).toFixed(2),
      pressed: el.getAttribute('aria-pressed'),
      visible: c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > .05,
    };
  }
  return out;
}, TARGETS);

const report = { started: new Date().toISOString(), viewport: `${W}x${H}` };
report.initial = await snap();
await page.screenshot({ path: path.join(OUT, 'A-initial.png') });

// clip crop of the top-centre action bar (5 round buttons) for visual check
await page.screenshot({ path: path.join(OUT, 'A-topbar-crop.png'), clip: { x: 640, y: 10, width: 260, height: 80 } });
await page.screenshot({ path: path.join(OUT, 'A-chips-crop.png'), clip: { x: 850, y: 20, width: 700, height: 60 } });

// hover every target with real mouse, then re-snap
const boxOf = async (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2) return null;
  return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)];
}, id);

const hoverStates = {};
for (const id of TARGETS) {
  const p = await boxOf(id);
  if (!p) { hoverStates[id] = 'no-box'; continue; }
  await page.mouse.move(p[0] - 30, p[1] - 30); await sleep(80);
  await page.mouse.move(p[0], p[1]); await sleep(220);
  const s = await snap();
  hoverStates[id] = { at: p, bgA: s[id] && s[id].bgA, bf: s[id] && s[id].bf, bgIA: s[id] && s[id].bgIA, bg: s[id] && s[id].bg };
}
report.hover = hoverStates;
await page.screenshot({ path: path.join(OUT, 'A-after-hover.png') });

// pressed state for the two toggle buttons (real click, then read, then click back)
report.pressed = {};
for (const id of ['tilt-map-view', 'gev-perf-btn']) {
  const p = await boxOf(id);
  if (!p) { report.pressed[id] = 'no-box'; continue; }
  await page.mouse.move(p[0], p[1]); await sleep(60);
  await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(350);
  const s = await snap();
  report.pressed[id] = { on: s[id] && s[id].pressed, bgA: s[id] && s[id].bgA, bg: s[id] && s[id].bg, bf: s[id] && s[id].bf, bgIA: s[id] && s[id].bgIA, color: s[id] && s[id].color };
}
await page.screenshot({ path: path.join(OUT, 'A-pressed.png') });

// restore toggles
for (const id of ['tilt-map-view', 'gev-perf-btn']) {
  const p = await boxOf(id);
  if (!p) continue;
  await page.mouse.move(p[0], p[1]); await sleep(60);
  await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(300);
}

// whole-page inventory: any frosted / dark solid surface left anywhere
report.inventory = await page.evaluate(() => {
  const alpha = (c) => {
    const s = String(c);
    if (/^rgba?\(/.test(s)) { const p = s.match(/rgba?\(([^)]+)\)/)[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; }
    return 0;
  };
  const imgAlpha = (bi) => {
    if (!bi || bi === 'none') return 0;
    const m = [...String(bi).matchAll(/rgba?\(([^)]+)\)/g)].map((x) => { const p = x[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; });
    return m.length ? Math.max(...m) : 0.5;
  };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const c = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < .05) continue;
    if (r.width < 6 || r.height < 6) continue;
    const bgA = alpha(c.backgroundColor), iA = imgAlpha(c.backgroundImage);
    const bf = c.backdropFilter && c.backdropFilter !== 'none' ? c.backdropFilter : '';
    const filterBlur = /blur/.test(String(c.filter || '')) ? c.filter : '';
    const area = r.width * r.height;
    const bad = !!bf || (bgA > .02 && area > 400) || (iA > .02 && area > 400);
    if (!bad) continue;
    out.push({
      id: el.id || '', tag: el.tagName, cls: String(el.className || '').slice(0, 34),
      bgA: +bgA.toFixed(3), iA: +iA.toFixed(3), bf, filterBlur,
      rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)],
      area: Math.round(area), insideCard: !!el.closest('.gev-lc'),
      text: (el.textContent || '').trim().slice(0, 12),
    });
  }
  return out;
});

report.pointerTrust = await page.evaluate(() => window.__rv);
report.xGlyphs = await page.evaluate(() => {
  const out = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) {
    const n = w.currentNode;
    if (!/[\u2715\u2716\u2717\u00d7\uff58]/.test(n.nodeValue)) continue;
    const p = n.parentElement; if (!p) continue;
    const r = p.getBoundingClientRect(); const c = getComputedStyle(p);
    if (r.width < 2 || r.height < 2 || c.display === 'none' || c.visibility === 'hidden' || +c.opacity < .05) continue;
    out.push({ tag: p.tagName, cls: String(p.className || '').slice(0, 30), text: n.nodeValue.trim().slice(0, 10), rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)] });
  }
  return out;
});

fs.writeFileSync(path.join(OUT, 'A-chrome.json'), JSON.stringify(report, null, 1));
console.log('INITIAL', JSON.stringify(report.initial, null, 0).slice(0, 2500));
console.log('HOVER', JSON.stringify(report.hover).slice(0, 1500));
console.log('PRESSED', JSON.stringify(report.pressed).slice(0, 900));
console.log('INVENTORY count=' + report.inventory.length);
for (const x of report.inventory) console.log(' INV ' + JSON.stringify(x));
console.log('XGLYPHS', JSON.stringify(report.xGlyphs));
console.log('TRUST', JSON.stringify(report.pointerTrust));
await browser.close();
