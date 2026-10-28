#!/usr/bin/env node
/* _rv5-j-cctvblock.mjs — reviewer round-5 probe J: identify the large black rectangle visible
   inside the expanded 监控 card. Is it the live video element (content) or card material?
   Also sample the card centre background layers beneath it. */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r5');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};

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
const clickId = async (id, wait = 1500) => {
  const p = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return { ok: false }; const er = el.getBoundingClientRect(); const cands = []; for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]); } cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]); for (const q of cands) { const e = document.elementFromPoint(q[0], q[1]); if (e && el.contains(e)) return { ok: true, at: q }; } return { ok: false }; }, id);
  if (!p.ok) return p; await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); await sleep(wait); return p;
};
await clickId('cctv-panel', 4000);
R.stack = await page.evaluate(() => {
  const alpha = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return 0; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
  const pts = [[1334, 300], [1300, 250], [1400, 350]];
  return pts.map(([x, y]) => {
    const out = []; let n = document.elementFromPoint(x, y);
    while (n && out.length < 8) {
      const c = getComputedStyle(n); const r = n.getBoundingClientRect();
      out.push({ tag: n.tagName, cls: (n.className && n.className.toString().split(' ').slice(0, 2).join('.')) || '', id: n.id || '', bg: c.backgroundColor, bgA: +alpha(c.backgroundColor).toFixed(3), bgImg: c.backgroundImage.slice(0, 46), bf: c.backdropFilter || 'none', rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)] });
      n = n.parentElement;
    }
    return { pt: [x, y], stack: out };
  });
});
R.frames = await page.evaluate(() => [...document.querySelectorAll('#cctv-panel img, #cctv-panel video, #cctv-panel canvas')].map((n) => { const r = n.getBoundingClientRect(); const c = getComputedStyle(n); return { tag: n.tagName, id: n.id || '', src: (n.getAttribute('src') || '').slice(0, 50), rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)], op: +c.opacity, bg: c.backgroundColor, filter: c.filter }; }));
await page.screenshot({ path: path.join(OUT, 'J-cctv-expanded.png') });
console.log('##', JSON.stringify(R).slice(0, 4000));
fs.writeFileSync(path.join(OUT, 'J-cctvblock.json'), JSON.stringify(R, null, 1));
await browser.close();
