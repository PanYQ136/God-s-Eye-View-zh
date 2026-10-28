#!/usr/bin/env node
/* _rv4-a-contract.mjs — reviewer round-4 probe A (contract lens, my own harness).
   Contract items: initial all-mini baseline vs r3 accepted baseline, shell material,
   page-wide frosted/dark audit, x-close glyphs, 7 header real clicks, FPS. */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r4');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 3000)); };

const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const COLLAPSIBLE = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];

// r3 reviewer-accepted all-mini baseline (my own previous round evidence)
const BASE = {
  'data-panel': [52, 93.8, 176, 43],
  'scene-panel': [52, 144.8, 176, 43],
  'pp-toggles': [1308, 93.8, 176, 50],
  'cctv-panel': [1308, 151.8, 176, 50],
  'global-context-panel': [1308, 209.8, 176, 50],
  'location-bar': [530, 632, 168, 86],
  'control-panel': [838, 632, 168, 86],
  'gev-voice-control': [698, 632, 140, 85.6],
  'gev-gfx-fab': [1482, 592, 42, 42],
};

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
  window.__tr = { down: 0, downT: 0, click: 0, clickT: 0, wheel: 0, wheelT: 0 };
  addEventListener('pointerdown', (e) => { window.__tr.down++; if (e.isTrusted) window.__tr.downT++; }, true);
  addEventListener('click', (e) => { window.__tr.click++; if (e.isTrusted) window.__tr.clickT++; }, true);
  addEventListener('wheel', (e) => { window.__tr.wheel++; if (e.isTrusted) window.__tr.wheelT++; }, { capture: true, passive: true });
});
page.on('console', (m) => { if (m.type() === 'error') (R.consoleErrors = R.consoleErrors || []).push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => (R.consoleErrors = R.consoleErrors || []).push('pageerror: ' + String(e).slice(0, 200)));

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(10000); // init settle (rail CSS fallback -> JS value ~2s, Cesium first frame)

const SNAP = (IDS) => {
  const alpha = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return 0; const p = m[1].split(',').map((v) => parseFloat(v)); return p.length > 3 ? p[3] : 1; };
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id); if (!el) { o[id] = null; continue; }
    const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      open: !el.classList.contains('collapsed'), display: c.display, vis: c.visibility, op: +c.opacity,
      bgA: +alpha(c.backgroundColor).toFixed(3), bgImg: c.backgroundImage.slice(0, 40), bf: c.backdropFilter || c.webkitBackdropFilter,
      inView: r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
      hidden: el.hidden || c.display === 'none' || +c.opacity < 0.05 };
  }
  // frosted / dark audit inside each card
  const inner = {};
  for (const id of IDS) {
    const el = document.getElementById(id); if (!el) continue;
    const frost = [], dark = [];
    for (const n of el.querySelectorAll('*')) {
      const c = getComputedStyle(n); const r = n.getBoundingClientRect();
      if (r.width * r.height < 200) continue;
      if ((c.backdropFilter || '').includes('blur')) frost.push({ sel: n.tagName + '.' + (n.className && n.className.toString().split(' ')[0] || ''), bf: c.backdropFilter });
      const a = alpha(c.backgroundColor);
      if (a > 0.2 && r.width * r.height > 300) dark.push({ sel: n.tagName + '.' + (n.className && n.className.toString().split(' ')[0] || ''), bg: c.backgroundColor, area: Math.round(r.width * r.height) });
    }
    inner[id] = { frost, dark };
  }
  // page-wide frosted (visible only) + dark solid blocks outside cards
  const frosted = [], darkBlocks = [];
  for (const n of document.querySelectorAll('body *')) {
    const c = getComputedStyle(n); const r = n.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
    if (+c.opacity < 0.05 || c.visibility === 'hidden' || c.display === 'none') continue;
    const bf = c.backdropFilter || c.webkitBackdropFilter;
    if (bf && bf.includes('blur') && !n.closest('.gev-lc')) frosted.push({ sel: n.tagName + '#' + n.id + '.' + (n.className && n.className.toString().split(' ')[0] || ''), bf, rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)] });
    const a = alpha(c.backgroundColor);
    if (a > 0.25 && r.width * r.height > 400 && !n.closest('.gev-lc')) darkBlocks.push({ sel: n.tagName + '#' + n.id + '.' + (n.className && n.className.toString().split(' ')[0] || ''), bg: c.backgroundColor, area: Math.round(r.width * r.height) });
  }
  const xGlyphs = (document.body.innerText.match(/\u2715/g) || []).length;
  const xEls = document.querySelectorAll('.gev-lc-close').length;
  return { o, inner, frosted, darkBlocks, xGlyphs, xEls };
};

