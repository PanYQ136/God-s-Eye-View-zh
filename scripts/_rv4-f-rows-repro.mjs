#!/usr/bin/env node
/* _rv4-f-rows-repro.mjs — reviewer round-4 probe F:
   (1) identify the pp scroll container's direct children that my C probe flagged as 6x6 overlaps;
   (2) trusted wheel evidence for pp scrolling;
   (3) deterministic loop of the reachable 3-card state (dock + right-rail, pp collapsed)
       to test whether the pp/cctv mini overlap reproduces on a fresh page each round. */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r4');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 2600)); };

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
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
const load = async () => {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#pp-toggles', { timeout: 120000 });
  await sleep(9500);
};
const clickCard = async (id, wait = 1000) => {
  const p = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return { ok: false };
    const er = el.getBoundingClientRect(); const cands = [];
    for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]); }
    cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]);
    for (const q of cands) { const e = document.elementFromPoint(q[0], q[1]); if (e && el.contains(e)) return { ok: true, at: q }; }
    return { ok: false, at: cands[cands.length - 1] }; }, id);
  if (!p.ok) return p;
  await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up();
  await sleep(wait); return p;
};
const rail = () => page.evaluate(() => {
  const ids = ['pp-toggles', 'cctv-panel', 'global-context-panel', 'control-panel', 'data-panel', 'scene-panel', 'location-bar', 'gev-voice-control', 'gev-gfx-fab'];
  const o = {}, op = {};
  for (const id of ids) { const el = document.getElementById(id); if (!el) continue; const c = getComputedStyle(el); if (c.display === 'none' || +c.opacity < 0.05) continue; const r = el.getBoundingClientRect(); o[id] = [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)]; op[id] = !el.classList.contains('collapsed'); }
  const keys = Object.keys(o); const ov = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) { const a = o[keys[i]], b = o[keys[j]]; const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]); const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]); if (ix > 0 && iy > 0) ov.push({ a: keys[i], b: keys[j], ix: +ix.toFixed(1), iy: +iy.toFixed(1) }); }
  const hit = (id) => { const el = document.getElementById(id); if (!el) return null; const r = el.getBoundingClientRect(); const q = [Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(14, r.height / 2))]; const e = document.elementFromPoint(q[0], q[1]); return { own: !!(e && el.contains(e)), owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : (e ? e.tagName : null) }; };
  return { o, op, ov, hits: { pp: hit('pp-toggles'), cctv: hit('cctv-panel'), global: hit('global-context-panel') }, expanded: keys.filter((k) => op[k]) };
});

// ---------- part 1: pp rows detail ----------
await load();
await clickCard('pp-toggles', 1600);
put('pp_rows', await page.evaluate(() => {
  const card = document.getElementById('pp-toggles');
  const sc = [...card.querySelectorAll('*')].filter((n) => { const c = getComputedStyle(n); return /(auto|scroll)/.test(c.overflowY) && n.scrollHeight > n.clientHeight + 4; }).sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || card;
  const kids = [...sc.children].map((n, i) => { const r = n.getBoundingClientRect(); const c = getComputedStyle(n); return { i, tag: n.tagName, cls: (n.className || '').toString().slice(0, 60), rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], pos: c.position, disp: c.display, op: c.opacity, vis: c.visibility, txt: (n.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30) }; });
  let minGap = 999; const gaps = [];
  const flow = kids.filter((k) => k.disp !== 'none' && +k.op > 0.05 && k.pos !== 'absolute' && k.pos !== 'fixed');
  for (let i = 1; i < flow.length; i++) { const g = +(flow[i].rect[1] - (flow[i - 1].rect[1] + flow[i - 1].rect[3])).toFixed(1); gaps.push({ from: flow[i - 1].i, to: flow[i].i, gap: g }); minGap = Math.min(minGap, g); }
  return { scSel: sc.tagName + '#' + sc.id + '.' + (sc.className || '').toString().slice(0, 50), scroll: { top: sc.scrollTop, h: sc.scrollHeight, ch: sc.clientHeight }, kids, flowGaps: gaps, minGap, flowCount: flow.length };
}));
const wh = await page.evaluate(() => { const el = document.getElementById('pp-toggles'); const r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height * 0.6)]; });
const path1 = [];
for (let i = 0; i < 4; i++) { await page.mouse.move(wh[0], wh[1]); await page.mouse.wheel({ deltaY: 120 }); await sleep(300);
  path1.push(await page.evaluate(() => { const card = document.getElementById('pp-toggles'); const sc = [...card.querySelectorAll('*')].filter((n) => { const c = getComputedStyle(n); return /(auto|scroll)/.test(c.overflowY) && n.scrollHeight > n.clientHeight + 4; }).sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || card; return +sc.scrollTop.toFixed(1); })); }
put('pp_wheel', { path: path1, trust: await page.evaluate(() => window.__tr) });
await page.screenshot({ path: path.join(OUT, 'F-pp-scrolled.png') });

// ---------- part 2: 3-card state repro loop ----------
const SEQ = [
  ['pp-toggles', 'control-panel', 'global-context-panel'],
  ['control-panel', 'pp-toggles', 'global-context-panel'],
  ['pp-toggles', 'global-context-panel', 'control-panel'],
];
const runs = [];
for (let k = 0; k < 3; k++) {
  for (const seq of SEQ) {
    await load();
    for (const id of seq) await clickCard(id, 1200);
    await sleep(3500);
    const s = await rail();
    runs.push({ seq: seq.join('>'), ov: s.ov, rects: { pp: s.o['pp-toggles'], cctv: s.o['cctv-panel'], global: s.o['global-context-panel'], control: s.o['control-panel'] }, hits: s.hits, expanded: s.expanded });
    console.log('## run', k, seq.join('>'), 'ov', JSON.stringify(s.ov), 'hits', JSON.stringify(s.hits));
    if (k === 0 && seq[0] === 'pp-toggles') await page.screenshot({ path: path.join(OUT, 'F-3card-' + seq.join('_') + '.png') });
  }
}
put('three_card_runs', runs);
put('three_card_overlap_runs', runs.filter((r) => r.ov.length).map((r) => ({ seq: r.seq, ov: r.ov, rects: r.rects, hits: r.hits })));
put('three_card_overlap_rate', `${runs.filter((r) => r.ov.length).length}/${runs.length}`);
put('trust_total', await page.evaluate(() => window.__tr));
fs.writeFileSync(path.join(OUT, 'F-rows-repro.json'), JSON.stringify(R, null, 1));
console.log('WROTE F-rows-repro.json');
await browser.close();
