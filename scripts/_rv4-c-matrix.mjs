#!/usr/bin/env node
/* _rv4-c-matrix.mjs — reviewer round-4 probe C (contract lens): 7-item acceptance matrix
   re-run — per-frame mutex, pp wheel scroll, rapid real taps, collapse restore, reload all-mini. */
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

const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const COLLAPSIBLE = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const BASE = {
  'data-panel': [52, 93.8, 176, 43], 'scene-panel': [52, 144.8, 176, 43],
  'pp-toggles': [1308, 93.8, 176, 50], 'cctv-panel': [1308, 151.8, 176, 50],
  'global-context-panel': [1308, 209.8, 176, 50], 'location-bar': [530, 632, 168, 86],
  'control-panel': [838, 632, 168, 86], 'gev-voice-control': [698, 632, 140, 85.6],
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
page.on('pageerror', (e) => (R.consoleErrors = R.consoleErrors || []).push(String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(10000);

const rectsTo = async (ids) => page.evaluate((ids) => Object.fromEntries(ids.map((id) => { const el = document.getElementById(id); if (!el) return [id, null]; const r = el.getBoundingClientRect(); return [id, [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)]]; })), ids);

const clickCard = async (id, wait = 900) => {
  const p = await page.evaluate((id) => {
    const el = document.getElementById(id); if (!el) return { ok: false };
    const er = el.getBoundingClientRect(); const cands = [];
    for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]); }
    cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]);
    for (const q of cands) { const e = document.elementFromPoint(q[0], q[1]); if (e && el.contains(e)) return { ok: true, at: q }; }
    return { ok: false };
  }, id);
  if (!p.ok) return p;
  await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up();
  await sleep(wait);
  return p;
};
const closeAll = async () => { for (const id of COLLAPSIBLE) { const o = await page.evaluate((i) => { const el = document.getElementById(i); return el && !el.classList.contains('collapsed'); }, id); if (o) await clickCard(id, 800); } await sleep(1200); };

// ---------- 1) mutex with per-frame sampling ----------
const startSampler = () => page.evaluate(() => {
  window.__fr = [];
  const L = ['data-panel', 'scene-panel'], Rt = ['pp-toggles', 'cctv-panel', 'global-context-panel'];
  const rd = () => {
    const st = (id) => { const el = document.getElementById(id); if (!el) return { open: false, hidden: true }; const c = getComputedStyle(el); return { open: !el.classList.contains('collapsed') && c.display !== 'none' && +c.opacity > 0.05, hidden: el.hidden || c.display === 'none' || +c.opacity < 0.05 }; };
    window.__fr.push({ t: performance.now(), L: L.map(st), R: Rt.map(st) });
    if (window.__fr.length < 1400) requestAnimationFrame(rd);
  };
  requestAnimationFrame(rd);
});
await startSampler();
await clickCard('data-panel', 700); await clickCard('scene-panel', 700); await clickCard('data-panel', 700);
await clickCard('pp-toggles', 700); await clickCard('cctv-panel', 700); await clickCard('global-context-panel', 700); await clickCard('pp-toggles', 700);
const frames = await page.evaluate(() => window.__fr);
{
  let maxL = 0, maxR = 0, empty = 0, hiddenR = 0, hiddenL = 0, emptyAfterFirst = 0;
  for (const f of frames) {
    const ln = f.L.filter((x) => x.open).length, rn = f.R.filter((x) => x.open).length;
    maxL = Math.max(maxL, ln); maxR = Math.max(maxR, rn);
    if (ln + rn === 0) empty++;
    if (f.L.some((x) => x.hidden)) hiddenL++;
    if (f.R.some((x) => x.hidden)) hiddenR++;
  }
  put('mutex', { frames: frames.length, maxLeft: maxL, maxRight: maxR, emptyFramesTotal: empty, hiddenLeftFrames: hiddenL, hiddenRightFrames: hiddenR });
  // empty frames between first open and end (i.e. an actual same-group gap)
  let first = frames.findIndex((f) => f.L.some((x) => x.open) || f.R.some((x) => x.open));
  const tail = frames.slice(first);
  put('mutex_empty_after_first_open', tail.filter((f) => !f.L.some((x) => x.open) && !f.R.some((x) => x.open)).length);
}
await page.screenshot({ path: path.join(OUT, 'C-mutex-final.png') });
await closeAll();

