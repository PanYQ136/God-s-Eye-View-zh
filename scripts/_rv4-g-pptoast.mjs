#!/usr/bin/env node
/* _rv4-g-pptoast.mjs — reviewer round-4 probe G:
   (1) pp expanded: row spacing measured inside .pp-panel-body (my C probe's container was the card
       shell, whose sticky header vs edge divs produced false overlaps);
   (2) round-2/3 requested chrome items re-verified: natural real-click #toast plus the 3 status chips. */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r4');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 2600)); };

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
  window.__tr = { down: 0, downT: 0, click: 0, clickT: 0, wheel: 0, wheelT: 0 };
  addEventListener('pointerdown', (e) => { window.__tr.down++; if (e.isTrusted) window.__tr.downT++; }, true);
  addEventListener('click', (e) => { window.__tr.click++; if (e.isTrusted) window.__tr.clickT++; }, true);
  addEventListener('wheel', (e) => { window.__tr.wheel++; if (e.isTrusted) window.__tr.wheelT++; }, { capture: true, passive: true });
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(10000);
const clickCard = async (id, wait = 1200) => {
  const p = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return { ok: false };
    const er = el.getBoundingClientRect(); const cands = [];
    for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]); }
    cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]);
    for (const q of cands) { const e = document.elementFromPoint(q[0], q[1]); if (e && el.contains(e)) return { ok: true, at: q }; }
    return { ok: false }; }, id);
  if (!p.ok) return p;
  await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up();
  await sleep(wait); return p;
};

// 1) pp rows inside .pp-panel-body
await clickCard('pp-toggles', 1800);
put('pp_rows', await page.evaluate(() => {
  const body = document.querySelector('#pp-toggles .pp-panel-body') || document.getElementById('pp-toggles');
  const alpha = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return 0; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
  const kids = [...body.children].map((n, i) => { const r = n.getBoundingClientRect(); const c = getComputedStyle(n); return { i, tag: n.tagName, cls: (n.className || '').toString().slice(0, 40), rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], disp: c.display, op: +c.opacity, bg: c.backgroundColor, bgA: +alpha(c.backgroundColor).toFixed(2) }; });
  const vis = kids.filter((k) => k.disp !== 'none' && k.op > 0.05 && k.rect[2] > 2 && k.rect[3] > 2);
  const gaps = []; let minGap = 999; const overlaps = [];
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const a = vis[i].rect, b = vis[j].rect;
    const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]); const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    if (ix > 0 && iy > 0) overlaps.push({ i: vis[i].i, j: vis[j].i, ix: +ix.toFixed(1), iy: +iy.toFixed(1) });
  }
  const sorted = [...vis].sort((p, q) => p.rect[1] - q.rect[1]);
  for (let i = 1; i < sorted.length; i++) { const g = +(sorted[i].rect[1] - (sorted[i - 1].rect[1] + sorted[i - 1].rect[3])).toFixed(1); gaps.push({ a: sorted[i - 1].i, b: sorted[i].i, gap: g }); minGap = Math.min(minGap, g); }
  // buttons / options transparency + text color
  const btns = [...document.querySelectorAll('#pp-toggles button, #pp-toggles .pp-opt, #pp-toggles .pp-row, #pp-toggles [role="button"]')].map((b) => { const c = getComputedStyle(b); const r = b.getBoundingClientRect(); return { sel: b.tagName + '.' + (b.className || '').toString().split(' ')[0], bg: c.backgroundColor, bgA: +alpha(c.backgroundColor).toFixed(2), color: c.color, w: Math.round(r.width), h: Math.round(r.height), txt: (b.innerText || '').trim().slice(0, 12) }; }).filter((b) => b.w > 4 && b.h > 4);
  const darkTxt = btns.filter((b) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(b.color); if (!m) return false; return Math.max(+m[1], +m[2], +m[3]) < 90; });
  const solid = btns.filter((b) => b.bgA > 0.12);
  // text node overlap check
  const texts = [...document.querySelectorAll('#pp-toggles *')].filter((n) => n.childNodes.length === 1 && n.firstChild.nodeType === 3 && (n.innerText || '').trim().length > 0).map((n) => { const r = n.getBoundingClientRect(); return { txt: n.innerText.trim().slice(0, 14), rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)] }; }).filter((t) => t.rect[2] > 2 && t.rect[3] > 2);
  const textOverlaps = [];
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) { const a = texts[i].rect, b = texts[j].rect; const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]); const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]); if (ix > 1 && iy > 1) textOverlaps.push({ a: texts[i].txt, b: texts[j].txt, ix: +ix.toFixed(1), iy: +iy.toFixed(1) }); }
  const sc = document.getElementById('pp-toggles');
  return { rowCount: vis.length, minGap, overlaps, gaps, btns: btns.length, solid, darkTxt: darkTxt.map((b) => ({ sel: b.sel, color: b.color, txt: b.txt })), textCount: texts.length, textOverlaps, scroll: { top: sc.scrollTop, h: sc.scrollHeight, ch: sc.clientHeight }, rows: vis.map((k) => ({ i: k.i, cls: k.cls, rect: k.rect, bgA: k.bgA })) };
}));
// real wheel scroll
const path1 = [];
for (let i = 0; i < 3; i++) {
  const wh = await page.evaluate(() => { const el = document.getElementById('pp-toggles'); const r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height * 0.6)]; });
  await page.mouse.move(wh[0], wh[1]); await page.mouse.wheel({ deltaY: 120 }); await sleep(300);
  path1.push(await page.evaluate(() => +document.getElementById('pp-toggles').scrollTop.toFixed(1)));
}
put('pp_wheel', { path: path1 });
await page.screenshot({ path: path.join(OUT, 'G-pp-scrolled.png') });
await clickCard('pp-toggles', 1200);

