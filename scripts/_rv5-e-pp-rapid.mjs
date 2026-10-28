#!/usr/bin/env node
/* _rv5-e-pp-rapid.mjs — reviewer round-5 probe E.
   Phase 1: pp expanded layout (contract item 4): row count, min row gap, text overlaps,
            real wheel scroll, button fill / dark text, clipping.
   Phase 2: rapid-tap A/B — round-5 normalizeRail channel ON vs OFF, 5 iterations each,
            150ms pacing, to decide whether the observed misses are the new channel's fault. */
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

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument((flagOff) => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
  if (flagOff) window.__gevRailNormOff = true;
  window.__tr = { down: 0, downT: 0, click: 0, clickT: 0, wheel: 0, wheelT: 0 };
  addEventListener('pointerdown', (e) => { window.__tr.down++; if (e.isTrusted) window.__tr.downT++; }, true);
  addEventListener('click', (e) => { window.__tr.click++; if (e.isTrusted) window.__tr.clickT++; }, true);
  addEventListener('wheel', (e) => { window.__tr.wheel++; if (e.isTrusted) window.__tr.wheelT++; }, { capture: true, passive: true });
}, process.env.RAIL_OFF === '1');
page.on('pageerror', (e) => (R.consoleErrors = R.consoleErrors || []).push(String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(10000);

const clickId = async (id, wait = 1000) => {
  const p = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return { ok: false }; const er = el.getBoundingClientRect(); const cands = []; for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]); } cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]); for (const q of cands) { const e = document.elementFromPoint(q[0], q[1]); if (e && el.contains(e)) return { ok: true, at: q }; } return { ok: false }; }, id);
  if (!p.ok) return p; await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); await sleep(wait); return p;
};

/* ---------- Phase 1: pp layout ---------- */
await clickId('pp-toggles', 3500);
const PPDETAIL = () => {
  const card = document.getElementById('pp-toggles');
  const alpha = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return 0; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
  const scrollers = [...card.querySelectorAll('*')].filter((n) => { const c = getComputedStyle(n); return /(auto|scroll)/.test(c.overflowY) && n.scrollHeight > n.clientHeight + 4; }).sort((a, b) => b.scrollHeight - a.scrollHeight);
  const sc = scrollers[0] || card;
  const kids = [...sc.children].filter((n) => { const c = getComputedStyle(n); const r = n.getBoundingClientRect(); return r.height > 4 && c.display !== 'none' && +c.opacity > 0.05 && c.position !== 'sticky' && c.position !== 'fixed'; });
  const rr = kids.map((n) => { const r = n.getBoundingClientRect(); return { y: +r.y.toFixed(1), b: +r.bottom.toFixed(1), x: +r.x.toFixed(1), h: +r.height.toFixed(1), sel: n.tagName + '.' + ((n.className && n.className.toString().split(' ')[0]) || '') }; });
  let minGap = 999; const overlaps = [];
  const sorted = rr.slice().sort((a, b) => a.y - b.y);
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
    const a = sorted[i], b = sorted[j];
    if (b.y < a.b) { overlaps.push({ a: a.sel, b: b.sel, iy: +(a.b - b.y).toFixed(1) }); continue; }
    minGap = Math.min(minGap, +(b.y - a.b).toFixed(1));
  }
  // text overlaps
  const tw = [...card.querySelectorAll('*')].filter((n) => n.children.length === 0 && n.textContent.trim() && n.getBoundingClientRect().height > 6).map((n) => { const r = n.getBoundingClientRect(); return { t: n.textContent.trim().slice(0, 18), r }; });
  const textOverlaps = [];
  for (let i = 0; i < tw.length; i++) for (let j = i + 1; j < tw.length; j++) {
    const a = tw[i].r, b = tw[j].r;
    const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ix > 1 && iy > 1) textOverlaps.push({ a: tw[i].t, b: tw[j].t, ix: +ix.toFixed(1), iy: +iy.toFixed(1) });
  }
  const btns = [...card.querySelectorAll('button, [role="button"], .pp-row, .pp-opt, .pp-toggle')].map((b) => { const c = getComputedStyle(b); const r = b.getBoundingClientRect(); const m = /rgb\((\d+), (\d+), (\d+)/.exec(c.color) || /rgba\((\d+), (\d+), (\d+)/.exec(c.color); const lum = m ? Math.max(+m[1], +m[2], +m[3]) : 255; return { bg: c.backgroundColor, a: alpha(c.backgroundColor), color: c.color, darkText: lum < 90, w: Math.round(r.width), h: Math.round(r.height) }; });
  const clipped = kids.filter((n) => { const r = n.getBoundingClientRect(); const cr = sc.getBoundingClientRect(); return r.right > cr.right + 1 || r.left < cr.left - 1; }).map((n) => n.tagName + '.' + ((n.className && n.className.toString().split(' ')[0]) || ''));
  return { rect: (() => { const r = card.getBoundingClientRect(); return [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)]; })(), scroll: { top: sc.scrollTop, h: sc.scrollHeight, ch: sc.clientHeight, tag: sc.tagName + '.' + ((sc.className && sc.className.toString().split(' ')[0]) || '') }, rows: rr.length, minGap, overlaps, textOverlaps, btns: btns.length, solidBtns: btns.filter((b) => b.a > 0.15), darkTextBtns: btns.filter((b) => b.darkText).length, clipped, rowsDetail: sorted };
};
const pp1 = await page.evaluate(PPDETAIL);
const wheelPath = [];
for (let i = 0; i < 4; i++) {
  const box = await page.evaluate(() => { const el = document.getElementById('pp-toggles'); const r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height * 0.62)]; });
  await page.mouse.move(box[0], box[1]);
  await page.mouse.wheel({ deltaY: 120 });
  await sleep(340);
  wheelPath.push(await page.evaluate(() => { const card = document.getElementById('pp-toggles'); const sc = [...card.querySelectorAll('*')].filter((n) => { const c = getComputedStyle(n); return /(auto|scroll)/.test(c.overflowY) && n.scrollHeight > n.clientHeight + 4; }).sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || card; return +sc.scrollTop.toFixed(1); }));
}
await page.screenshot({ path: path.join(OUT, 'E-pp-scrolled.png') });
put('pp', { ...pp1, wheelPath });
put('pp_ok', { minGap_ge_8: pp1.minGap >= 7.5, rows: pp1.rows, textOverlaps: pp1.textOverlaps.length, solidBtns: pp1.solidBtns.length, darkTextBtns: pp1.darkTextBtns, clipped: pp1.clipped.length, scrolled: wheelPath[wheelPath.length - 1] > 100 });
await clickId('pp-toggles', 2000);