// ---------- 2) pp wheel + row spacing ----------
await clickCard('pp-toggles', 1600);
const ppBefore = await page.evaluate(() => {
  const card = document.getElementById('pp-toggles');
  const sc = [...card.querySelectorAll('*')].filter((n) => { const c = getComputedStyle(n); return /(auto|scroll)/.test(c.overflowY) && n.scrollHeight > n.clientHeight + 4; }).sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || card;
  const rows = [...sc.children].filter((n) => n.getBoundingClientRect().height > 4);
  const rr = rows.map((n) => n.getBoundingClientRect());
  let minGap = 999; const overlaps = [];
  for (let i = 0; i < rr.length; i++) for (let j = i + 1; j < rr.length; j++) {
    const a = rr[i], b = rr[j];
    const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ix > 0 && iy > 0) overlaps.push({ i, j, ix: +ix.toFixed(1), iy: +iy.toFixed(1) });
    const g = b.top - a.bottom; if (g >= -0.5) minGap = Math.min(minGap, +g.toFixed(1));
  }
  const alpha = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return 0; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
  const btns = [...card.querySelectorAll('button, .pp-row, .pp-opt, [role="button"]')].map((b) => { const c = getComputedStyle(b); return { bg: c.backgroundColor, a: alpha(c.backgroundColor), color: c.color, liteTxt: /rgb\((2[0-5][0-9])/.test(c.color) }; });
  const darkTxt = btns.filter((b) => { const m = /rgb\((\d+), (\d+), (\d+)\)|rgba\((\d+), (\d+), (\d+)/.exec(b.color); if (!m) return false; const v = [+(m[1] || m[4]), +(m[2] || m[5]), +(m[3] || m[6])]; return Math.max(...v) < 90; });
  return { scroll: { top: sc.scrollTop, h: sc.scrollHeight, ch: sc.clientHeight }, rows: rr.length, minGap, overlaps, btns: btns.length, solid: btns.filter((b) => b.a > 0.12), darkTxt: darkTxt.length };
});
let wheelPos = [];
for (let i = 0; i < 4; i++) {
  const box = await page.evaluate(() => { const el = document.getElementById('pp-toggles'); const r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height * 0.6)]; });
  await page.mouse.move(box[0], box[1]);
  await page.mouse.wheel({ deltaY: 120 });
  await sleep(320);
  wheelPos.push(await page.evaluate(() => { const card = document.getElementById('pp-toggles'); const sc = [...card.querySelectorAll('*')].filter((n) => { const c = getComputedStyle(n); return /(auto|scroll)/.test(c.overflowY) && n.scrollHeight > n.clientHeight + 4; }).sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || card; return +sc.scrollTop.toFixed(1); }));
}
await page.screenshot({ path: path.join(OUT, 'C-pp-scrolled.png') });
put('pp', { ...ppBefore, wheelPath: wheelPos });
put('pp_scrolled_ok', wheelPos[wheelPos.length - 1] > (ppBefore.scroll.top + 60));

