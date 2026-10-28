#!/usr/bin/env node
/** _r4-diag5.mjs — 单开 pp / cctv / global 的几何 + 组让位计划（开 __gevcDebug） */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
const W = 1536, H = 730, URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/r4-t829');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'], protocolTimeout: 600000 });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {} window.__gevcDebug = false; });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (t.startsWith('[') || t.includes('plan') || t.includes('layout')) logs.push(t.slice(0, 400)); });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9500);
const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const st = () => page.evaluate((IDS) => Object.fromEntries(IDS.map((id) => { const el = document.getElementById(id); const r = el.getBoundingClientRect(); return [id, { r: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], col: el.classList.contains('collapsed'), fl: el.classList.contains('gev-lc-floating'), push: getComputedStyle(el).translate }]; })), IDS);
const click = async (id, wait = 1200) => {
  const p = await page.evaluate((id) => {
    const el = document.getElementById(id); const er = el.getBoundingClientRect(); const pts = [];
    for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header, .dock-tray-toggle')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) pts.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }); }
    pts.push({ x: Math.round(er.x + er.width / 2), y: Math.round(er.y + Math.min(14, er.height / 2)) });
    for (const p of pts) { const e = document.elementFromPoint(p.x, p.y); if (e && el.contains(e)) return { ok: true, at: [p.x, p.y] }; }
    return { ok: false };
  }, id);
  if (!p.ok) return false;
  await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); await sleep(wait); return true;
};
const closeAll = async () => {
  for (const id of IDS.slice(0, 7)) { const s = await st(); if (!s[id].col) await click(id, 900); }
  await page.evaluate(() => { try { window.__gevLc.close('gev-voice-control'); } catch (e) {} });
  await sleep(1200);
};
for (const id of ['pp-toggles', 'cctv-panel', 'global-context-panel', 'pp-toggles', 'cctv-panel']) {
  await closeAll();
  const before = await st();
  const ok = await click(id, 1500);
  const after = await st();
  console.log('## ' + id, JSON.stringify({ ok, before: Object.fromEntries(Object.entries(before).map(([k, v]) => [k, v.r])), after: Object.fromEntries(Object.entries(after).map(([k, v]) => [k, { r: v.r, fl: v.fl, push: v.push }])) }));
}
await page.screenshot({ path: path.join(OUT, 'DIAG5-last.png') });
fs.writeFileSync(path.join(OUT, 'diag5-console.txt'), logs.join('\n'));
await browser.close();
