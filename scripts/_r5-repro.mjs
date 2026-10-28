#!/usr/bin/env node
/* _r5-repro.mjs — reproduce reviewer round-4 blocker:
   显示(pp-toggles) -> 视觉预设(control-panel) -> 上下文(global-context-panel)
   期望终态: right rail mini cards (pp/cctv) 不重叠, 各自 header own=true */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/r5-t829');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { dbg: [] };
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 4000)); };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
  window.__gevcDebug = true;
  window.__tr = { down: 0, downT: 0, click: 0, clickT: 0 };
  addEventListener('pointerdown', (e) => { window.__tr.down++; if (e.isTrusted) window.__tr.downT++; }, true);
  addEventListener('click', (e) => { window.__tr.click++; if (e.isTrusted) window.__tr.clickT++; }, true);
});
page.on('console', (m) => { const t = m.text(); if (t.includes('[gev-lc]')) R.dbg.push(t); });

const load = async () => {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#pp-toggles', { timeout: 120000 });
  await sleep(9500);
};
const clickCard = async (id, wait = 1500) => {
  const p = await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return { ok: false };
    const er = el.getBoundingClientRect();
    const cands = [];
    for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) {
      const r = h.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]);
    }
    cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]);
    for (const q of cands) {
      const e = document.elementFromPoint(q[0], q[1]);
      if (e && el.contains(e)) return { ok: true, at: q };
    }
    return { ok: false, at: cands[cands.length - 1] };
  }, id);
  if (!p.ok) return p;
  await page.mouse.move(p.at[0], p.at[1]);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(wait);
  return p;
};
const rail = () => page.evaluate(() => {
  const ids = ['pp-toggles', 'cctv-panel', 'global-context-panel', 'control-panel', 'data-panel', 'scene-panel', 'location-bar', 'gev-voice-control', 'gev-gfx-fab'];
  const o = {}, info = {};
  const st = window.__gevLc.state();
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const c = getComputedStyle(el);
    if (c.display === 'none' || +c.opacity < 0.05) continue;
    const r = el.getBoundingClientRect();
    o[id] = [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)];
    info[id] = { collapsed: st[id] && st[id].collapsed, floating: st[id] && st[id].floating, push: st[id] && st[id].push,
      nat: st[id] && st[id].nat ? [+st[id].nat.left.toFixed(1), +st[id].nat.top.toFixed(1), +st[id].nat.width.toFixed(1), +st[id].nat.height.toFixed(1)] : null };
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
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const q = [Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(14, r.height / 2))];
    const e = document.elementFromPoint(q[0], q[1]);
    return { at: q, own: !!(e && el.contains(e)), owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : (e ? e.tagName + '.' + (e.className || '') : null) };
  };
  return { o, info, ov, hits: { pp: hit('pp-toggles'), cctv: hit('cctv-panel'), global: hit('global-context-panel') }, tr: window.__tr };
});

await load();
put('initial', await rail());

const seq = process.argv[2] || 'pp,control,global';
const steps = [];
for (const id of seq.split(',')) {
  const c = await clickCard(id, 1600);
  steps.push({ id, click: c, state: await rail() });
}
await sleep(2500);
put('steps', steps);
put('final', await rail());
put('dbg', R.dbg.slice(-160));
await page.screenshot({ path: path.join(OUT, `repro-${seq.replace(/,/g, '-')}.png`) });
put('viewport', { W, H });
fs.writeFileSync(path.join(OUT, `repro-${seq.replace(/,/g, '-')}.json`), JSON.stringify(R, null, 2));
await browser.close();
