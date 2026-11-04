#!/usr/bin/env node
/* _rv5-m-blacktest.mjs — reviewer round-5 probe M: isolate the black rectangle inside the
   expanded 监控 card by hiding candidates one at a time (diagnostic only, no product change)
   and capturing a screenshot after each step. */
import puppeteer from 'puppeteer';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r5');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {} });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(10000);
const clickId = async (id, wait = 4500) => {
  const p = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return { ok: false }; const er = el.getBoundingClientRect(); const cands = []; for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]); } cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]); for (const q of cands) { const e = document.elementFromPoint(q[0], q[1]); if (e && el.contains(e)) return { ok: true, at: q }; } return { ok: false }; }, id);
  if (!p.ok) return p; await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); await sleep(wait); return p;
};
await clickId('cctv-panel', 4500);
const clip = { x: 1140, y: 150, width: 400, height: 420 };
await page.screenshot({ path: path.join(OUT, 'M-0-expanded.png'), clip });
await page.evaluate(() => { const el = document.getElementById('cctv-frame-wrap'); if (el) el.style.visibility = 'hidden'; });
await sleep(800);
await page.screenshot({ path: path.join(OUT, 'M-1-wrap-hidden.png'), clip });
await page.evaluate(() => { const el = document.getElementById('cctv-frame-wrap'); if (el) el.style.visibility = ''; const inner = document.querySelector('#cctv-panel .cctv-panel-inner'); if (inner) inner.style.visibility = 'hidden'; });
await sleep(800);
await page.screenshot({ path: path.join(OUT, 'M-2-inner-hidden.png'), clip });
console.log('WROTE M screenshots');
await browser.close();
