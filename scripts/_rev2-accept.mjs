#!/usr/bin/env node
/**
 * _review-t829-probe.mjs — INDEPENDENT reviewer probe for t_829dd186.
 * Written by the reviewer (not the implementer). Does not import or reuse the
 * implementer's harness logic; measures the acceptance criteria directly.
 *
 * Usage: node scripts/_review-t829-probe.mjs
 * Output: .gev-logs/review-t829/probe.json + stdout summary
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536;
const H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/rev2-accept');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const GROUPS = {
  left: ['data-panel', 'scene-panel'],
  right: ['pp-toggles', 'cctv-panel', 'global-context-panel'],
};

const res = { viewport: [W, H], started: new Date().toISOString(), checks: {}, notes: [] };
const put = (k, v) => { res.checks[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 900)); };

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
  // trust recorder (own implementation)
  window.__rv = { down: 0, downTrusted: 0, click: 0, clickTrusted: 0, log: [] };
  const rec = (e) => {
    const o = window.__rv;
    if (e.type === 'pointerdown') { o.down++; if (e.isTrusted) o.downTrusted++; }
    if (e.type === 'click') { o.click++; if (e.isTrusted) o.clickTrusted++; }
    const t = e.target;
    const card = t && t.closest ? t.closest('[id]') : null;
    o.log.push({ t: e.type, tr: !!e.isTrusted, x: Math.round(e.clientX || 0), y: Math.round(e.clientY || 0), card: card ? card.id : '' });
  };
  for (const t of ['pointerdown', 'click']) document.addEventListener(t, rec, true);
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });

// dismiss onboarding / toasts (own logic)
for (let i = 0; i < 30; i++) {
  const bad = await page.evaluate(() => {
    const out = [];
    const l = document.getElementById('first-run-launcher');
    if (l) {
      const r = l.getBoundingClientRect(); const c = getComputedStyle(l);
      if (r.width > 8 && r.height > 8 && c.visibility !== 'hidden' && +c.opacity > .05 && c.display !== 'none') out.push('launcher');
    }
    for (const el of document.querySelectorAll('body *')) {
      const txt = (el.textContent || '').trim();
      if (!/首次启动|选择你的第一视角|定位来源/.test(txt) || el.children.length > 2) continue;
      const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
      if (r.width > 8 && r.height > 8 && c.visibility !== 'hidden' && +c.opacity > .05 && c.display !== 'none') out.push('toast:' + txt.slice(0, 10));
    }
    return out;
  });
  if (!bad.length) break;
  await page.keyboard.press('Escape');
  await sleep(500);
}
await sleep(6000); // let rails settle (reviewer-chosen wait, longer than implementer's 2s)

const stateAll = () => page.evaluate((IDS) => {
  const alpha = (c) => {
    if (!c) return 0;
    if (c === 'transparent') return 0;
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return 1;
    const p = m[1].split(',').map(Number);
    return p.length > 3 ? p[3] : 1;
  };
  const cards = {};
  for (const id of IDS) {
    const el = document.getElementById(id);
    if (!el) { cards[id] = null; continue; }
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    const open = !el.classList.contains('collapsed');
    cards[id] = {
      rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      open, hidden: c.visibility === 'hidden' || c.display === 'none' || +c.opacity < .05,
      bg: c.backgroundColor, bgA: +alpha(c.backgroundColor).toFixed(3),
      bf: c.backdropFilter, z: c.zIndex,
      inView: r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
    };
  }
  return cards;
}, CARDS);

// ---------- 1) initial state ----------
put('initial', await stateAll());

put('initial_pagewide', await page.evaluate(() => {
  const alpha = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return /^rgb\(/.test(String(c)) ? 1 : 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
  const vis = (el) => { const c = getComputedStyle(el); const r = el.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > .05 && r.width > 1 && r.height > 1; };
  const blur = [], xGlyph = [], closeEls = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const c = getComputedStyle(el);
    if (c.backdropFilter && c.backdropFilter !== 'none') blur.push({ id: el.id, cls: String(el.className).slice(0, 40), v: c.backdropFilter });
    if (!el.children.length) {
      const t = (el.textContent || '').trim();
      if (t && /[\u2715\u00d7\u2716\u2717]/.test(t)) xGlyph.push({ id: el.id, cls: String(el.className).slice(0, 30), t });
    }
  }
  for (const el of document.querySelectorAll('.gev-lc-close, .gd-x, .cesium-credit-lightbox-close')) closeEls.push({ cls: String(el.className).slice(0, 40), txt: (el.textContent || '').trim().slice(0, 8), vis: vis(el) });
  return { backdropFilterVisible: blur, xGlyphs: xGlyph, closeLike: closeEls, docBlurAnywhere: document.querySelectorAll('.gev-lc *').length };
}));

// ---------- 2) card centre paint audit (what is actually painted at the centre) ----------
const centreAudit = async (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const r = el.getBoundingClientRect();
  const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
  const alpha = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return /^rgb\(/.test(String(c)) ? 1 : 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
  const stack = [];
  const walk = (node) => {
    for (const d of node.children) {
      const dr = d.getBoundingClientRect(); const c = getComputedStyle(d);
      if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < .05) continue;
      if (cx >= dr.x && cx <= dr.right && cy >= dr.y && cy <= dr.bottom) {
        stack.push({ el: d.tagName + (d.id ? '#' + d.id : '') + '.' + String(d.className || '').slice(0, 28),
          bg: c.backgroundColor, bgA: +alpha(c.backgroundColor).toFixed(3),
          bgi: c.backgroundImage === 'none' ? '' : c.backgroundImage.slice(0, 40),
          bf: c.backdropFilter, filter: c.filter, op: c.opacity });
      }
      walk(d);
    }
  };
  const cs = getComputedStyle(el);
  stack.push({ el: 'SELF#' + id, bg: cs.backgroundColor, bgA: +alpha(cs.backgroundColor).toFixed(3), bgi: cs.backgroundImage === 'none' ? '' : cs.backgroundImage.slice(0, 40), bf: cs.backdropFilter, filter: cs.filter, op: cs.opacity });
  const painted = stack.filter((s) => s.bgA > 0.02 || s.bgi || (s.bf && s.bf !== 'none') || (s.filter && s.filter !== 'none'));
  const worst = Math.max(0, ...stack.map((s) => s.bgA));
  return { centre: [+cx.toFixed(0), +cy.toFixed(0)], chainLen: stack.length, paintedAtCentre: painted, maxBgAlpha: worst };
}, id);

// ---------- 3) real click each header ----------
const headerPoint = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const cand = el.querySelector('.panel-header, .pp-header-row, .dock-header, [class*="header"]');
  const t = cand || el;
  const r = (cand || el).getBoundingClientRect();
  return { x: Math.round(r.x + Math.min(40, r.width / 2)), y: Math.round(r.y + Math.min(14, r.height / 2)), rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)], target: t.className || t.id };
}, id);

const clickCard = async (id) => {
  const p = await headerPoint(id);
  await page.mouse.move(p.x, p.y);
  await sleep(60);
  await page.mouse.down();
  await sleep(40);
  await page.mouse.up();
  await sleep(60);
  const hit = await page.evaluate((x, y) => {
    const e = document.elementFromPoint(x, y);
    const c = e && e.closest ? e.closest('[id]') : null;
    return { tag: e && e.tagName, cls: e && String(e.className || '').slice(0, 30), card: c ? c.id : '' };
  }, p.x, p.y);
  return { id, point: p, hit };
};

const openAudit = {};
for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
  const c = await clickCard(id);
  await sleep(1200);
  const st = await stateAll();
  const audit = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const alpha = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return /^rgb\(/.test(String(c)) ? 1 : 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
    const blur = [], solid = [];
    for (const d of el.querySelectorAll('*')) {
      const c = getComputedStyle(d); const r = d.getBoundingClientRect();
      if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < .05 || r.width < 4 || r.height < 4) continue;
      if (c.backdropFilter && c.backdropFilter !== 'none') blur.push({ el: d.tagName + '.' + String(d.className || '').slice(0, 24), v: c.backdropFilter });
      const a = alpha(c.backgroundColor);
      if (a > 0.2 && r.width * r.height > 300) solid.push({ el: d.tagName + '.' + String(d.className || '').slice(0, 24), bg: c.backgroundColor, area: Math.round(r.width * r.height) });
    }
    return { blurInside: blur, solidInside: solid };
  }, id);
  openAudit[id] = { click: c, after: st[id], audit, centre: await centreAudit(id) };
  await page.screenshot({ path: path.join(OUT, 'open-' + id + '.png') });
  // close again (click same header)
  await clickCard(id);
  await sleep(1200);
}
put('open_audit', { per: Object.fromEntries(Object.entries(openAudit).map(([k, v]) => [k, {
  hit: v.click.hit, opened: v.after.open, bgA: v.after.bgA, bf: v.after.bf, inView: v.after.inView,
  blurInside: v.audit.blurInside.length, solidInside: v.audit.solidInside,
  maxCentreBgA: v.centre.maxBgAlpha, paintedAtCentre: v.centre.paintedAtCentre.map((p) => p.el + '|a=' + p.bgA + '|bf=' + p.bf + '|f=' + p.filter),
}])), raw: { note: 'see open-*.png' } });

// ---------- 4) pp expanded: text overlap, button stacking, wheel scroll ----------
const pp = await (async () => {
  await clickCard('pp-toggles');
  await sleep(1500);
  const r = await page.evaluate(() => {
    const el = document.getElementById('pp-toggles');
    const vis = (e) => { const c = getComputedStyle(e); const b = e.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > .05 && b.width > 1 && b.height > 1; };
    const rects = [];
    for (const d of el.querySelectorAll('*')) {
      if (d.children.length || !vis(d)) continue;
      const t = (d.textContent || '').trim();
      if (!t) continue;
      const b = d.getBoundingClientRect();
      rects.push({ t: t.slice(0, 14), x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) });
    }
    // pairwise text overlap (>=35% of the smaller box)
    const overlaps = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (!ix || !iy) continue;
      const inter = ix * iy, smaller = Math.min(a.w * a.h, b.w * b.h);
      if (smaller > 0 && inter / smaller >= 0.35) overlaps.push({ a: a.t, b: b.t, frac: +(inter / smaller).toFixed(2) });
    }
    // button/slider rect stacking inside rows
    const btns = [...el.querySelectorAll('.pp-toggle-btn, .pp-mode-btn, .pp-toggle-group, .pp-slider-row')].filter(vis)
      .map((d) => { const b = d.getBoundingClientRect(); return { id: d.id || String(d.className).slice(0, 22), x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; });
    const btnOverlaps = [];
    for (let i = 0; i < btns.length; i++) for (let j = i + 1; j < btns.length; j++) {
      const a = btns[i], b = btns[j];
      const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      if (ix > 1 && iy > 1) btnOverlaps.push({ a: a.id, b: b.id, ix: +ix.toFixed(1), iy: +iy.toFixed(1) });
    }
    // is anything clipped horizontally?
    const cardR = el.getBoundingClientRect();
    const clipped = btns.filter((b) => b.x < cardR.x - 1 || b.x + b.w > cardR.right + 1);
    // text colour + background of every button
    const btnStyle = [...el.querySelectorAll('.pp-toggle-btn, .pp-mode-btn')].filter(vis).map((d) => {
      const c = getComputedStyle(d);
      const m = (c.color.match(/[\d.]+/g) || [255, 255, 255]).slice(0, 3).map(Number);
      const bgm = String(c.backgroundColor).match(/rgba?\(([^)]+)\)/);
      const bgA = bgm ? (bgm[1].split(',').length > 3 ? Number(bgm[1].split(',')[3]) : 1) : 0;
      return { id: d.id, color: c.color, luma: +(((0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255).toFixed(2)), bg: c.backgroundColor, bgA: +bgA.toFixed(2), shadow: c.boxShadow.slice(0, 60) };
    });
    return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
      cardRect: [+cardR.x.toFixed(0), +cardR.y.toFixed(0), +cardR.width.toFixed(0), +cardR.height.toFixed(0)],
      textNodes: rects.length, textOverlaps: overlaps, btnCount: btns.length, btnOverlaps, clipped,
      btnStyle, darkBtns: btnStyle.filter((b) => b.luma < 0.45), solidBtns: btnStyle.filter((b) => b.bgA > 0.2) };
  });
  // real wheel over the panel
  const box = await page.evaluate(() => { const b = document.getElementById('pp-toggles').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel({ deltaY: 300 });
  await sleep(500);
  const mid = await page.evaluate(() => document.getElementById('pp-toggles').scrollTop);
  await page.mouse.wheel({ deltaY: 300 });
  await sleep(500);
  const after = await page.evaluate(() => document.getElementById('pp-toggles').scrollTop);
  // header still visible/clickable while scrolled?
  const hdr = await page.evaluate(() => {
    const el = document.getElementById('pp-toggles');
    const h = el.querySelector('.pp-header-row, .panel-header');
    const b = h.getBoundingClientRect();
    const cardB = el.getBoundingClientRect();
    const inside = b.top >= cardB.top - 1 && b.bottom <= cardB.bottom + 1;
    const e = document.elementFromPoint(Math.round(b.x + 20), Math.round(b.y + b.height / 2));
    return { headerRect: [+b.x.toFixed(0), +b.y.toFixed(0), +b.width.toFixed(0), +b.height.toFixed(0)], insideCard: inside, hitOnHeader: !!(e && h.contains(e)), hitTag: e && e.tagName };
  });
  await page.screenshot({ path: path.join(OUT, 'pp-scrolled.png') });
  return { ...r, wheel: { before: r.scrollTop, mid, after }, headerWhileScrolled: hdr };
})();
put('pp', { scrollHeight: pp.scrollHeight, clientHeight: pp.clientHeight, wheel: pp.wheel, textNodes: pp.textNodes,
  textOverlaps: pp.textOverlaps, btnCount: pp.btnCount, btnOverlaps: pp.btnOverlaps.slice(0, 20), btnOverlapCount: pp.btnOverlaps.length,
  clipped: pp.clipped, darkBtns: pp.darkBtns, solidBtns: pp.solidBtns, headerWhileScrolled: pp.headerWhileScrolled, cardRect: pp.cardRect });

// ---------- 5) mutual exclusion with per-frame sampling ----------
const switchTest = async (from, to) => {
  // ensure from open
  const st0 = await stateAll();
  if (!st0[from].open) { await clickCard(from); await sleep(1200); }
  await page.evaluate(() => {
    window.__tl = []; window.__stop = false;
    const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel'];
    const tick = () => {
      if (window.__stop) return;
      const o = IDS.filter((i) => { const e = document.getElementById(i); return e && !e.classList.contains('collapsed'); });
      window.__tl.push(o.join(','));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await clickCard(to);
  await sleep(1400);
  const tl = await page.evaluate(() => { window.__stop = true; return window.__tl; });
  const maxLeft = Math.max(...tl.map((s) => s.split(',').filter((x) => GROUPS_LEFT.includes(x)).length));
  return { tl: tl.slice(0, 3).concat(['...']), frames: tl.length, distinct: [...new Set(tl)] };
};
// helper constant injection above needs GROUPS_LEFT in page scope: redefine inline
const switchTest2 = async (from, to) => {
  const st0 = await stateAll();
  if (!st0[from].open) { await clickCard(from); await sleep(1200); }
  await page.evaluate(() => {
    window.__tl = []; window.__stop = false;
    const L = ['data-panel', 'scene-panel'];
    const R = ['pp-toggles', 'cctv-panel', 'global-context-panel'];
    const tick = () => {
      if (window.__stop) return;
      const open = (ids) => ids.filter((i) => { const e = document.getElementById(i); return e && !e.classList.contains('collapsed'); }).length;
      window.__tl.push([open(L), open(R)].join('/'));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const c = await clickCard(to);
  await sleep(1500);
  const tl = await page.evaluate(() => { window.__stop = true; return window.__tl; });
  const st = await stateAll();
  const maxL = Math.max(...tl.map((s) => Number(s.split('/')[0])));
  const maxR = Math.max(...tl.map((s) => Number(s.split('/')[1])));
  const empty = tl.filter((s) => s === '0/0').length;
  return { case: from + '->' + to, hit: c.hit.card, frames: tl.length, maxLeft: maxL, maxRight: maxR, emptyFrames: empty,
    end: { [from]: st[from].open, [to]: st[to].open, fromHidden: st[from].hidden, toHidden: st[to].hidden } };
};
put('switch', [
  await switchTest2('data-panel', 'scene-panel'),
  await switchTest2('scene-panel', 'data-panel'),
  await switchTest2('pp-toggles', 'cctv-panel'),
  await switchTest2('cctv-panel', 'global-context-panel'),
  await switchTest2('global-context-panel', 'pp-toggles'),
]);

// ---------- 6) rapid taps ----------
const before = await stateAll();
const taps = [];
for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
  const c = await clickCard(id);
  taps.push(c.hit.card);
  await sleep(110);
}
await sleep(1800);
const afterRapid = await stateAll();
put('rapid', { taps, hitMismatch: taps.filter((h, i) => h !== ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'][i]),
  endOpen: Object.entries(afterRapid).filter(([, v]) => v && v.open).map(([k]) => k),
  outOfView: Object.entries(afterRapid).filter(([, v]) => v && !v.inView).map(([k]) => k) });

// ---------- 7) collapse everything, compare rects to initial ----------
for (const id of Object.keys(afterRapid)) {
  if (afterRapid[id] && afterRapid[id].open) { await clickCard(id); await sleep(900); }
}
await sleep(2500);
const collapsed = await stateAll();
const init = res.checks.initial;
const diff = [];
for (const id of CARDS) {
  if (!init[id] || !collapsed[id]) continue;
  const a = init[id].rect, b = collapsed[id].rect;
  const d = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  if (d > 1.5) diff.push({ id, init: a, now: b, delta: +d.toFixed(1) });
}
put('collapse', { stillOpen: Object.entries(collapsed).filter(([, v]) => v && v.open).map(([k]) => k), rectDiff: diff });

// ---------- 8) reload -> still all mini ----------
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(7000);
const reloaded = await stateAll();
put('reload', { openAfterReload: Object.entries(reloaded).filter(([, v]) => v && v.open).map(([k]) => k),
  bgAlpha: Object.fromEntries(CARDS.map((i) => [i, reloaded[i] ? reloaded[i].bgA : null])) });

// ---------- 9) fps @1536x730 ----------
const fps = await page.evaluate(() => new Promise((r) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else r({ frames: n, ms: Math.round(performance.now() - t0), fps: +(n / ((performance.now() - t0) / 1000)).toFixed(1) }); };
  requestAnimationFrame(tick);
}));
put('fps', fps);

put('trust', await page.evaluate(() => ({ down: window.__rv.down, downTrusted: window.__rv.downTrusted, click: window.__rv.click, clickTrusted: window.__rv.clickTrusted })));

res.finished = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify(res, null, 1));
await page.screenshot({ path: path.join(OUT, 'final-state.png') });
await browser.close();
console.log('WROTE', path.join(OUT, 'probe.json'));
