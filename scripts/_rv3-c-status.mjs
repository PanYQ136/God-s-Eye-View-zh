#!/usr/bin/env node
/**
 * _rv3-c-status.mjs — reviewer round-3 probe C (CONTRACT lens, own harness).
 *  (1) real click #tilt-map-view -> #toast visible frame: computed + pagewide frosted/dark scan
 *  (2) status chips (traffic/cctv/global-loading) material + forced-visible pagewide scan
 *  (3) dock spill occlusion: control->cctv and cctv->control, elementFromPoint BEFORE click, real clicks
 *  (4) pointer trust counters printed per interaction batch
 *  (5) mutex empty-frame attribution (rAF sampler + click markers)
 *  (6) pp row pitch measured on direct children of the scroller (no ancestor/descendant artifacts)
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { started: new Date().toISOString(), viewport: `${W}x${H}`, round: 3, lens: 'contract' };
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 2500)); };

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
  window.__rv = { down: 0, downT: 0, click: 0, clickT: 0, wheel: 0, wheelT: 0 };
  for (const t of ['pointerdown', 'click', 'wheel']) {
    document.addEventListener(t, (e) => {
      if (t === 'pointerdown') { window.__rv.down++; if (e.isTrusted) window.__rv.downT++; }
      else if (t === 'click') { window.__rv.click++; if (e.isTrusted) window.__rv.clickT++; }
      else { window.__rv.wheel++; if (e.isTrusted) window.__rv.wheelT++; }
    }, true);
  }
  window.__log = [];
  window.__startLog = () => { window.__log = []; const tick = () => { const st = (id) => { const el = document.getElementById(id); if (!el) return null; const c = getComputedStyle(el); return { open: !el.classList.contains('collapsed'), vis: c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05 }; };
      const L = ['data-panel', 'scene-panel'], RR = ['pp-toggles', 'cctv-panel', 'global-context-panel'];
      window.__log.push({ t: +performance.now().toFixed(1), k: 'f', l: L.filter((i) => (st(i) || {}).open), r: RR.filter((i) => (st(i) || {}).open),
        hR: RR.filter((i) => { const s = st(i); return s && !s.vis; }), hL: L.filter((i) => { const s = st(i); return s && !s.vis; }) });
      window.__raf = requestAnimationFrame(tick); };
    tick(); };
  window.__mark = (m) => window.__log.push({ t: +performance.now().toFixed(1), k: 'm', m });
  window.__stopLog = () => { cancelAnimationFrame(window.__raf); return window.__log; };
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9000);

const ALPHA_BODY = `const s=String(c);if(/^rgba?\\(/.test(s)){const p=s.match(/rgba?\\(([^)]+)\\)/)[1].split(/[,\\s\\/]+/).filter(Boolean).map(Number);return p.length>3?p[3]:1;}return 0;`;
const trust = () => page.evaluate(() => ({ ...window.__rv }));

const scan = () => page.evaluate((BODY) => {
  const a = new Function('c', BODY);
  const vis = (el) => { const c = getComputedStyle(el); const r = el.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05 && r.width > 1 && r.height > 1; };
  const frosted = [], dark = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || !!el.closest('.gev-lc')) continue;
    const c = getComputedStyle(el);
    const bf = c.backdropFilter || 'none';
    const r = el.getBoundingClientRect();
    if (bf !== 'none') frosted.push({ sel: el.tagName + '#' + el.id + '.' + String(el.className || '').split(' ')[0], bf });
    if (a(c.backgroundColor) > 0.2 && r.width * r.height > 300) dark.push({ sel: el.tagName + '#' + el.id + '.' + String(el.className || '').split(' ')[0], bg: c.backgroundColor, area: Math.round(r.width * r.height) });
  }
  return { frosted, dark };
}, ALPHA_BODY);

const clickOwned = async (cardId, note = '') => {
  const probe = await page.evaluate((cardId) => {
    const el = document.getElementById(cardId); if (!el) return { ok: false };
    const er = el.getBoundingClientRect();
    const pts = [{ x: Math.round(er.x + er.width / 2), y: Math.round(er.y + Math.min(12, er.height / 2)) }];
    for (const h of el.querySelectorAll('.panel-title, .pp-header-label, .location-toolbar-label, .dock-title, .panel-header')) {
      const r = h.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) pts.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    }
    for (const p of pts) { const e = document.elementFromPoint(p.x, p.y); if (e && el.contains(e)) return { ok: true, at: [p.x, p.y], hit: e.tagName + '.' + String(e.className || '').split(' ')[0] }; }
    const e0 = document.elementFromPoint(pts[0].x, pts[0].y);
    return { ok: false, blockedBy: e0 && e0.tagName + '.' + String(e0.className || '').split(' ')[0], owner: e0 && e0.closest('.gev-lc') ? e0.closest('.gev-lc').id : null };
  }, cardId);
  if (!probe.ok) { await page.evaluate((n) => window.__mark && window.__mark('MISS ' + n), cardId + note); return { card: cardId, clicked: false, ...probe }; }
  await page.evaluate((n) => window.__mark && window.__mark('pre ' + n), cardId + note);
  await page.mouse.move(probe.at[0], probe.at[1]);
  await page.mouse.down(); await page.mouse.up();
  await page.evaluate((n) => window.__mark && window.__mark('post ' + n), cardId + note);
  await sleep(650);
  return { card: cardId, clicked: true, preHit: probe.hit, at: probe.at };
};

// ---------- (1) real click #tilt-map-view -> #toast ----------
const tBtn = await page.evaluate(() => { const b = document.getElementById('tilt-map-view'); const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
await page.mouse.move(tBtn.x, tBtn.y); await sleep(80); await page.mouse.down(); await page.mouse.up();
await sleep(120);
const toastFrame = await page.evaluate((BODY) => {
  const a = new Function('c', BODY);
  const el = document.getElementById('toast'); if (!el) return null;
  const c = getComputedStyle(el); const r = el.getBoundingClientRect();
  return { text: (el.textContent || '').trim().slice(0, 40), cls: el.className, rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)],
    bg: c.backgroundColor, bgA: +a(c.backgroundColor).toFixed(2), bgImg: c.backgroundImage === 'none' ? 'none' : c.backgroundImage.slice(0, 40),
    bf: c.backdropFilter || 'none', border: c.borderColor, opacity: c.opacity, visibility: c.visibility, color: c.color };
}, ALPHA_BODY);
put('toast_after_real_click', { at: [tBtn.x, tBtn.y], frame: toastFrame, pagewide: await scan(), trust: await trust() });
await page.screenshot({ path: path.join(OUT, 'R3-C-toast-visible.png') });
await page.screenshot({ path: path.join(OUT, 'R3-C-toast-crop.png'), clip: { x: 620, y: 560, width: 320, height: 110 } });

// ---------- (2) status chips ----------
const chipsIdle = await page.evaluate((BODY) => {
  const a = new Function('c', BODY);
  const o = {};
  for (const id of ['traffic-sync-chip', 'cctv-sync-chip', 'global-loading-status']) {
    const el = document.getElementById(id); if (!el) { o[id] = null; continue; }
    const c = getComputedStyle(el); const r = el.getBoundingClientRect();
    o[id] = { bg: c.backgroundColor, bgA: +a(c.backgroundColor).toFixed(2), bf: c.backdropFilter || 'none', rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)],
      vis: c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05, state: el.dataset.state || null, text: (el.textContent || '').trim().slice(0, 24) };
  }
  return o;
}, ALPHA_BODY);
// force-visible (opacity only, material unchanged) and re-scan the page for frosted/dark chrome
const chipsForced = await page.evaluate((BODY) => {
  const a = new Function('c', BODY);
  const ids = ['traffic-sync-chip', 'cctv-sync-chip', 'global-loading-status'];
  const out = {};
  for (const id of ids) { const el = document.getElementById(id); if (!el) continue; el.style.opacity = '1'; el.style.visibility = 'visible'; el.style.display = 'flex'; }
  for (const id of ids) { const el = document.getElementById(id); if (!el) continue; const c = getComputedStyle(el); out[id] = { bg: c.backgroundColor, bgA: +a(c.backgroundColor).toFixed(2), bf: c.backdropFilter || 'none', vis: true }; }
  return out;
}, ALPHA_BODY);
const chipScan = await scan();
put('status_chips', { idle: chipsIdle, forced: chipsForced, pagewideWhileVisible: chipScan });
await page.screenshot({ path: path.join(OUT, 'R3-C-chips.png') });
// restore
await page.evaluate(() => { for (const id of ['traffic-sync-chip', 'cctv-sync-chip', 'global-loading-status']) { const el = document.getElementById(id); if (!el) continue; el.style.opacity = ''; el.style.visibility = ''; el.style.display = ''; } });
await sleep(200);

// ---------- (3) dock spill occlusion, both orders ----------
const occl = async (first, second) => {
  // ensure all mini first
  for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
    const open = await page.evaluate((i) => { const el = document.getElementById(i); return el && !el.classList.contains('collapsed'); }, id);
    if (open) { await clickOwned(id); await sleep(400); }
  }
  const a1 = await clickOwned(first);
  await sleep(700);
  const a2 = await clickOwned(second);
  await sleep(900);
  const state = await page.evaluate(() => {
    const ids = ['pp-toggles', 'cctv-panel', 'global-context-panel', 'control-panel', 'gev-voice-control', 'location-bar'];
    const o = {};
    for (const id of ids) { const el = document.getElementById(id); if (!el) { o[id] = null; continue; } const r = el.getBoundingClientRect(); o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], open: !el.classList.contains('collapsed') }; }
    const ov = (a, b) => { const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])); const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])); return Math.round(ix * iy); };
    const hits = {};
    for (const id of ['pp-toggles', 'cctv-panel', 'global-context-panel']) {
      const el = document.getElementById(id); if (!el) continue;
      const r = el.getBoundingClientRect();
      const hx = Math.round(r.x + r.width * 0.5), hy = Math.round(r.y + 10);
      const e = document.elementFromPoint(hx, hy);
      hits[id] = { at: [hx, hy], own: !!(e && el.contains(e)), hit: e && e.tagName + '.' + String(e.className || '').split(' ')[0], owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : null };
    }
    return { rects: o, voiceVs: { global: ov(o['gev-voice-control'].rect, o['global-context-panel'].rect), pp: ov(o['gev-voice-control'].rect, o['pp-toggles'].rect), cctv: ov(o['gev-voice-control'].rect, o['cctv-panel'].rect), control: ov(o['gev-voice-control'].rect, o['control-panel'].rect) }, hits };
  });
  await page.screenshot({ path: path.join(OUT, `R3-C-occl-${first}-then-${second}.png`) });
  // now real-click all three right rail headers (the contract: each header must open its own card)
  const rightClicks = [];
  for (const id of ['pp-toggles', 'cctv-panel', 'global-context-panel']) {
    const r = await clickOwned(id);
    await sleep(700);
    const st = await page.evaluate((i) => { const el = document.getElementById(i); return { open: !el.classList.contains('collapsed'), hidden: getComputedStyle(el).visibility === 'hidden' }; }, id);
    rightClicks.push({ id, clicked: r.clicked, preHit: r.preHit, blockedBy: r.blockedBy, owner: r.owner, open: st.open, hidden: st.hidden });
  }
  return { first, second, clicks: [a1.clicked, a2.clicked], ...state, rightClicks };
};
put('occl_a', await occl('control-panel', 'cctv-panel'));
put('occl_b', await occl('cctv-panel', 'control-panel'));
put('trust_after_occl', await trust());

// ---------- (5) mutex empty-frame attribution ----------
for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel']) {
  const open = await page.evaluate((i) => { const el = document.getElementById(i); return el && !el.classList.contains('collapsed'); }, id);
  if (open) { await clickOwned(id); await sleep(400); }
}
await page.evaluate(() => window.__startLog());
const seq = ['data-panel', 'scene-panel', 'data-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'pp-toggles'];
for (const id of seq) { await clickOwned(id); await sleep(600); }
const log = await page.evaluate(() => window.__stopLog());
const framesOnly = log.filter((x) => x.k === 'f');
const emptyRuns = [];
let cur = null;
for (let i = 0; i < log.length; i++) {
  const e = log[i];
  if (e.k !== 'f') { if (cur) { emptyRuns.push(cur); cur = null; } continue; }
  const empty = e.l.length === 0 && e.r.length === 0;
  if (empty) {
    if (!cur) cur = { startT: e.t, frames: 0, before: (log[i - 1] || {}).m || (log[i - 1] || {}), prevGroups: null };
    cur.frames++;
    cur.endT = e.t;
    // find last marker before start
    if (!cur.marker) { for (let j = i - 1; j >= 0; j--) { if (log[j].k === 'm') { cur.marker = log[j].m; break; } } }
  } else if (cur) { emptyRuns.push(cur); cur = null; }
  if (!empty && e.l.length === 0) { /* left empty but right open */ }
}
if (cur) emptyRuns.push(cur);
put('mutex_frames', { frames: framesOnly.length, maxLeft: Math.max(...framesOnly.map((f) => f.l.length)), maxRight: Math.max(...framesOnly.map((f) => f.r.length)),
  emptyFrameCount: framesOnly.filter((f) => f.l.length === 0 && f.r.length === 0).length,
  emptyRuns: emptyRuns.map((r) => ({ marker: r.marker, frames: r.frames, ms: +(r.endT - r.startT).toFixed(1) })),
  hiddenRightFrames: framesOnly.filter((f) => f.hR.length).length, hiddenLeftFrames: framesOnly.filter((f) => f.hL.length).length,
  final: framesOnly[framesOnly.length - 1] });

