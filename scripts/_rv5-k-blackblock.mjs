#!/usr/bin/env node
/* _rv5-k-blackblock.mjs — reviewer round-5 probe K: what actually paints the black rectangle
   inside the expanded 监控 card? Enumerates every element containing the point (ignoring
   pointer-events) that carries a non-transparent fill / image / media, in DOM order. */
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
const clickId = async (id, wait = 4000) => {
  const p = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return { ok: false }; const er = el.getBoundingClientRect(); const cands = []; for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]); } cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]); for (const q of cands) { const e = document.elementFromPoint(q[0], q[1]); if (e && el.contains(e)) return { ok: true, at: q }; } return { ok: false }; }, id);
  if (!p.ok) return p; await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); await sleep(wait); return p;
};
await clickId('cctv-panel', 4500);
R.painters = await page.evaluate(() => {
  const alpha = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return 0; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
  const pts = [[1334, 300], [1400, 240], [1250, 350]];
  const out = {};
  for (const [x, y] of pts) {
    const list = [];
    let i = 0;
    for (const n of document.querySelectorAll('body *')) {
      i++;
      const r = n.getBoundingClientRect();
      if (!(x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)) continue;
      const c = getComputedStyle(n);
      const isMedia = ['IMG', 'VIDEO', 'CANVAS'].includes(n.tagName);
      const hasFill = alpha(c.backgroundColor) > 0.05 || c.backgroundImage !== 'none';
      if (!isMedia && !hasFill) continue;
      list.push({ dom: i, tag: n.tagName, id: n.id || '', cls: (n.className && n.className.toString().split(' ').slice(0, 2).join('.')) || '', bg: c.backgroundColor, bgA: +alpha(c.backgroundColor).toFixed(3), bgImg: c.backgroundImage.slice(0, 60), op: +c.opacity, vis: c.visibility, pe: c.pointerEvents, z: c.zIndex, filter: c.filter, mix: c.mixBlendMode, rect: [+r.left.toFixed(0), +r.top.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)], src: isMedia ? (n.getAttribute('src') || n.id || '') .slice(0, 60) : undefined });
    }
    out[JSON.stringify([x, y])] = list;
  }
  return out;
});
R.cctvCardPainters = await page.evaluate(() => {
  const card = document.getElementById('cctv-panel');
  const res = [];
  const alpha = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return 0; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
  for (const n of card.querySelectorAll('*')) {
    const c = getComputedStyle(n); const r = n.getBoundingClientRect();
    if (r.width * r.height < 400) continue;
    if (alpha(c.backgroundColor) > 0.05 || c.backgroundImage !== 'none' || ['IMG', 'VIDEO', 'CANVAS'].includes(n.tagName)) {
      res.push({ tag: n.tagName, id: n.id || '', cls: (n.className && n.className.toString().split(' ').slice(0, 2).join('.')) || '', bg: c.backgroundColor, bgA: +alpha(c.backgroundColor).toFixed(3), bgImg: c.backgroundImage.slice(0, 70), op: +c.opacity, vis: c.visibility, rem: c.backgroundColor, rect: [+r.left.toFixed(0), +r.top.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)] });
    }
  }
  return res;
});
await page.screenshot({ path: path.join(OUT, 'K-cctv.png') });
console.log('##', JSON.stringify(R).slice(0, 5000));
fs.writeFileSync(path.join(OUT, 'K-blackblock.json'), JSON.stringify(R, null, 1));
await browser.close();
