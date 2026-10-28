#!/usr/bin/env node
/**
 * _rv3-d-mini.mjs — reviewer round-3 probe D (CONTRACT lens, own harness).
 *  (1) mini-state INTERIOR scan of all 9 cards: any dark block / backdrop-filter / X inside
 *  (2) idle-empty baseline vs switch-empty attribution (does a switch leave both groups empty?)
 *  (3) #tilt-map-view pressed state material
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { started: new Date().toISOString(), viewport: `${W}x${H}`, round: 3, lens: 'contract' };
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 2600)); };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
  window.__rv = { down: 0, downT: 0, click: 0, clickT: 0, wheel: 0, wheelT: 0 };
  for (const t of ['pointerdown', 'click', 'wheel']) {
    document.addEventListener(t, (e) => {
      if (t === 'pointerdown') { window.__rv.down++; if (e.isTrusted) window.__rv.downT++; }
      else if (t === 'click') { window.__rv.click++; if (e.isTrusted) window.__rv.clickT++; }
      else { window.__rv.wheel++; if (e.isTrusted) window.__rv.wheelT++; }
    }, true);
  }
  const st = (id) => { const el = document.getElementById(id); if (!el) return null; const c = getComputedStyle(el); return { open: !el.classList.contains('collapsed'), vis: c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05 }; };
  const L = ['data-panel', 'scene-panel'], RR = ['pp-toggles', 'cctv-panel', 'global-context-panel'];
  window.__log = [];
  window.__startLog = () => { window.__log = []; const tick = () => { window.__log.push({ t: +performance.now().toFixed(1), k: 'f', l: L.filter((i) => (st(i) || {}).open), r: RR.filter((i) => (st(i) || {}).open), hR: RR.filter((i) => { const s = st(i); return s && !s.vis; }) });
      window.__raf = requestAnimationFrame(tick); }; tick(); };
  window.__mark = (m) => window.__log.push({ t: +performance.now().toFixed(1), k: 'm', m });
  window.__stopLog = () => { cancelAnimationFrame(window.__raf); return window.__log; };
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9000);

const BODY = `const s=String(c);if(/^rgba?\\(/.test(s)){const p=s.match(/rgba?\\(([^)]+)\\)/)[1].split(/[,\\s\\/]+/).filter(Boolean).map(Number);return p.length>3?p[3]:1;}return 0;`;
const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];

// ---------- (1) mini-state interior audit ----------
put('mini_interior', await page.evaluate((IDS, B) => {
  const a = new Function('c', B);
  const out = {};
  const vis = (el) => { const c = getComputedStyle(el); const r = el.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05 && r.width > 1 && r.height > 1; };
  for (const id of IDS) {
    const el = document.getElementById(id); if (!el) { out[id] = null; continue; }
    const er = el.getBoundingClientRect();
    const dark = [], frost = [], xs = [];
    for (const e of [el, ...el.querySelectorAll('*')]) {
      if (!vis(e)) continue;
      const c = getComputedStyle(e); const r = e.getBoundingClientRect();
      const bf = c.backdropFilter || 'none';
      if (bf !== 'none') frost.push({ sel: e.tagName + '.' + String(e.className || '').split(' ')[0], bf });
      if (a(c.backgroundColor) > 0.2 && r.width * r.height > 120) dark.push({ sel: e.tagName + '.' + String(e.className || '').split(' ')[0], bg: c.backgroundColor, area: Math.round(r.width * r.height) });
      if (/[✕✖✗×]/.test(e.textContent || '') && e.children.length === 0) xs.push(e.tagName + '.' + String(e.className || '').split(' ')[0] + ':' + (e.textContent || '').trim().slice(0, 4));
    }
    // center 5-point sampling walking up from the hit element inside this card
    const pts = [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7]];
    let maxA = 0; const det = [];
    for (const [fx, fy] of pts) {
      const x = Math.round(er.x + er.width * fx), y = Math.round(er.y + er.height * fy);
      const hit = document.elementFromPoint(x, y);
      let cur = hit, worst = 0, wsel = '';
      while (cur && cur !== document.body) {
        const c = getComputedStyle(cur);
        const al = a(c.backgroundColor);
        if (al > worst) { worst = al; wsel = cur.tagName + '.' + String(cur.className || '').split(' ')[0]; }
        cur = cur.parentElement;
      }
      det.push({ p: [x, y], hit: hit && hit.tagName + '.' + String(hit.className || '').split(' ')[0], worstA: +worst.toFixed(3), worstSel: wsel });
      maxA = Math.max(maxA, worst);
    }
    out[id] = { rect: [+er.x.toFixed(1), +er.y.toFixed(1), +er.width.toFixed(1), +er.height.toFixed(1)], darkInside: dark.slice(0, 5), frostInside: frost.slice(0, 5), xGlyphs: xs.slice(0, 4), maxCenterAlpha: +maxA.toFixed(3), points: det };
  }
  return out;
}, CARDS, BODY));
await page.screenshot({ path: path.join(OUT, 'R3-D-mini.png') });

// close everything that is collapsible first
const clickOwned = async (cardId) => {
  const probe = await page.evaluate((cardId) => {
    const el = document.getElementById(cardId); if (!el) return { ok: false };
    const er = el.getBoundingClientRect();
    const pts = [{ x: Math.round(er.x + er.width / 2), y: Math.round(er.y + Math.min(12, er.height / 2)) }];
    for (const h of el.querySelectorAll('.panel-title, .pp-header-label, .location-toolbar-label, .dock-title, .panel-header')) {
      const r = h.getBoundingClientRect(); if (r.width > 4 && r.height > 4) pts.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    }
    for (const p of pts) { const e = document.elementFromPoint(p.x, p.y); if (e && el.contains(e)) return { ok: true, at: [p.x, p.y], hit: e.tagName + '.' + String(e.className || '').split(' ')[0] }; }
    return { ok: false };
  }, cardId);
  if (!probe.ok) return { clicked: false };
  await page.mouse.move(probe.at[0], probe.at[1]);
  await page.mouse.down(); await page.mouse.up();
  await sleep(600);
  return { clicked: true, preHit: probe.hit };
};
for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
  const open = await page.evaluate((i) => { const el = document.getElementById(i); return el && !el.classList.contains('collapsed'); }, id);
  if (open) await clickOwned(id);
}
await sleep(800);

// ---------- (2) idle-empty vs switch-empty attribution ----------
await page.evaluate(() => window.__startLog());
await page.evaluate(() => window.__mark('idle-start'));
await sleep(400);
await page.evaluate(() => window.__mark('idle-end'));
await clickOwned('data-panel');
await sleep(500);
await clickOwned('scene-panel');
await sleep(500);
await clickOwned('data-panel');
await sleep(500);
await clickOwned('data-panel'); // collapse it -> no card open again
await sleep(500);
const log = await page.evaluate(() => window.__stopLog());
// segment frames by markers
const segs = [];
let cur = { name: 'before-any-marker', frames: [] };
for (const e of log) {
  if (e.k === 'm') { segs.push(cur); cur = { name: e.m, frames: [] }; }
  else cur.frames.push(e);
}
segs.push(cur);
put('empty_attribution', segs.map((s) => ({
  seg: s.name, frames: s.frames.length,
  empty: s.frames.filter((f) => f.l.length === 0 && f.r.length === 0).length,
  leftOpen: s.frames.filter((f) => f.l.length === 1).length,
  rightOpen: s.frames.filter((f) => f.r.length === 1).length,
  bothOpen: s.frames.filter((f) => f.l.length >= 1 && f.r.length >= 1).length,
  hiddenR: s.frames.filter((f) => f.hR.length).length,
})).filter((s) => s.frames > 0));

// ---------- (3) tilt pressed state ----------
const tb = await page.evaluate(() => { const b = document.getElementById('tilt-map-view'); const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; });
await page.mouse.move(tb.x, tb.y); await sleep(100); await page.mouse.down(); await page.mouse.up(); await sleep(300);
put('tilt_pressed', await page.evaluate((B) => {
  const a = new Function('c', B);
  const b = document.getElementById('tilt-map-view'); const c = getComputedStyle(b);
  return { pressed: b.getAttribute('aria-pressed'), bg: c.backgroundColor, bgA: +a(c.backgroundColor).toFixed(2), bgImg: c.backgroundImage === 'none' ? 'none' : c.backgroundImage.slice(0, 40), bf: c.backdropFilter || 'none', color: c.color, rect: (() => { const r = b.getBoundingClientRect(); return [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)]; })() };
}, BODY));
put('trust', await page.evaluate(() => window.__rv));
R.finished = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'D-mini.json'), JSON.stringify(R, null, 1));
console.log('WROTE', path.join(OUT, 'D-mini.json'));
await browser.close();