/* ---------- Phase 2: rapid taps (channel ON or OFF per env) ---------- */
const rapidTargets = ['data-panel', 'pp-toggles', 'scene-panel', 'cctv-panel', 'control-panel', 'data-panel', 'global-context-panel', 'pp-toggles', 'scene-panel', 'location-bar', 'control-panel', 'cctv-panel', 'data-panel', 'global-context-panel', 'pp-toggles', 'location-bar'];
const runs = [];
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
    return { ov, out: ids.filter((id) => !(o[id].rect[0] >= -1 && o[id].rect[1] >= -1 && o[id].rect[0] + o[id].rect[2] <= innerWidth + 1 && o[id].rect[1] + o[id].rect[3] <= innerHeight + 1)), left: ids.filter((id) => ['data-panel', 'scene-panel'].includes(id) && o[id].open), right: ids.filter((id) => ['pp-toggles', 'cctv-panel', 'global-context-panel'].includes(id) && o[id].open) };
  }, IDS);
  runs.push({ iter, taps, misses, missIds, overlaps: st.ov, out: st.out, left: st.left, right: st.right });
  console.log('### rapid', process.env.RAIL_OFF === '1' ? 'OFF' : 'ON', iter, 'miss', misses, 'ov', st.ov.length, 'out', st.out.length);
}
put('rapid', { railNormOff: process.env.RAIL_OFF === '1', runs, missTotal: runs.reduce((a, r) => a + r.misses, 0), attempts: runs.reduce((a, r) => a + r.taps + r.misses, 0), overlapTotal: runs.reduce((a, r) => a + r.overlaps.length, 0), outTotal: runs.reduce((a, r) => a + r.out.length, 0) });
put('trust', await page.evaluate(() => window.__tr));
put('consoleErrors', R.consoleErrors || []);
fs.writeFileSync(path.join(OUT, process.env.RAIL_OFF === '1' ? 'E-pp-rapid-off.json' : 'E-pp-rapid-on.json'), JSON.stringify(R, null, 1));
console.log('WROTE E');
await browser.close();
