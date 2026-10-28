#!/usr/bin/env node
/* _r5-seq.mjs — repeat a real-mouse click sequence on a fresh page, N rounds, report overlaps.
   usage: node scripts/_r5-seq.mjs <id,id,...> <gapMs> <rounds> [dbg] */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const SEQ = (process.argv[2] || 'pp-toggles,control-panel,global-context-panel').split(',');
const GAP = Number(process.argv[3] || 1200);
const ROUNDS = Number(process.argv[4] || 5);
const KEEP_DBG = process.argv[5] === 'dbg';
const OUT = path.resolve('.gev-logs/r5-t829');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = `seq-${SEQ.map((s) => s.split('-')[0]).join('_')}-g${GAP}`;

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument((keep) => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
  if (keep) window.__gevcDebug = true;
  window.__tr = { down: 0, downT: 0 };
  addEventListener('pointerdown', (e) => { window.__tr.down++; if (e.isTrusted) window.__tr.downT++; }, true);
}, KEEP_DBG);
let dbg = [];
page.on('console', (m) => { const t = m.text(); if (t.includes('[gev-lc]')) dbg.push(t); });

const clickCard = async (id) => {
  const p = await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return { ok: false };
    const er = el.getBoundingClientRect();
    const q = [Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))];
    const e = document.elementFromPoint(q[0], q[1]);
    return { ok: !!(e && el.contains(e)), at: q, owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : (e ? e.tagName : null) };
  }, id);
  if (!p.ok) return p;
  await page.mouse.move(p.at[0], p.at[1]);
  await page.mouse.down();
  await page.mouse.up();
  return p;
};
const measure = () => page.evaluate(() => {
  const ids = ['pp-toggles', 'cctv-panel', 'global-context-panel', 'control-panel', 'data-panel', 'scene-panel', 'location-bar', 'gev-voice-control', 'gev-gfx-fab'];
  const st = window.__gevLc.state();
  const o = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const c = getComputedStyle(el);
    if (c.display === 'none' || +c.opacity < 0.05) continue;
    const r = el.getBoundingClientRect();
    o[id] = [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)];
  }
  const keys = Object.keys(o), ov = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = o[keys[i]], b = o[keys[j]];
    const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    if (ix > 0 && iy > 0) ov.push({ a: keys[i], b: keys[j], ix: +ix.toFixed(1), iy: +iy.toFixed(1), area: +(ix * iy).toFixed(0) });
  }
  const hit = (id) => {
    const el = document.getElementById(id);
    const r = el.getBoundingClientRect();
    const q = [Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(14, r.height / 2))];
    const e = document.elementFromPoint(q[0], q[1]);
    return { at: q, own: !!(e && el.contains(e)), owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : (e ? e.tagName : null) };
  };
  const pick = (id) => st[id] ? { collapsed: st[id].collapsed, floating: st[id].floating, push: st[id].push,
    nat: st[id].nat ? [+st[id].nat.left.toFixed(1), +st[id].nat.top.toFixed(1)] : null } : null;
  const info = {};
  for (const id of ['pp-toggles', 'cctv-panel', 'global-context-panel', 'control-panel', 'data-panel', 'scene-panel']) info[id] = pick(id);
  const expanded = Object.keys(info).filter((k) => info[k] && info[k].floating && !info[k].collapsed);
  return { o, ov, expanded, info, tr: window.__tr,
    hits: { pp: hit('pp-toggles'), cctv: hit('cctv-panel'), global: hit('global-context-panel'),
      data: hit('data-panel'), scene: hit('scene-panel'), control: hit('control-panel') } };
});

const results = [];
for (let r = 1; r <= ROUNDS; r++) {
  dbg = [];
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#pp-toggles', { timeout: 120000 });
  await sleep(9500);
  const clicks = [];
  for (const id of SEQ) {
    clicks.push(await clickCard(id));
    await sleep(GAP);
  }
  await sleep(4200);
  const fin = await measure();
  const bad = fin.ov.filter((x) => x.area > 1);
  const miniIds = ['pp-toggles', 'cctv-panel', 'global-context-panel', 'data-panel', 'scene-panel'];
  const keyOf = { 'pp-toggles': 'pp', 'cctv-panel': 'cctv', 'global-context-panel': 'global', 'data-panel': 'data', 'scene-panel': 'scene' };
  const closedMini = miniIds.filter((id) => fin.info[id] && !fin.info[id].floating && fin.info[id].collapsed);
  const badHits = closedMini.filter((id) => !fin.hits[keyOf[id]].own);
  const row = { round: r, seq: SEQ, gap: GAP, clicks, ov: fin.ov, bad, badHits, expanded: fin.expanded, o: fin.o, info: fin.info, tr: fin.tr };
  results.push(row);
  console.log('## round', r, 'expanded=', JSON.stringify(fin.expanded), 'bad=', JSON.stringify(bad),
    'badHits=', JSON.stringify(badHits));
  if (bad.length || badHits.length) {
    await page.screenshot({ path: path.join(OUT, `${tag}-fail-r${r}.png`) });
    if (KEEP_DBG) fs.writeFileSync(path.join(OUT, `${tag}-fail-r${r}-dbg.txt`), dbg.join('\n'));
  }
}
const fails = results.filter((x) => x.bad.length || x.badHits.length).length;
console.log('#### fails', fails, '/', ROUNDS, 'seq', SEQ.join('>'), 'gap', GAP);
fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify(results, null, 2));
await browser.close();