// 2) toast via natural real click on #tilt-map-view
const tilt = await page.evaluate(() => { const el = document.getElementById('tilt-map-view'); const r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; });
await page.mouse.move(tilt[0], tilt[1]); await page.mouse.down(); await page.mouse.up();
await sleep(350);
put('toast_frame', await page.evaluate(() => {
  const alpha = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return 0; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
  const t = document.getElementById('toast');
  const cs = t ? getComputedStyle(t) : null;
  const frosted = [], dark = [];
  for (const n of document.querySelectorAll('body *')) {
    const c = getComputedStyle(n); const r = n.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
    if (+c.opacity < 0.05 || c.visibility === 'hidden' || c.display === 'none') continue;
    const bf = c.backdropFilter || c.webkitBackdropFilter;
    if (bf && bf.includes('blur')) frosted.push({ sel: n.tagName + '#' + n.id, bf });
    if (alpha(c.backgroundColor) > 0.25 && r.width * r.height > 400) dark.push({ sel: n.tagName + '#' + n.id + '.' + (n.className || '').toString().split(' ')[0], bg: c.backgroundColor, area: Math.round(r.width * r.height) });
  }
  const rr = t ? t.getBoundingClientRect() : null;
  return { toast: t ? { text: t.innerText.trim().slice(0, 40), bg: cs.backgroundColor, bgA: alpha(cs.backgroundColor), bf: cs.backdropFilter, op: cs.opacity, vis: t.classList.contains('visible'), rect: [+rr.x.toFixed(0), +rr.y.toFixed(0), +rr.width.toFixed(0), +rr.height.toFixed(0)] } : null, frosted, dark };
}));
await page.screenshot({ path: path.join(OUT, 'G-toast-visible.png') });

// 3) three status chips computed (forced visible via real UI states where possible; else computed)
put('status_chips', await page.evaluate(() => {
  const alpha = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return 0; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
  const out = {};
  for (const id of ['global-loading-status', 'traffic-sync-chip', 'cctv-sync-chip']) {
    const el = document.getElementById(id); if (!el) { out[id] = 'missing'; continue; }
    const c = getComputedStyle(el); const r = el.getBoundingClientRect();
    out[id] = { bg: c.backgroundColor, bgA: alpha(c.backgroundColor), bgImg: c.backgroundImage.slice(0, 30), bf: c.backdropFilter, op: c.opacity, disp: c.display, vis: c.visibility, rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)], states: [...el.classList].join('.') };
  }
  return out;
}));
put('trust', await page.evaluate(() => window.__tr));
fs.writeFileSync(path.join(OUT, 'G-pptoast.json'), JSON.stringify(R, null, 1));
console.log('WROTE G-pptoast.json');
await browser.close();
