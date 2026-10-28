#!/usr/bin/env node
/**
 * _rv3-e-gap.mjs — reviewer round-3 probe E: precise switch gap timing.
 * Measures, per group switch (old open -> new open), the ms between the last frame the
 * OLD card was open and the first frame the NEW card was open, plus how many frames the
 * group had zero open (i.e. real "先关旧再开新" gap) and whether 2 were ever open at once.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 2000)); };

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
  window.__rv = { down: 0, downT: 0, click: 0, clickT: 0 };
  for (const t of ['pointerdown', 'click']) document.addEventListener(t, (e) => { if (t === 'pointerdown') { window.__rv.down++; if (e.isTrusted) window.__rv.downT++; } else { window.__rv.click++; if (e.isTrusted) window.__rv.clickT++; } }, true);
  const st = (id) => { const el = document.getElementById(id); if (!el) return null; const c = getComputedStyle(el); return { open: !el.classList.contains('collapsed'), vis: c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05 }; };
  window.__trace = [];
  window.__go = () => { window.__trace = []; const tick = () => { const L = ['data-panel', 'scene-panel'].filter((i) => (st(i) || {}).open); const RR = ['pp-toggles', 'cctv-panel', 'global-context-panel'].filter((i) => (st(i) || {}).open);
      window.__trace.push({ t: performance.now(), L, R: RR, novis: [...['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel']].filter((i) => { const s = st(i); return s && !s.vis; }) });
      window.__raf = requestAnimationFrame(tick); }; tick(); };
  window.__stop = () => { cancelAnimationFrame(window.__raf); return window.__trace; };
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9000);

const clickOwned = async (cardId) => {
  const probe = await page.evaluate((cardId) => {
    const el = document.getElementById(cardId); if (!el) return { ok: false };
    const er = el.getBoundingClientRect();
    const pts = [{ x: Math.round(er.x + er.width / 2), y: Math.round(er.y + Math.min(12, er.height / 2)) }];
    for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) pts.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }); }
    for (const p of pts) { const e = document.elementFromPoint(p.x, p.y); if (e && el.contains(e)) return { ok: true, at: [p.x, p.y] }; }
    return { ok: false };
  }, cardId);
  if (!probe.ok) return { clicked: false };
  await page.mouse.move(probe.at[0], probe.at[1]);
  return { clicked: true, at: probe.at };
};

const groups = { left: ['data-panel', 'scene-panel'], right: ['pp-toggles', 'cctv-panel', 'global-context-panel'] };
const steps = [];
const doSwitch = async (from, to) => {
  const p = await clickOwned(to);
  await page.mouse.down(); await page.mouse.up();
  steps.push({ from, to, at: p.at });
  await sleep(700);
};

await page.evaluate(() => window.__go());
await doSwitch(null, 'data-panel');
await doSwitch('data-panel', 'scene-panel');
await doSwitch('scene-panel', 'data-panel');
await doSwitch(null, 'pp-toggles');
await doSwitch('pp-toggles', 'cctv-panel');
await doSwitch('cctv-panel', 'global-context-panel');
await doSwitch('global-context-panel', 'pp-toggles');
const trace = await page.evaluate(() => window.__stop());
put('pointer_trust', await page.evaluate(() => window.__rv));
put('trace_frames', trace.length);
put('max_simultaneous', { left: Math.max(...trace.map((f) => f.L.length)), right: Math.max(...trace.map((f) => f.R.length)) });
put('no_visibility_frames', trace.filter((f) => f.novis.length).length);

// per-step analysis using click timestamps as boundaries
const analysis = [];
for (let i = 0; i < steps.length; i++) {
  const st = steps[i];
  const groupKey = ['data-panel', 'scene-panel'].includes(st.to) ? 'L' : 'R';
  // window: from the frame right before the click to 400ms after
  const clickT = (trace.find((f) => f.t > 0) || {}).t; // placeholder, recomputed below
  analysis.push({ from: st.from, to: st.to, group: groupKey });
}
// find the transition frames: for each step boundary we detect the first frame where st.to is open
// simpler + robust: scan the trace and locate every change point per group
const changePoints = [];
for (let i = 1; i < trace.length; i++) {
  const prev = trace[i - 1], cur = trace[i];
  const key = (a) => a.join(',');
  if (key(prev.L) !== key(cur.L)) changePoints.push({ group: 'L', t0: prev.t, t1: cur.t, from: prev.L, to: cur.L });
  if (key(prev.R) !== key(cur.R)) changePoints.push({ group: 'R', t0: prev.t, t1: cur.t, from: prev.R, to: cur.R });
}
// empty windows per group: consecutive frames with zero open after at least one was open
const emptyWindows = { L: [], R: [] };
for (const g of ['L', 'R']) {
  let run = null;
  for (let i = 0; i < trace.length; i++) {
    const open = trace[i][g].length;
    if (open === 0 && i > 0 && trace[i - 1][g].length > 0) { run = { start: trace[i].t, frames: 1 }; continue; }
    if (run) { if (open === 0) run.frames++; else { run.end = trace[i].t; run.ms = +(run.end - run.start).toFixed(1); emptyWindows[g].push(run); run = null; } }
  }
  if (run) emptyWindows[g].push({ ...run, open_at_end: false, ms: null });
}
put('group_change_points_ms', changePoints.map((c) => ({ group: c.group, from: c.from.join('+') || '-', to: c.to.join('+') || '-', ms: +(c.t1 - c.t0).toFixed(1) })));
put('zero_open_windows', emptyWindows);
R.finished = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'E-gap.json'), JSON.stringify(R, null, 1));
console.log('WROTE', path.join(OUT, 'E-gap.json'));
await browser.close();
