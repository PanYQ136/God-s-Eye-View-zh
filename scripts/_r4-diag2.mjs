#!/usr/bin/env node
/**
 * _r4-diag2.mjs — rapid 连点后的「终态确定性」：16 击（40ms）后每 1s 采样 10 次，
 * 看 pp-toggles 是否停在 300×82 这类中间态；并检查所有 header 是否可点、是否有重叠。
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/r4-t829');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9500);

const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const FOLD = CARDS.slice(0, 7);
const snap = () => page.evaluate((IDS) => {
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    o[id] = { r: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], col: el.classList.contains('collapsed'), vis: c.display !== 'none' && +c.opacity > 0.05 };
  }
  const ov = (a, b) => Math.round(Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])));
  const ids = Object.keys(o).filter((k) => o[k].vis);
  const overlaps = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const area = ov(o[ids[i]].r, o[ids[j]].r); if (area > 0) overlaps.push({ a: ids[i], b: ids[j], area }); }
  const hits = {};
  for (const id of IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4) continue;
    const e = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(12, r.height / 2)));
    hits[id] = !!(e && el.contains(e));
  }
  return { o, overlaps, hits };
}, CARDS);
const probe = async (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const er = el.getBoundingClientRect();
  const pts = [];
  for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header, .dock-tray-toggle')) {
    const r = h.getBoundingClientRect();
    if (r.width > 4 && r.height > 4) pts.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
  }
  pts.push({ x: Math.round(er.x + er.width / 2), y: Math.round(er.y + Math.min(14, er.height / 2)) });
  for (const p of pts) { const e = document.elementFromPoint(p.x, p.y); if (e && el.contains(e)) return { ok: true, at: [p.x, p.y] }; }
  return { ok: false };
}, id);
const click = async (id, wait) => {
  const p = await probe(id);
  if (!p.ok) return false;
  await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up();
  if (wait) await sleep(wait);
  return true;
};

for (let run = 0; run < 2; run++) {
  const taps = [];
  for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control']) {
    taps.push({ id, ok: await click(id, 40) });
  }
  const samples = [];
  for (let i = 1; i <= 10; i++) {
    await sleep(1000);
    const s = await snap();
    samples.push({ t: i, rects: Object.fromEntries(Object.entries(s.o).map(([k, v]) => [k, v.r])), cols: Object.fromEntries(Object.entries(s.o).map(([k, v]) => [k, v.col])), overlaps: s.overlaps, badHits: Object.entries(s.hits).filter(([, v]) => !v).map(([k]) => k) });
  }
  const sig = (x) => JSON.stringify(x.rects) + JSON.stringify(x.cols);
  const stableFrom = (() => { for (let i = 0; i < samples.length; i++) if (samples.slice(i).every((x) => sig(x) === sig(samples[i]))) return samples[i].t; return null; })();
  console.log('## run', run, JSON.stringify({ missed: taps.filter((t) => !t.ok).map((t) => t.id), stableFromSec: stableFrom, last: { rects: samples[9].rects, cols: samples[9].cols, overlaps: samples[9].overlaps, badHits: samples[9].badHits }, t1: { rects: samples[0].rects, overlaps: samples[0].overlaps } }));
  fs.writeFileSync(path.join(OUT, `diag2-run${run}.json`), JSON.stringify({ taps, samples }, null, 1));
  await page.screenshot({ path: path.join(OUT, `DIAG2-run${run}.png`) });
}
await browser.close();
console.log('WROTE diag2');