// ---------- (6) pp rows: direct children of the scroller ----------
const ppOpen = await page.evaluate(() => !document.getElementById('pp-toggles').classList.contains('collapsed'));
if (!ppOpen) { await clickOwned('pp-toggles'); await sleep(800); }
const ppRows = await page.evaluate((BODY) => {
  const a = new Function('c', BODY);
  const el = document.getElementById('pp-toggles');
  const body = el.querySelector('.pp-panel-body') || el;
  const rows = [...body.children].filter((c) => c.getBoundingClientRect().height > 1);
  const rr = rows.map((c, i) => { const r = c.getBoundingClientRect(); return { i, cls: String(c.className || '').split(' ')[0] + '.' + String(c.className || '').split(' ')[1], y: +r.y.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1) }; });
  let minGap = Infinity, worst = null;
  for (let i = 1; i < rr.length; i++) { const g = rr[i].y - rr[i - 1].b; if (g < minGap) { minGap = g; worst = [rr[i - 1].cls, rr[i].cls]; } }
  const btns = [...el.querySelectorAll('button')];
  const solid = [], darkTxt = [];
  for (const b of btns) { const c = getComputedStyle(b); const al = a(c.backgroundColor); if (al > 0.35) solid.push({ t: (b.textContent || '').trim().slice(0, 10), bg: c.backgroundColor }); }
  const pressed = [...el.querySelectorAll('[aria-pressed="true"], .on, .active')].map((e) => { const c = getComputedStyle(e); return { t: (e.textContent || '').trim().slice(0, 10), bg: c.backgroundColor, bgA: +a(c.backgroundColor).toFixed(2), color: c.color }; });
  return { rows: rr.length, minGap: +minGap.toFixed(1), worstPair: worst, rects: rr, solidButtons: solid.slice(0, 8), pressedStates: pressed.slice(0, 8),
    clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, bodyClient: body.clientHeight, bodyScroll: body.scrollHeight };
}, ALPHA_BODY);
const pcx = 1184 + 150, pcy = 94 + 200;
await page.mouse.move(pcx, pcy); await sleep(120);
await page.mouse.wheel({ deltaY: 250 }); await sleep(400);
const ws1 = await page.evaluate(() => document.getElementById('pp-toggles').scrollTop);
await page.mouse.wheel({ deltaY: 500 }); await sleep(400);
const ws2 = await page.evaluate(() => document.getElementById('pp-toggles').scrollTop);
put('pp_rows_clean', { ...ppRows, scroll: { after250: ws1, after750: ws2 }, trust: await trust() });
await page.screenshot({ path: path.join(OUT, 'R3-C-pp-scrolled.png') });

put('trust_final', await trust());
R.finished = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'C-status.json'), JSON.stringify(R, null, 1));
console.log('WROTE', path.join(OUT, 'C-status.json'));
await browser.close();
