#!/usr/bin/env node
/* _r5-loop.mjs — deterministic loop of 显示 -> 视觉预设 -> 上下文 with tunable click gap.
   usage: node scripts/_r5-loop.mjs <gapMs> <rounds> [keepDbg] */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const GAP = Number(process.argv[2] || 1200);
const ROUNDS = Number(process.argv[3] || 6);
const KEEP_DBG = process.argv[4] === 'dbg';
const OUT = path.resolve('.gev-logs/r5-t829');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    nat: st[id].nat ? [+st[id].nat.left.toFixed(1), +st[id].nat.top.toFixed(1), +st[id].nat.width.toFixed(1), +st[id].nat.height.toFixed(1)] : null } : null;
  return { o, ov, hits: { pp: hit('pp-toggles'), cctv: hit('cctv-panel'), global: hit('global-context-panel') },
    info: { pp: pick('pp-toggles'), cctv: pick('cctv-panel'), global: pick('global-context-panel'), control: pick('control-panel') }, tr: window.__tr };
});

const results = [];
for (let r = 1; r <= ROUNDS; r++) {
  dbg = [];
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#pp-toggles', { timeout: 120000 });
  await sleep(9500);
  const base = await measure();
  const clicks = [];
  for (const id of ['pp-toggles', 'control-panel', 'global-context-panel']) {
    clicks.push(await clickCard(id));
    await sleep(GAP);
  }
  await sleep(4200);
  const fin = await measure();
  const bad = fin.ov.filter((x) => x.area > 1);
  const badHits = Object.entries(fin.hits).filter(([, v]) => !v.own).map(([k]) => k);
  const row = { round: r, gap: GAP, clicks, baseOv: base.ov, ov: fin.ov, bad, badHits,
    o: fin.o, info: fin.info, tr: fin.tr };
  results.push(row);
  console.log('## round', r, 'bad=', JSON.stringify(bad), 'badHits=', JSON.stringify(badHits),
    'pp=', JSON.stringify(fin.o['pp-toggles']), 'cctv=', JSON.stringify(fin.o['cctv-panel']),
    'nat', JSON.stringify(fin.info.pp && fin.info.pp.nat), JSON.stringify(fin.info.cctv && fin.info.cctv.nat),
    'push', JSON.stringify(fin.info.pp && fin.info.pp.push), JSON.stringify(fin.info.cctv && fin.info.cctv.push));
  if (bad.length || badHits.length) {
    await page.screenshot({ path: path.join(OUT, `loop-fail-g${GAP}-r${r}.png`) });
    if (KEEP_DBG) fs.writeFileSync(path.join(OUT, `loop-fail-g${GAP}-r${r}-dbg.txt`), dbg.join('\n'));
  }
}
const fails = results.filter((x) => x.bad.length || x.badHits.length).length;
console.log('#### fails', fails, '/', ROUNDS, 'gap', GAP);
fs.writeFileSync(path.join(OUT, `loop-g${GAP}.json`), JSON.stringify(results, null, 2));
await browser.close();
