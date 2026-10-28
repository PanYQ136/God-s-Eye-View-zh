#!/usr/bin/env node
/* _rv4-h-proof.mjs — reviewer round-4 probe H: human-cadence (2.5s between clicks) proof of the
   pp/cctv mini-card overlap after 显示 -> 视觉预设 -> 上下文, plus the occluded-header real click. */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r4');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { runs: [] };
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
  window.__tr = { down: 0, downT: 0, click: 0, clickT: 0 };
  addEventListener('pointerdown', (e) => { window.__tr.down++; if (e.isTrusted) window.__tr.downT++; }, true);
  addEventListener('click', (e) => { window.__tr.click++; if (e.isTrusted) window.__tr.clickT++; }, true);
});
const load = async () => { await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 }); await page.waitForSelector('#pp-toggles', { timeout: 120000 }); await sleep(9500); };
const clickReal = async (id, wait = 2500) => {
  const p = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return { ok: false };
    const er = el.getBoundingClientRect(); const cands = [];
    for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]); }
    cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]);
    for (const q of cands) { const e = document.elementFromPoint(q[0], q[1]); if (e && el.contains(e)) return { ok: true, at: q }; }
    return { ok: false }; }, id);
  if (!p.ok) return { ...p, id };
  await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up();
  await sleep(wait); return { ...p, id };
};
const snap = () => page.evaluate(() => {
  const ids = ['pp-toggles', 'cctv-panel', 'global-context-panel', 'control-panel'];
  const o = {}, op = {};
  for (const id of ids) { const el = document.getElementById(id); const r = el.getBoundingClientRect(); o[id] = [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)]; op[id] = !el.classList.contains('collapsed'); }
  const ov = []; const k = Object.keys(o);
  for (let i = 0; i < k.length; i++) for (let j = i + 1; j < k.length; j++) { const a = o[k[i]], b = o[k[j]]; const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]); const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]); if (ix > 0 && iy > 0) ov.push({ a: k[i], b: k[j], ix: +ix.toFixed(1), iy: +iy.toFixed(1), area: Math.round(ix * iy) }); }
  const cctv = document.getElementById('cctv-panel').getBoundingClientRect();
  const q = [Math.round(cctv.x + cctv.width / 2), Math.round(cctv.y + 14)];
  const e = document.elementFromPoint(q[0], q[1]);
  return { o, op, ov, cctvHeaderPoint: q, cctvHeaderOwner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : (e ? e.tagName : null), expanded: k.filter((x) => op[x]) };
});
for (let k = 0; k < 3; k++) {
  await load();
  const steps = [];
  for (const id of ['pp-toggles', 'control-panel', 'global-context-panel']) steps.push(await clickReal(id, 2500));
  await sleep(3000);
  const s = await snap();
  // real click at the cctv header point (occluded?) — what opens?
  await page.mouse.move(s.cctvHeaderPoint[0], s.cctvHeaderPoint[1]); await page.mouse.down(); await page.mouse.up(); await sleep(1500);
  const after = await snap();
  const rec = { run: k, steps, state: s, cctvHeaderClickResult: { expandedAfter: after.expanded, ppOpen: after.op['pp-toggles'], cctvOpen: after.op['cctv-panel'] } };
  R.runs.push(rec);
  console.log('## run', k, 'ov', JSON.stringify(s.ov), 'pp', JSON.stringify(s.o['pp-toggles']), 'cctv', JSON.stringify(s.o['cctv-panel']), 'cctvHeaderOwner', s.cctvHeaderOwner, 'afterClick', JSON.stringify(rec.cctvHeaderClickResult));
  if (k === 0) await page.screenshot({ path: path.join(OUT, 'H-overlap-proof.png') });
}
R.trust = await page.evaluate(() => window.__tr);
R.overlapRate = `${R.runs.filter((r) => r.state.ov.length).length}/${R.runs.length}`;
console.log('## overlapRate', R.overlapRate, 'trust', JSON.stringify(R.trust));
fs.writeFileSync(path.join(OUT, 'H-proof.json'), JSON.stringify(R, null, 1));
await browser.close();
