#!/usr/bin/env node
/* _r5-rapid.mjs — 16 rapid real taps (150ms, no settle wait), N rounds, report missed/overlap.
   usage: node scripts/_r5-rapid.mjs <rounds> <gapMs> [railNormOff] */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const ROUNDS = Number(process.argv[2] || 4);
const GAP = Number(process.argv[3] || 150);
const RN_OFF = process.argv[4] === 'off';
const OFF = path.resolve('.gev-logs/r5-t829/rapid');
fs.mkdirSync(OFF, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ORDER = ['data-panel', 'pp-toggles', 'scene-panel', 'cctv-panel', 'data-panel', 'global-context-panel', 'location-bar', 'control-panel', 'pp-toggles', 'scene-panel', 'cctv-panel', 'data-panel', 'global-context-panel', 'control-panel', 'location-bar', 'pp-toggles'];

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument((off) => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
  window.__gevRailNormOff = !!off;
  window.__tr = { down: 0, downT: 0 };
  addEventListener('pointerdown', (e) => { window.__tr.down++; if (e.isTrusted) window.__tr.downT++; }, true);
}, RN_OFF);
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9500);

const state = () => page.evaluate(() => window.__gevLc.state());
const rects = () => page.evaluate(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
  const o = {};
  ids.forEach((id) => { const el = document.getElementById(id); if (!el) return; const c = getComputedStyle(el); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.05) return; const r = el.getBoundingClientRect(); o[id] = [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)]; });
  return o;
});
const overlaps = (o) => {
  const keys = Object.keys(o), out = [];
  for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
    const a = o[keys[i]], b = o[keys[j]];
    const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    if (ix > 0.5 && iy > 0.5) out.push({ a: keys[i], b: keys[j], ix: +ix.toFixed(1), iy: +iy.toFixed(1) });
  }
  return out;
};
const resetAll = async () => {
  for (let g = 0; g < 4; g++) {
    const st = await state();
    const open = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'].filter((id) => st[id] && (!st[id].collapsed || st[id].floating));
    if (!open.length) break;
    for (const id of open) {
      const p = await page.evaluate((id) => { const el = document.getElementById(id); const r = el.getBoundingClientRect(); const q = [Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(14, r.height / 2))]; const e = document.elementFromPoint(q[0], q[1]); return { ok: !!(e && el.contains(e)), at: q }; }, id);
      if (p.ok) { await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); }
      await sleep(350);
    }
    await sleep(900);
  }
};

const out = [];
for (let r = 1; r <= ROUNDS; r++) {
  await resetAll();
  await sleep(1200);
  const missed = [];
  for (const id of ORDER) {
    const p = await page.evaluate((id) => {
      const el = document.getElementById(id);
      const r2 = el.getBoundingClientRect();
      const q = [Math.round(r2.x + r2.width / 2), Math.round(r2.y + Math.min(14, r2.height / 2))];
      const e = document.elementFromPoint(q[0], q[1]);
      return { ok: !!(e && el.contains(e)), at: q, owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : (e ? e.tagName + '.' + (e.className || '').toString().slice(0, 24) : null) };
    }, id);
    if (!p.ok) { missed.push({ id, at: p.at, owner: p.owner }); }
    else { await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); }
    await sleep(GAP);
  }
  await sleep(5000);
  const st = await state();
  const rr = await rects();
  const ov = overlaps(rr);
  const end = Object.entries(st).filter(([, v]) => !v.collapsed && v.floating).map(([k]) => k);
  out.push({ round: r, missed, ov, end, rects: rr });
  console.log('## round', r, 'missed=', JSON.stringify(missed), 'ov=', JSON.stringify(ov), 'end=', JSON.stringify(end));
  if (missed.length || ov.length) await page.screenshot({ path: path.join(OFF, `rapid-${RN_OFF ? 'off' : 'on'}-r${r}.png`) });
}
const tot = out.reduce((s, o) => s + o.missed.length, 0);
console.log('#### railNorm', RN_OFF ? 'OFF' : 'ON', 'rounds', ROUNDS, 'gap', GAP, 'totalMissed', tot, 'roundsWithMiss', out.filter((o) => o.missed.length).length);
fs.writeFileSync(path.join(OFF, `rapid-${RN_OFF ? 'off' : 'on'}-g${GAP}.json`), JSON.stringify(out, null, 2));
await browser.close();