// ---------- 3) rapid real taps ----------
await closeAll();
const rapidTargets = ['data-panel', 'pp-toggles', 'scene-panel', 'cctv-panel', 'control-panel', 'data-panel', 'global-context-panel', 'pp-toggles', 'scene-panel', 'location-bar', 'control-panel', 'cctv-panel', 'data-panel', 'global-context-panel', 'pp-toggles', 'location-bar'];
let misses = 0, taps = 0;
for (const id of rapidTargets) {
  const p = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return { ok: false }; const r = el.getBoundingClientRect(); const q = [Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(14, r.height / 2))]; const e = document.elementFromPoint(q[0], q[1]); return { ok: !!(e && el.contains(e)), at: q, owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : null }; }, id);
  if (!p.ok) { misses++; continue; }
  taps++;
  await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up();
  await sleep(150);
}
await sleep(3500);
const rapidState = await page.evaluate((IDS) => {
  const o = {}; for (const id of IDS) { const el = document.getElementById(id); if (!el) continue; const c = getComputedStyle(el); if (c.display === 'none' || +c.opacity < 0.05) continue; const r = el.getBoundingClientRect(); o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], open: !el.classList.contains('collapsed') }; }
  const ids = Object.keys(o); const ov = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const a = o[ids[i]].rect, b = o[ids[j]].rect; const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]); const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]); if (ix > 0 && iy > 0) ov.push({ a: ids[i], b: ids[j], ix: +ix.toFixed(1), iy: +iy.toFixed(1) }); }
  const out = ids.filter((id) => o[id].rect[0] < -1 || o[id].rect[1] < -1 || o[id].rect[0] + o[id].rect[2] > innerWidth + 1 || o[id].rect[1] + o[id].rect[3] > innerHeight + 1);
  return { o, ov, out, expanded: ids.filter((id) => o[id].open) };
}, IDS);
await page.screenshot({ path: path.join(OUT, 'C-rapid.png') });
put('rapid', { taps, misses, overlaps: rapidState.ov, outOfView: rapidState.out, expanded: rapidState.expanded });

// ---------- 4) collapse restore ----------
await closeAll();
const afterCollapse = await rectsTo(IDS);
{
  const diff = [];
  for (const id of IDS) { const b = BASE[id], n = afterCollapse[id]; if (!n) { diff.push({ id, missing: true }); continue; } const d = n.map((v, i) => +(v - b[i]).toFixed(2)); if (d.some((v) => Math.abs(v) > 0.6)) diff.push({ id, base: b, now: n, d }); }
  put('collapse_rect_diff', diff);
}
await page.screenshot({ path: path.join(OUT, 'C-collapsed.png') });

// ---------- 5) reload -> still all mini ----------
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
const reloadSamples = [];
for (const t of [3000, 2000, 3000, 5000]) {
  await sleep(t);
  const s = await page.evaluate((IDS) => ({ expanded: IDS.filter((id) => { const el = document.getElementById(id); return el && !el.classList.contains('collapsed'); }), vis: IDS.filter((id) => { const el = document.getElementById(id); if (!el) return false; const c = getComputedStyle(el); return c.display !== 'none' && +c.opacity > 0.05; }), rects: Object.fromEntries(IDS.map((id) => { const el = document.getElementById(id); if (!el) return [id, null]; const r = el.getBoundingClientRect(); return [id, [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)]]; })) }), IDS);
  reloadSamples.push({ at: t, expanded: s.expanded });
  if (t === 5000) put('reload_rects_vs_base', IDS.map((id) => { const b = BASE[id], n = s.rects[id]; return n ? { id, d: n.map((v, i) => +(v - b[i]).toFixed(2)) } : { id, missing: true }; }).filter((x) => x.missing || x.d.some((v) => Math.abs(v) > 0.6)));
}
put('reload_samples', reloadSamples);
await page.screenshot({ path: path.join(OUT, 'C-reloaded.png') });

// ---------- 6) FPS after settle ----------
const fps = await page.evaluate(async () => {
  const runs = [];
  for (let k = 0; k < 4; k++) {
    const t = []; let last = performance.now(); let n = 0;
    await new Promise((res) => { const tick = (ts) => { t.push(ts - last); last = ts; if (++n < 120) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
    const d = t.slice(3).sort((a, b) => a - b); runs.push(+(1000 / d[Math.floor(d.length / 2)]).toFixed(1));
  }
  runs.sort((a, b) => a - b);
  return { runs, median: runs[Math.floor(runs.length / 2)] };
});
put('fps', fps);
put('trust', await page.evaluate(() => window.__tr));
put('consoleErrors', R.consoleErrors || []);
fs.writeFileSync(path.join(OUT, 'C-matrix.json'), JSON.stringify(R, null, 1));
console.log('WROTE C-matrix.json');
await browser.close();
