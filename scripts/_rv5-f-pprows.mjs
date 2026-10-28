#!/usr/bin/env node
/* _rv5-f-pprows.mjs — reviewer round-5 probe F: pp expanded layout (contract item 4).
   Enumerates the real option rows inside DIV.panel-collapsible (excludes glass-edge / glow
   overlays), measures row gaps, checks the row boxes never overlap and text is not clipped,
   verifies buttons have no solid fill / no dark text, and drives a real wheel scroll. */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r5');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 3000)); };

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
  window.__tr = { down: 0, downT: 0, wheel: 0, wheelT: 0 };
  addEventListener('pointerdown', (e) => { window.__tr.down++; if (e.isTrusted) window.__tr.downT++; }, true);
  addEventListener('wheel', (e) => { window.__tr.wheel++; if (e.isTrusted) window.__tr.wheelT++; }, { capture: true, passive: true });
});
page.on('pageerror', (e) => (R.consoleErrors = R.consoleErrors || []).push(String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(10000);

const clickId = async (id, wait = 1000) => {
  const p = await page.evaluate((id) => { const el = document.getElementById(id); if (!el) return { ok: false }; const er = el.getBoundingClientRect(); const cands = []; for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header')) { const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) cands.push([Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]); } cands.push([Math.round(er.x + er.width / 2), Math.round(er.y + Math.min(14, er.height / 2))]); for (const q of cands) { const e = document.elementFromPoint(q[0], q[1]); if (e && el.contains(e)) return { ok: true, at: q }; } return { ok: false }; }, id);
  if (!p.ok) return p; await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up(); await sleep(wait); return p;
};
await clickId('pp-toggles', 3500);

const MEASURE = () => {
  const card = document.getElementById('pp-toggles');
  const alpha = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return 0; const p = m[1].split(',').map(parseFloat); return p.length > 3 ? p[3] : 1; };
  const sc = [...card.querySelectorAll('*')].filter((n) => { const c = getComputedStyle(n); return /(auto|scroll)/.test(c.overflowY) && n.scrollHeight > n.clientHeight + 4; }).sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || card.querySelector('.panel-collapsible') || card;
  const cw = card.getBoundingClientRect().width;
  let cands = [...sc.querySelectorAll('*')].filter((n) => {
    const c = getComputedStyle(n); const r = n.getBoundingClientRect();
    if (r.height < 12 || r.height > 90 || c.display === 'none' || +c.opacity < 0.05) return false;
    if (n.classList.contains('gev-lc-edge') || n.classList.contains('panel-glow')) return false;
    if (r.width < cw * 0.5) return false;
    return true;
  });
  cands = cands.filter((n) => !cands.some((m) => m !== n && n.contains(m)));
  const kids = cands;
  const rows = kids.map((n) => { const r = n.getBoundingClientRect(); return { y: +r.y.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1), w: +r.width.toFixed(1), sel: n.tagName + '.' + ((n.className && n.className.toString().split(' ')[0]) || ''), txt: (n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24) }; }).sort((a, b) => a.y - b.y || a.x - b.x);
  const gaps = []; const overlaps = [];
  for (let i = 1; i < rows.length; i++) {
    const g = +(rows[i].y - rows[i - 1].b).toFixed(1);
    if (g < -0.5) overlaps.push({ a: rows[i - 1].sel, b: rows[i].sel, iy: -g }); else gaps.push(g);
  }
  const tw = [...card.querySelectorAll('*')].filter((n) => !n.children.length && (n.textContent || '').trim() && n.getBoundingClientRect().height > 6).map((n) => ({ t: n.textContent.trim().slice(0, 16), r: n.getBoundingClientRect() }));
  const textOverlaps = [];
  for (let i = 0; i < tw.length; i++) for (let j = i + 1; j < tw.length; j++) {
    const a = tw[i].r, b = tw[j].r;
    const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ix > 1 && iy > 1) textOverlaps.push({ a: tw[i].t, b: tw[j].t, ix: +ix.toFixed(1), iy: +iy.toFixed(1) });
  }
  const btns = [...card.querySelectorAll('button, [role="button"]')].map((b) => { const c = getComputedStyle(b); const m = /rgb\((\d+), (\d+), (\d+)/.exec(c.color) || /rgba\((\d+), (\d+), (\d+)/.exec(c.color); return { bg: c.backgroundColor, a: alpha(c.backgroundColor), color: c.color, dark: m ? Math.max(+m[1], +m[2], +m[3]) < 90 : false, txt: (b.textContent || '').trim().slice(0, 14) }; });
  const cr = sc.getBoundingClientRect();
  const clipped = kids.filter((n) => { const r = n.getBoundingClientRect(); return r.right > cr.right + 1 || r.left < cr.left - 1; }).length;
  return { rows: rows.length, rowsDetail: rows, minGap: gaps.length ? Math.min(...gaps) : null, gaps, overlaps, textOverlaps, btnCount: btns.length, solidBtns: btns.filter((b) => b.a > 0.15), darkBtns: btns.filter((b) => b.dark), clipped, scroll: { top: sc.scrollTop, h: sc.scrollHeight, ch: sc.clientHeight }, scrollerTag: sc.tagName + '.' + sc.className.split(' ')[0] };
};
const m1 = await page.evaluate(MEASURE);
put('pp_layout', m1);
await page.screenshot({ path: path.join(OUT, 'F-pp-top.png') });

const wheelPath = [];
for (let i = 0; i < 5; i++) {
  const box = await page.evaluate(() => { const el = document.getElementById('pp-toggles'); const r = el.getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height * 0.62)]; });
  await page.mouse.move(box[0], box[1]);
  await page.mouse.wheel({ deltaY: 120 });
  await sleep(340);
  wheelPath.push(await page.evaluate(() => { const card = document.getElementById('pp-toggles'); const sc = [...card.querySelectorAll('*')].filter((n) => { const c = getComputedStyle(n); return /(auto|scroll)/.test(c.overflowY) && n.scrollHeight > n.clientHeight + 4; }).sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || card.querySelector('.panel-collapsible') || card; return +sc.scrollTop.toFixed(1); }));
}
const m2 = await page.evaluate(MEASURE);
await page.screenshot({ path: path.join(OUT, 'F-pp-scrolled.png') });
put('pp_wheel', { wheelPath, scrolledTo: wheelPath[wheelPath.length - 1], maxScroll: m2.scroll.h - m2.scroll.ch });
put('pp_scrolled_layout', { rows: m2.rows, minGap: m2.minGap, overlaps: m2.overlaps, textOverlaps: m2.textOverlaps.length, clipped: m2.clipped });
put('pp_ok', { rows_ge_9: m1.rows >= 9, minGap_ge_8: (m1.minGap ?? 0) >= 7.5, noRowOverlap: m1.overlaps.length === 0 && m2.overlaps.length === 0, noTextOverlap: m1.textOverlaps.length === 0 && m2.textOverlaps.length === 0, noSolidBtns: m1.solidBtns.length === 0, noDarkBtns: m1.darkBtns.length === 0, notClipped: m1.clipped === 0 && m2.clipped === 0, wheelWorks: wheelPath[wheelPath.length - 1] > 100 });
put('trust', await page.evaluate(() => window.__tr));
put('consoleErrors', R.consoleErrors || []);
fs.writeFileSync(path.join(OUT, 'F-pprows.json'), JSON.stringify(R, null, 1));
console.log('WROTE F');
await browser.close();