put('initial', await page.evaluate(SNAP, CARDS));
// baseline diff vs r3 accepted baseline
{
  const now = R.initial.o; const diff = [];
  for (const id of CARDS) {
    const b = BASE[id]; const n = now[id]; if (!n) { diff.push({ id, missing: true }); continue; }
    const d = n.rect.map((v, i) => +(v - b[i]).toFixed(2));
    if (d.some((v) => Math.abs(v) > 0.6)) diff.push({ id, base: b, now: n.rect, d });
  }
  put('baseline_rect_diff', diff);
}
{
  const o = R.initial.o;
  put('initial_all_mini', COLLAPSIBLE.every((id) => o[id] && !o[id].open));
  put('shell_alpha', COLLAPSIBLE.map((id) => [id, o[id].bgA, o[id].bf]));
  put('initial_center_frost_dark', Object.fromEntries(Object.entries(R.initial.inner).map(([k, v]) => [k, { frost: v.frost.length, dark: v.dark }])));
}

await page.screenshot({ path: path.join(OUT, 'A-initial.png') });

// ---- 7 header real clicks ----
const clickCardReal = async (id, opts = {}) => {
  const probe = await page.evaluate((id) => {
    const el = document.getElementById(id); if (!el) return { ok: false };
    const er = el.getBoundingClientRect();
    const cands = [];
    for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header, .pp-header')) {
      const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]);
    }
    cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]);
    for (const p of cands) {
      const e = document.elementFromPoint(p[0], p[1]);
      if (e && el.contains(e)) return { ok: true, at: p, hitSel: e.tagName + '.' + ((e.className && e.className.toString().split(' ')[0]) || '') };
    }
    const e0 = document.elementFromPoint(cands[cands.length - 1][0], cands[cands.length - 1][1]);
    return { ok: false, at: cands[cands.length - 1], hitSel: e0 ? e0.tagName + '.' + ((e0.className && e0.className.toString().split(' ')[0]) || '') + ' owner=' + (e0.closest('.gev-lc') ? e0.closest('.gev-lc').id : '-') : 'null' };
  }, id);
  if (!probe.ok) return probe;
  await page.mouse.move(probe.at[0], probe.at[1]);
  await page.mouse.down(); await page.mouse.up();
  await sleep(opts.wait || 900);
  return probe;
};

const headers = {};
for (const id of COLLAPSIBLE) {
  const c = await clickCardReal(id);
  const st = await page.evaluate(({ id }) => {
    const el = document.getElementById(id); const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    const alpha = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return 0; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
    const frost = []; const dark = [];
    for (const n of el.querySelectorAll('*')) { const c = getComputedStyle(n); const rr = n.getBoundingClientRect(); if (rr.width * rr.height < 200) continue;
      const bf = c.backdropFilter || ''; if (bf.includes('blur')) frost.push(n.tagName + '.' + ((n.className && n.className.toString().split(' ')[0]) || ''));
      if (alpha(c.backgroundColor) > 0.2 && rr.width * rr.height > 300) dark.push({ sel: n.tagName + '.' + ((n.className && n.className.toString().split(' ')[0]) || ''), bg: c.backgroundColor, area: Math.round(rr.width * rr.height) }); }
    return { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], open: !el.classList.contains('collapsed'), hidden: el.hidden || cs.display === 'none' || +cs.opacity < 0.05, bgA: alpha(cs.backgroundColor), bf: cs.backdropFilter, frost: frost.length, dark, inView: r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
  }, { id });
  headers[id] = { click: c, ...st };
  if (st.open) { await clickCardReal(id); }
  await sleep(300);
}
put('seven_headers', headers);
put('headers_opened_ok', Object.values(headers).filter((h) => h.open && !h.hidden && h.inView && h.bgA < 0.02).length + '/7');

// ---- FPS ----
const fps = await page.evaluate(async () => {
  const t = []; let last = performance.now(); let n = 0;
  await new Promise((res) => { const tick = (ts) => { t.push(ts - last); last = ts; if (++n < 240) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  const d = t.slice(5).sort((a, b) => a - b);
  return { median: +(1000 / d[Math.floor(d.length / 2)]).toFixed(1), min: +(1000 / d[d.length - 1]).toFixed(1), max: +(1000 / d[0]).toFixed(1), frames: d.length };
});
put('fps', fps);
put('trust', await page.evaluate(() => window.__tr));
put('consoleErrors', R.consoleErrors || []);

fs.writeFileSync(path.join(OUT, 'A-contract.json'), JSON.stringify(R, null, 1));
console.log('WROTE', path.join(OUT, 'A-contract.json'));
await browser.close();
