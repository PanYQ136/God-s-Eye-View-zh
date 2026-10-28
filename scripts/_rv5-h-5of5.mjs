#!/usr/bin/env node
/* _rv5-h-5of5.mjs — reviewer round-5 probe H: the round-4 minimum line, taken literally —
   5 clean-page rounds of the reviewer-reported 3-click sequence at human pace (1.2s/click),
   plus 5 rounds of the reversed order. Each round: 0 overlap, both right-rail headers own,
   terminal rects identical across rounds. */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r5');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 2500)); };
const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];

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
  window.__tr = { down: 0, downT: 0 };
  addEventListener('pointerdown', (e) => { window.__tr.down++; if (e.isTrusted) window.__tr.downT++; }, true);
});
page.on('pageerror', (e) => (R.consoleErrors = R.consoleErrors || []).push(String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });

const hitOf = (id) => page.evaluate((id) => {
  const el = document.getElementById(id); if (!el) return { ok: false };
  const er = el.getBoundingClientRect(); const cands = [];
  for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]); }
  cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]);
  for (const q of cands) { const e = document.elementFromPoint(q[0], q[1]); if (e && el.contains(e)) return { ok: true, at: q }; }
  return { ok: false };
}, id);
const geo = () => page.evaluate((IDS) => {
  const o = {};
  for (const id of IDS) { const el = document.getElementById(id); if (!el) continue; const c = getComputedStyle(el); if (c.display === 'none' || +c.opacity < 0.05) continue; const r = el.getBoundingClientRect(); o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], open: !el.classList.contains('collapsed') }; }
  const ids = Object.keys(o); const ov = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const a = o[ids[i]].rect, b = o[ids[j]].rect; const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]); const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]); if (ix > 0.5 && iy > 0.5) ov.push({ a: ids[i], b: ids[j], ix: +ix.toFixed(1), iy: +iy.toFixed(1) }); }
  return { o, ov };
}, IDS);

const seqs = [
  { name: 'pp->control->global', order: ['pp-toggles', 'control-panel', 'global-context-panel'] },
  { name: 'global->control->pp', order: ['global-context-panel', 'control-panel', 'pp-toggles'] },
];
const out = [];
for (const s of seqs) {
  for (let round = 1; round <= 5; round++) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#pp-toggles', { timeout: 120000 });
    await sleep(9000);
    for (const id of s.order) {
      const p = await hitOf(id);
      if (p.ok) { await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); }
      await sleep(1200);
    }
    await sleep(4200);
    const g = await geo();
    const own = {};
    for (const id of ['pp-toggles', 'cctv-panel', 'global-context-panel']) own[id] = (await hitOf(id)).ok;
    out.push({ seq: s.name, round, overlaps: g.ov, pp: g.o['pp-toggles'] && g.o['pp-toggles'].rect, cctv: g.o['cctv-panel'] && g.o['cctv-panel'].rect, global: g.o['global-context-panel'] && g.o['global-context-panel'].rect, ctrl: g.o['control-panel'] && g.o['control-panel'].rect, own, expanded: Object.keys(g.o).filter((k) => g.o[k].open) });
    console.log('###', s.name, round, 'ov', g.ov.length, 'own', JSON.stringify(own), 'pp', JSON.stringify(out[out.length - 1].pp), 'cctv', JSON.stringify(out[out.length - 1].cctv));
    await page.screenshot({ path: path.join(OUT, `H-${s.name.replace(/->/g, '_')}-r${round}.png`) });
  }
}
const uniq = (arr) => [...new Set(arr.map((x) => JSON.stringify(x)))];
put('five_of_five', {
  rounds: out.length,
  overlapTotal: out.reduce((a, r) => a + r.overlaps.length, 0),
  badRounds: out.filter((r) => r.overlaps.length || !Object.values(r.own).every(Boolean)).map((r) => ({ seq: r.seq, round: r.round, overlaps: r.overlaps, own: r.own })),
  distinct_pp_geometries: uniq(out.map((r) => r.pp)).length,
  distinct_cctv_geometries: uniq(out.map((r) => r.cctv)).length,
  per_seq_terminal: seqs.map((s) => ({ seq: s.name, pp: uniq(out.filter((r) => r.seq === s.name).map((r) => r.pp)), cctv: uniq(out.filter((r) => r.seq === s.name).map((r) => r.cctv)), ctrl: uniq(out.filter((r) => r.seq === s.name).map((r) => r.ctrl)) })),
});
put('trust', await page.evaluate(() => window.__tr));
put('consoleErrors', R.consoleErrors || []);
fs.writeFileSync(path.join(OUT, 'H-5of5.json'), JSON.stringify(R, null, 1));
console.log('WROTE H');
await browser.close();
