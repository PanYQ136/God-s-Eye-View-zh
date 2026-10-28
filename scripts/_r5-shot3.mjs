#!/usr/bin/env node
/* _r5-shot3.mjs — screenshot + state of the settled 3-click state (显示 → 视觉预设 → 上下文) */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('.gev-logs/r5-t829/accept');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'], protocolTimeout: 600000 });
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9500);
const pointFor = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const er = el.getBoundingClientRect();
  const cands = [];
  el.querySelectorAll('.panel-header,.dock-tray-toggle,.pp-header-row,.location-toolbar-toggle,.panel-divider,.panel-title,.pp-header-label,.location-toolbar-label,.dock-title').forEach((h) => {
    const r = h.getBoundingClientRect();
    if (r.width > 20 && r.height > 8 && r.left >= er.left - 1 && r.right <= er.right + 1 && r.top >= er.top - 1 && r.bottom <= er.bottom + 1) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]);
  });
  cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]);
  for (const q of cands) { const e = document.elementFromPoint(q[0], q[1]); if (e && el.contains(e)) return { ok: true, at: q }; }
  return { ok: false, at: cands[cands.length - 1] };
}, id);
const click = async (id, wait) => { const p = await pointFor(id); await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); await sleep(wait); return p; };
await click('pp-toggles', 1200);
await click('control-panel', 1200);
await click('global-context-panel', 1200);
await sleep(4000);
const dump = await page.evaluate(() => {
  const ids = ['pp-toggles', 'cctv-panel', 'global-context-panel', 'control-panel'];
  const o = {};
  ids.forEach((id) => { const el = document.getElementById(id); const r = el.getBoundingClientRect(); o[id] = [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)]; });
  const hits = {};
  ['pp-toggles', 'cctv-panel'].forEach((id) => { const el = document.getElementById(id); const r = el.getBoundingClientRect(); const q = [Math.round(r.x + r.width / 2), Math.round(r.y + 14)]; const e = document.elementFromPoint(q[0], q[1]); hits[id] = { at: q, own: !!(e && el.contains(e)), owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : null }; });
  return { o, hits, state: window.__gevLc.state() };
});
console.log(JSON.stringify(dump.o), JSON.stringify(dump.hits));
await page.screenshot({ path: path.join(OUT, 'J-3click-settled.png') });
// 局部放大：右栏
await page.screenshot({ path: path.join(OUT, 'J-3click-right-rail.png'), clip: { x: 1290, y: 80, width: 240, height: 500 } });
fs.writeFileSync(path.join(OUT, 'J-3click.json'), JSON.stringify(dump, null, 2));
await browser.close();
