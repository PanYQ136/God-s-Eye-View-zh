#!/usr/bin/env node
/* _rv5-d-status-idle.mjs — reviewer round-5 probe D.
   Phase 1: prior-round rework regression — status-type chrome (#toast on a real click at
            #tilt-map-view, #global-loading-status / #traffic-sync-chip / #cctv-sync-chip)
            must be 0-fill + no backdrop-filter, and the page must show 0 frosted / 0 dark
            blocks in that same frame.
   Phase 2: new-risk audit for the round-5 normalizeRail channel — idle stability (no drift /
            no style churn while all-mini and while one card is expanded), and the voice
            error tray (dark block seen in the material scan) visibility check.
   Phase 3: rapid-tap determinism, 5 iterations, 150ms taps. */
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
  window.__tr = { down: 0, downT: 0, click: 0, clickT: 0, wheel: 0, wheelT: 0 };
  addEventListener('pointerdown', (e) => { window.__tr.down++; if (e.isTrusted) window.__tr.downT++; }, true);
  addEventListener('click', (e) => { window.__tr.click++; if (e.isTrusted) window.__tr.clickT++; }, true);
  addEventListener('wheel', (e) => { window.__tr.wheel++; if (e.isTrusted) window.__tr.wheelT++; }, { capture: true, passive: true });
});
page.on('pageerror', (e) => (R.consoleErrors = R.consoleErrors || []).push(String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(10000);

const PAGE_AUDIT = () => {
  const alpha = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return 0; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
  const frosted = [], dark = [];
  for (const n of document.querySelectorAll('body *')) {
    const c = getComputedStyle(n); const r = n.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
    if (+c.opacity < 0.05 || c.visibility === 'hidden' || c.display === 'none') continue;
    const bf = c.backdropFilter || c.webkitBackdropFilter;
    if (bf && bf.includes('blur')) frosted.push({ sel: n.tagName + '#' + n.id + '.' + ((n.className && n.className.toString().split(' ')[0]) || ''), bf, inCard: !!n.closest('.gev-lc'), rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)] });
    const a = alpha(c.backgroundColor);
    if (a > 0.25 && r.width * r.height > 400) dark.push({ sel: n.tagName + '#' + n.id + '.' + ((n.className && n.className.toString().split(' ')[0]) || ''), bg: c.backgroundColor, area: Math.round(r.width * r.height), inCard: !!n.closest('.gev-lc') });
  }
  return { frosted, dark };
};
const STATUS_STYLE = (SEL) => {
  const alpha = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return 0; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
  const o = {};
  for (const s of SEL) {
    const el = document.querySelector(s); if (!el) { o[s] = null; continue; }
    const c = getComputedStyle(el); const r = el.getBoundingClientRect();
    o[s] = { bgA: +alpha(c.backgroundColor).toFixed(3), bg: c.backgroundColor, bgImg: c.backgroundImage.slice(0, 24), bf: c.backdropFilter || c.webkitBackdropFilter, op: +c.opacity, vis: c.visibility, disp: c.display, rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)] };
  }
  return o;
};
const STATUS_SEL = ['#toast', '#global-loading-status', '#traffic-sync-chip', '#cctv-sync-chip', '.gev-voice-error-tray'];

/* ---------- Phase 1: real click on #tilt-map-view -> #toast ---------- */
const tiltBox = await page.evaluate(() => { const el = document.querySelector('#tilt-map-view'); const r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; });
const toastBefore = await page.evaluate(STATUS_STYLE, STATUS_SEL);
await page.mouse.move(tiltBox[0], tiltBox[1]); await page.mouse.down(); await page.mouse.up();
await sleep(400);
const toastAfter = await page.evaluate(STATUS_STYLE, STATUS_SEL);
const auditToastFrame = await page.evaluate(PAGE_AUDIT);
await page.screenshot({ path: path.join(OUT, 'D-toast-visible.png') });
put('toast_real_click', { before: toastBefore['#toast'], after: toastAfter['#toast'], other_status: { gl: toastAfter['#global-loading-status'], traffic: toastAfter['#traffic-sync-chip'], cctv: toastAfter['#cctv-sync-chip'] } });
put('toast_frame_audit', { frostedOut: auditToastFrame.frosted.filter((f) => !f.inCard), darkOut: auditToastFrame.dark.filter((d) => !d.inCard) });
await sleep(4000);

/* ---------- Phase 2: idle stability + voice error tray ---------- */
const trayVis = await page.evaluate(() => { const t = document.querySelector('.gev-voice-error-tray'); if (!t) return null; const c = getComputedStyle(t); const r = t.getBoundingClientRect(); return { disp: c.display, vis: c.visibility, op: +c.opacity, rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)], cls: t.className }; });
put('voice_error_tray', trayVis);

const rectsNow = () => page.evaluate((IDS) => Object.fromEntries(IDS.map((id) => { const el = document.getElementById(id); if (!el) return [id, null]; const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return [id, { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], tf: c.transform }]; })), IDS);

