#!/usr/bin/env node
/** _r4-diag4.mjs — 重载时间线：刷新后每 400ms 采样 12s，看哪些卡在何时展开/收起 */
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
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {} });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9500);
const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const state = () => page.evaluate((IDS) => Object.fromEntries(IDS.map((id) => { const el = document.getElementById(id); return [id, el ? { open: !el.classList.contains('collapsed'), floating: el.classList.contains('gev-lc-floating'), h: Math.round(el.getBoundingClientRect().height) } : null]; })), IDS);
console.log('## initial', JSON.stringify(await state()));
console.log('## store', JSON.stringify(await page.evaluate(() => { const o = {}; for (const k of Object.keys(localStorage)) if (k.startsWith('gev-liquid-cards')) o[k] = localStorage.getItem(k).slice(0, 300); return o; })));

const click = async (id, wait = 800) => {
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
for (const id of ['scene-panel', 'global-context-panel', 'control-panel']) await click(id, 900);
console.log('## after-open', JSON.stringify(await state()));
for (const id of IDS) { const s = await state(); if (s[id] && s[id].open) await click(id, 800); }
await page.evaluate(() => { try { window.__gevLc.close('gev-voice-control'); } catch (e) {} });
await sleep(1500);
console.log('## after-close', JSON.stringify(await state()));
console.log('## store2', JSON.stringify(await page.evaluate(() => { const o = {}; for (const k of Object.keys(localStorage)) if (k.startsWith('gev-liquid-cards')) o[k] = localStorage.getItem(k).slice(0, 300); return o; })));

await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
const tl = [];
for (let i = 0; i < 30; i++) {
  await sleep(400);
  const s = await state();
  tl.push({ at: +((i + 1) * 0.4).toFixed(1), open: Object.entries(s).filter(([, v]) => v && v.open).map(([k]) => k), h: Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v && v.h])) });
}
tl.forEach((x) => console.log('## t+' + x.at + 's', JSON.stringify(x.open), JSON.stringify(x.h)));
fs.writeFileSync(path.join(OUT, 'diag4-reload.json'), JSON.stringify(tl, null, 1));
await page.screenshot({ path: path.join(OUT, 'DIAG4-reload-end.png') });
await browser.close();
