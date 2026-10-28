#!/usr/bin/env node
/**
 * _review-t829-probe2.mjs — reviewer probe v2 (fixes v1 targeting bugs).
 * Focus: reliable header targeting (pre-click hit test + retry), sibling-only
 * geometry overlap, collapse-restore rects, pagewide frosted-control inventory.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];

const res = { started: new Date().toISOString(), checks: {} };
const put = (k, v) => { res.checks[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 1400)); };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860',
    '--autoplay-policy=no-user-gesture-required'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
  window.__rv = { down: 0, downTrusted: 0, click: 0, clickTrusted: 0, byCard: {} };
  const rec = (e) => {
    const o = window.__rv;
    if (e.type === 'pointerdown') { o.down++; if (e.isTrusted) o.downTrusted++; }
    else { o.click++; if (e.isTrusted) o.clickTrusted++; }
    const t = e.target; const c = t && t.closest ? t.closest('.gev-lc') : null;
    const id = c ? c.id : '(outside)';
    o.byCard[id] = o.byCard[id] || { down: 0, click: 0, downTrusted: 0, clickTrusted: 0 };
    if (e.type === 'pointerdown') { o.byCard[id].down++; if (e.isTrusted) o.byCard[id].downTrusted++; }
    else { o.byCard[id].click++; if (e.isTrusted) o.byCard[id].clickTrusted++; }
  };
  for (const t of ['pointerdown', 'click']) document.addEventListener(t, rec, true);
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
for (let i = 0; i < 30; i++) {
  const bad = await page.evaluate(() => {
    const l = document.getElementById('first-run-launcher');
    if (l) { const r = l.getBoundingClientRect(); const c = getComputedStyle(l); if (r.width > 8 && r.height > 8 && c.visibility !== 'hidden' && +c.opacity > .05) return true; }
    for (const el of document.querySelectorAll('body *')) {
      const t = (el.textContent || '').trim();
      if (!/首次启动|选择你的第一视角/.test(t) || el.children.length > 2) continue;
      const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
      if (r.width > 8 && r.height > 8 && c.visibility !== 'hidden' && +c.opacity > .05) return true;
    }
    return false;
  });
  if (!bad) break;
  await page.keyboard.press('Escape'); await sleep(500);
}
await sleep(6500);

const stateAll = () => page.evaluate((IDS) => {
  const a = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return /^rgb\(/.test(String(c)) ? 1 : 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id); if (!el) { o[id] = null; continue; }
    const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      open: !el.classList.contains('collapsed'), hidden: c.visibility === 'hidden' || c.display === 'none' || +c.opacity < .05,
      bgA: +a(c.backgroundColor).toFixed(3), bf: c.backdropFilter,
      inView: r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
  }
  return o;
}, CARDS);

// ---- reliable header click: candidate points with pre-click hit test ----
const clickHeader = async (id) => {
  const tries = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const hdr = el.querySelector('.panel-header, .pp-header-row, .dock-header, header') || el;
    const hr = hdr.getBoundingClientRect();
    const pts = [];
    for (const fx of [0.06, 0.15, 0.5]) for (const fy of [0.25, 0.5, 0.75]) {
      pts.push({ x: Math.round(hr.x + hr.width * fx), y: Math.round(hr.y + hr.height * fy) });
    }
    // also the title span centre
    const title = el.querySelector('.panel-title, .pp-header-label, .dock-title, [class*="title"]');
    if (title) { const t = title.getBoundingClientRect(); pts.unshift({ x: Math.round(t.x + t.width / 2), y: Math.round(t.y + t.height / 2) }); }
    return pts.map((p) => {
      const e = document.elementFromPoint(p.x, p.y);
      return { ...p, ok: !!(e && el.contains(e)), tag: e && e.tagName, cls: e && String(e.className || '').slice(0, 26) };
    });
  }, id);
  const good = tries.find((t) => t.ok);
  if (!good) return { id, clicked: false, tries };
  await page.mouse.move(good.x, good.y); await sleep(70);
  await page.mouse.down(); await sleep(45); await page.mouse.up();
  await sleep(120);
  return { id, clicked: true, at: [good.x, good.y], preHit: { tag: good.tag, cls: good.cls } };
};

// ---- 1) initial ----
put('initial', await stateAll());
put('pagewide_frosted', await page.evaluate(() => {
  const a = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return /^rgb\(/.test(String(c)) ? 1 : 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const c = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < .05 || r.width < 4 || r.height < 4) continue;
    if (!c.backdropFilter || c.backdropFilter === 'none') continue;
    out.push({ id: el.id, cls: String(el.className).slice(0, 30), bf: c.backdropFilter, bg: c.backgroundColor, bgA: +a(c.backgroundColor).toFixed(2), rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)], insideCard: !!el.closest('.gev-lc') });
  }
  return out;
}));

// ---- 2) open each card, audit, close ----
const openAudit = {};
for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
  const c = await clickHeader(id);
  await sleep(1300);
  const st = await stateAll();
  const inCard = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const a = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return /^rgb\(/.test(String(c)) ? 1 : 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
    const blur = [], solid = [];
    for (const d of el.querySelectorAll('*')) {
      const cs = getComputedStyle(d); const r = d.getBoundingClientRect();
      if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < .05 || r.width < 4 || r.height < 4) continue;
      if (cs.backdropFilter && cs.backdropFilter !== 'none') blur.push({ el: d.tagName + '.' + String(d.className).slice(0, 22), v: cs.backdropFilter });
      if (a(cs.backgroundColor) > 0.2 && r.width * r.height > 300) solid.push({ el: d.tagName + '.' + String(d.className).slice(0, 22), bg: cs.backgroundColor, area: Math.round(r.width * r.height) });
    }
    const r = el.getBoundingClientRect();
    const pts = [[0.5, 0.35], [0.5, 0.5], [0.5, 0.65], [0.3, 0.5], [0.7, 0.5]];
    const centre = pts.map(([fx, fy]) => {
      const x = r.x + r.width * fx, y = r.y + r.height * fy;
      let n = 0, maxA = 0, painted = [];
      const walk = (node) => {
        for (const d of node.children) {
          const dr = d.getBoundingClientRect(); const cs = getComputedStyle(d);
          if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < .05) continue;
          if (x >= dr.x && x <= dr.right && y >= dr.y && y <= dr.bottom) {
            const al = a(cs.backgroundColor);
            if (al > maxA) maxA = al;
            if (al > 0.02 || (cs.backgroundImage && cs.backgroundImage !== 'none') || (cs.backdropFilter && cs.backdropFilter !== 'none')) {
              painted.push(d.tagName + '.' + String(d.className || '').slice(0, 18) + '|a=' + al.toFixed(2) + (cs.backgroundImage !== 'none' ? '|grad' : '') + (cs.backdropFilter !== 'none' ? '|bf=' + cs.backdropFilter : ''));
            }
            n++;
          }
          walk(d);
        }
      };
      walk(el);
      return { at: [+x.toFixed(0), +y.toFixed(0)], layersAtPoint: n, maxBgAlpha: +maxA.toFixed(2), painted: painted.slice(0, 6) };
    });
    return { blurInside: blur.length, solidInside: solid, centre };
  }, id);
  openAudit[id] = { click: c, state: st[id], inCard };
  await page.screenshot({ path: path.join(OUT, 'v2-open-' + id + '.png') });
  await clickHeader(id); await sleep(1300);
  openAudit[id].closedAgain = (await stateAll())[id].open;
}
put('open', Object.fromEntries(Object.entries(openAudit).map(([k, v]) => [k, {
  clicked: v.click.clicked, preHit: v.click.preHit, opened: v.state.open, hidden: v.state.hidden,
  bgA: v.state.bgA, bf: v.state.bf, inView: v.state.inView, blurInside: v.inCard.blurInside,
  solidInside: v.inCard.solidInside, centreMaxBgA: v.inCard.centre.map((c) => c.maxBgAlpha),
  centrePainted: v.inCard.centre.map((c) => c.painted.join(' ; ')).filter(Boolean),
  closedAgain: v.closedAgain,
}])));

// ---- 3) pp geometry: sibling-only overlaps + clipped + styles ----
const pp = await (async () => {
  await clickHeader('pp-toggles'); await sleep(1500);
  const r = await page.evaluate(() => {
    const el = document.getElementById('pp-toggles');
    const vis = (e) => { const c = getComputedStyle(e); const b = e.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > .05 && b.width > 1 && b.height > 1; };
    const cardR = el.getBoundingClientRect();
    // text leaves
    const texts = [];
    for (const d of el.querySelectorAll('*')) {
      if (d.children.length || !vis(d)) continue;
      const t = (d.textContent || '').trim(); if (!t) continue;
      const b = d.getBoundingClientRect();
      texts.push({ t: t.slice(0, 14), x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) });
    }
    const overlaps = [];
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (!ix || !iy) continue;
      const inter = ix * iy, small = Math.min(a.w * a.h, b.w * b.h);
      if (small > 0 && inter / small >= 0.3) overlaps.push({ a: a.t, b: b.t, frac: +(inter / small).toFixed(2) });
    }
    // sibling-only rect overlap for控件的直接子块
    const rows = [...el.querySelectorAll('.pp-toggle-group, .pp-slider-row, .pp-toggle-btn, .pp-mode-btn')].filter(vis);
    const rel = (n1, n2) => n1.contains(n2) || n2.contains(n1);
    const overlaps2 = [];
    for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j]; if (rel(a, b)) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const ix = Math.max(0, Math.min(ra.right, rb.right) - Math.max(ra.x, rb.x));
      const iy = Math.max(0, Math.min(ra.bottom, rb.bottom) - Math.max(ra.y, rb.y));
      if (ix > 1 && iy > 1) overlaps2.push({ a: a.id || String(a.className).slice(0, 20), b: b.id || String(b.className).slice(0, 20), ix: +ix.toFixed(0), iy: +iy.toFixed(0) });
    }
    const groups = [...el.querySelectorAll('.pp-toggle-group')].filter(vis).map((g) => { const b = g.getBoundingClientRect(); return { y: +b.y.toFixed(0), h: +b.height.toFixed(0) }; }).sort((x, y) => x.y - y.y);
    let minGap = 1e9;
    for (let i = 1; i < groups.length; i++) minGap = Math.min(minGap, groups[i].y - (groups[i - 1].y + groups[i - 1].h));
    const clipped = rows.filter((d) => { const b = d.getBoundingClientRect(); return b.x < cardR.x - 1 || b.right > cardR.right + 1; }).map((d) => d.id || String(d.className).slice(0, 20));
    const style = [...el.querySelectorAll('.pp-toggle-btn, .pp-mode-btn')].filter(vis).map((d) => {
      const c = getComputedStyle(d);
      const m = (c.color.match(/[\d.]+/g) || [255, 255, 255]).slice(0, 3).map(Number);
      const bm = String(c.backgroundColor).match(/rgba?\(([^)]+)\)/);
      const bgA = bm ? (bm[1].split(',').length > 3 ? Number(bm[1].split(',')[3]) : 1) : 0;
      return { id: d.id, luma: +(((0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255).toFixed(2)), bg: c.backgroundColor, bgA: +bgA.toFixed(2) };
    });
    return { cardRect: [+cardR.x.toFixed(0), +cardR.y.toFixed(0), +cardR.width.toFixed(0), +cardR.height.toFixed(0)],
      scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      textCount: texts.length, textOverlaps: overlaps, siblingOverlaps: overlaps2, groupCount: groups.length, minGap: +minGap.toFixed(0),
      clipped, btnCount: style.length, darkBtns: style.filter((s) => s.luma < .45), solidBtns: style.filter((s) => s.bgA > .2) };
  });
  const box = await page.evaluate(() => { const b = document.getElementById('pp-toggles').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel({ deltaY: 300 }); await sleep(450);
  const mid = await page.evaluate(() => document.getElementById('pp-toggles').scrollTop);
  await page.mouse.wheel({ deltaY: 300 }); await sleep(450);
  const after = await page.evaluate(() => document.getElementById('pp-toggles').scrollTop);
  const hdr = await page.evaluate(() => {
    const el = document.getElementById('pp-toggles');
    const h = el.querySelector('.pp-header-row, .panel-header');
    const b = h.getBoundingClientRect(); const cb = el.getBoundingClientRect();
    const e = document.elementFromPoint(Math.round(b.x + 20), Math.round(b.y + b.height / 2));
    return { headerInCard: b.top >= cb.top - 1 && b.bottom <= cb.bottom + 1, headerHit: !!(e && h.contains(e)) };
  });
  await page.screenshot({ path: path.join(OUT, 'v2-pp-scrolled.png') });
  return { ...r, wheel: [r.scrollTop, mid, after], hdr };
})();
put('pp', pp);

// ---- 4) close pp, then collapse test: open 3 cards, close all, compare rects ----
await clickHeader('pp-toggles'); await sleep(1200);
const baseline = await stateAll();
await clickHeader('data-panel'); await sleep(900);
await clickHeader('pp-toggles'); await sleep(900);
await clickHeader('location-bar'); await sleep(900);
const opened = await stateAll();
const expandRects = Object.fromEntries(Object.entries(opened).map(([k, v]) => [k, v.rect]));
// close all open
for (const [id, v] of Object.entries(opened)) {
  if (v && v.open) { await clickHeader(id); await sleep(1100); }
}
await sleep(2200);
const closed = await stateAll();
const diff = [];
for (const id of CARDS) {
  if (!baseline[id] || !closed[id]) continue;
  const a = baseline[id].rect, b = closed[id].rect;
  const d = Math.max(...a.map((u, i) => Math.abs(u - b[i])));
  if (d > 1.5) diff.push({ id, baseline: a, now: b, delta: +d.toFixed(1) });
}
put('collapse', { stillOpen: Object.entries(closed).filter(([, v]) => v && v.open).map(([k]) => k), rectDiff: diff,
  outOfView: Object.entries(closed).filter(([, v]) => v && !v.inView).map(([k]) => k), expandedRects: expandRects });

// ---- 5) geometry overlap while 4 cards expanded (no two cards overlap) ----
const overlapNow = await page.evaluate((IDS) => {
  const out = [];
  const rects = IDS.map((id) => { const e = document.getElementById(id); const r = e ? e.getBoundingClientRect() : null; return r ? { id, x: r.x, y: r.y, w: r.width, h: r.height } : null; }).filter(Boolean);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
    const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    if (ix > 2 && iy > 2) out.push({ a: a.id, b: b.id, ix: +ix.toFixed(0), iy: +iy.toFixed(0) });
  }
  return out;
}, CARDS);
put('card_overlaps_collapsed', overlapNow);

put('trust', await page.evaluate(() => window.__rv));
res.finished = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'probe2.json'), JSON.stringify(res, null, 1));
await page.screenshot({ path: path.join(OUT, 'v2-final.png') });
await browser.close();
console.log('WROTE probe2.json');