// count style attribute mutations on rail cards over a window
const watchMutations = (ms) => page.evaluate(({ IDS, ms }) => new Promise((res) => {
  const els = IDS.map((id) => document.getElementById(id)).filter(Boolean);
  let n = 0; const touched = {};
  const mo = new MutationObserver((recs) => recs.forEach((r) => { n++; const el = r.target; touched[el.id || el.tagName] = (touched[el.id || el.tagName] || 0) + 1; }));
  els.forEach((el) => mo.observe(el, { attributes: true, attributeFilter: ['style', 'class'] }));
  setTimeout(() => { mo.disconnect(); res({ mutations: n, touched }); }, ms);
}), { IDS, ms });

await page.evaluate(() => window.scrollTo(0, 0));
const idleMiniA = await rectsNow();
const mutMini = await watchMutations(4000);
const idleMiniB = await rectsNow();
put('idle_all_mini', { mutations: mutMini, drift: IDS.map((id) => ({ id, d: idleMiniA[id] && idleMiniB[id] ? idleMiniA[id].rect.map((v, i) => +(v - idleMiniB[id].rect[i]).toFixed(2)) : null })).filter((x) => x.d && x.d.some((v) => Math.abs(v) > 0.3)) });

// expand one card and watch idle
const clickId = async (id, wait = 1000) => {
  const p = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return { ok: false }; const er = el.getBoundingClientRect(); const cands = []; for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]); } cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]); for (const q of cands) { const e = document.elementFromPoint(q[0], q[1]); if (e && el.contains(e)) return { ok: true, at: q }; } return { ok: false }; }, id);
  if (!p.ok) return p; await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); await sleep(wait); return p;
};
await clickId('pp-toggles', 3000);
const idleExpA = await rectsNow();
const mutExp = await watchMutations(4000);
const idleExpB = await rectsNow();
put('idle_one_expanded', { mutations: mutExp, drift: IDS.map((id) => ({ id, d: idleExpA[id] && idleExpB[id] ? idleExpA[id].rect.map((v, i) => +(v - idleExpB[id].rect[i]).toFixed(2)) : null })).filter((x) => x.d && x.d.some((v) => Math.abs(v) > 0.3)) });
await page.screenshot({ path: path.join(OUT, 'D-idle-expanded.png') });
await clickId('pp-toggles', 2500);

/* ---------- Phase 3: rapid-tap determinism x5 ---------- */
const rapidTargets = ['data-panel', 'pp-toggles', 'scene-panel', 'cctv-panel', 'control-panel', 'data-panel', 'global-context-panel', 'pp-toggles', 'scene-panel', 'location-bar', 'control-panel', 'cctv-panel', 'data-panel', 'global-context-panel', 'pp-toggles', 'location-bar'];
const rapidRuns = [];
for (let iter = 0; iter < 5; iter++) {
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForSelector('#pp-toggles', { timeout: 120000 }); await sleep(9000);
  let taps = 0, misses = 0; const missIds = [];
  for (const id of rapidTargets) {
    const p = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return { ok: false }; const r = el.getBoundingClientRect(); const q = [Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(14, r.height / 2))]; const e = document.elementFromPoint(q[0], q[1]); return { ok: !!(e && el.contains(e)), at: q, owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : null }; }, id);
    if (!p.ok) { misses++; missIds.push({ id, owner: p.owner }); continue; }
    taps++; await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); await sleep(150);
  }
  await sleep(4000);
  const st = await page.evaluate((IDS) => {
    const o = {}; for (const id of IDS) { const el = document.getElementById(id); if (!el) continue; const c = getComputedStyle(el); if (c.display === 'none' || +c.opacity < 0.05) continue; const r = el.getBoundingClientRect(); o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], open: !el.classList.contains('collapsed') }; }
    const ids = Object.keys(o); const ov = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const a = o[ids[i]].rect, b = o[ids[j]].rect; const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]); const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]); if (ix > 0.5 && iy > 0.5) ov.push({ a: ids[i], b: ids[j], ix: +ix.toFixed(1), iy: +iy.toFixed(1) }); }
    return { ov, out: ids.filter((id) => !(o[id].rect[0] >= -1 && o[id].rect[1] >= -1 && o[id].rect[0] + o[id].rect[2] <= innerWidth + 1 && o[id].rect[1] + o[id].rect[3] <= innerHeight + 1)), expanded: ids.filter((id) => o[id].open), left: ids.filter((id) => ['data-panel', 'scene-panel'].includes(id) && o[id].open), right: ids.filter((id) => ['pp-toggles', 'cctv-panel', 'global-context-panel'].includes(id) && o[id].open) };
  }, IDS);
  rapidRuns.push({ iter, taps, misses, missIds, overlaps: st.ov, out: st.out, expanded: st.expanded, left: st.left, right: st.right });
  console.log('### rapid iter', iter, 'misses', misses, 'ov', st.ov.length, 'out', st.out.length, JSON.stringify(st.missIds || ''));
}
put('rapid_runs', rapidRuns);
put('rapid_summary', { overlapTotal: rapidRuns.reduce((a, r) => a + r.overlaps.length, 0), outTotal: rapidRuns.reduce((a, r) => a + r.out.length, 0), missTotal: rapidRuns.reduce((a, r) => a + r.misses, 0), tapsTotal: rapidRuns.reduce((a, r) => a + r.taps, 0) });
put('trust', await page.evaluate(() => window.__tr));
put('consoleErrors', R.consoleErrors || []);
fs.writeFileSync(path.join(OUT, 'D-status-idle.json'), JSON.stringify(R, null, 1));
console.log('WROTE D-status-idle.json');
await browser.close();
