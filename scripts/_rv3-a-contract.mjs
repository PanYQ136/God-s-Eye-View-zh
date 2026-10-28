#!/usr/bin/env node
/**
 * _rv3-a-contract.mjs — reviewer round-3 probe A (CONTRACT lens, own harness).
 * Strict audit of the ORIGINAL task body + requirement doc, plus re-test of every
 * item from prior kanban_request_changes rounds (r1: 10 chrome targets, r2: toast/chips).
 *  - initial: 9 cards all mini, shell alpha, pagewide material inventory, X glyphs
 *  - 7 headers real-mouse open (rect-center + PRE-click elementFromPoint ownership)
 *  - expanded: center 5-point sampling, inner backdrop-filter, block-level solid inventory
 *  - chrome computed values for r1 (10+1) and r2 (4 status) targets
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r3');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];

const R = { started: new Date().toISOString(), viewport: `${W}x${H}`, round: 3, lens: 'contract' };
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 2000)); };

const ALPHA = `(c)=>{const s=String(c);if(/^rgba?\\(/.test(s)){const p=s.match(/rgba?\\(([^)]+)\\)/)[1].split(/[,\\s\\/]+/).filter(Boolean).map(Number);return p.length>3?p[3]:1;}return 0;}`;

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
});
page.on('console', (m) => { if (m.type() === 'error') (R.console_errors ||= []).push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => (R.page_errors ||= []).push(String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9000);

const cardState = () => page.evaluate((IDS, ALPHA_SRC) => {
  const a = new Function('c', ALPHA_SRC);
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id);
    if (!el) { o[id] = null; continue; }
    const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    o[id] = {
      rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      open: !el.classList.contains('collapsed'),
      hidden: c.visibility === 'hidden' || c.display === 'none' || +c.opacity < 0.05,
      bg: c.backgroundColor, bgA: +a(c.backgroundColor).toFixed(3), bf: c.backdropFilter,
      bgImg: c.backgroundImage.slice(0, 60),
      inView: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
    };
  }
  return o;
}, CARDS, ALPHA.replace(/^\(c\)=>\{/, '').replace(/\}$/, ''));

const materialScan = () => page.evaluate((ALPHA_SRC) => {
  const a = new Function('c', ALPHA_SRC);
  const vis = (el) => {
    const c = getComputedStyle(el); const r = el.getBoundingClientRect();
    return c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05 && r.width > 1 && r.height > 1;
  };
  const frosted = [], dark = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const c = getComputedStyle(el);
    const bf = c.backdropFilter || c.webkitBackdropFilter || 'none';
    if (bf && bf !== 'none' && !/blur\(0px\)/.test(bf)) frosted.push({ sel: el.tagName + '#' + el.id + '.' + String(el.className || '').split(' ')[0], bf });
    const r = el.getBoundingClientRect();
    const alpha = a(c.backgroundColor);
    const hasGrad = c.backgroundImage !== 'none';
    const area = r.width * r.height;
    const inCard = !!el.closest('.gev-lc');
    if (alpha > 0.2 && area > 300 && !inCard) dark.push({ sel: el.tagName + '#' + el.id + '.' + String(el.className || '').split(' ')[0], bg: c.backgroundColor, area: Math.round(area) });
    if (hasGrad && alpha > 0.2 && area > 900 && !inCard) dark.push({ sel: 'GRAD ' + el.tagName + '#' + el.id, bg: c.backgroundImage.slice(0, 50), area: Math.round(area) });
  }
  let xGlyph = 0; const xWhere = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (!/[✕✖✗×]/.test(n.nodeValue || '')) continue;
    const p = n.parentElement;
    if (p && vis(p)) { xGlyph++; if (xWhere.length < 6) xWhere.push(p.tagName + '#' + p.id + '.' + String(p.className || '').split(' ')[0]); }
  }
  return {
    frosted, dark, xGlyph, xWhere,
    closeBtn: document.querySelectorAll('.gev-lc-close').length,
    xExternal: [...document.querySelectorAll('.gd-x, [class*="close"]')].filter((e) => vis(e) && /✕|✖|×/.test(e.textContent || '')).length,
  };
}, ALPHA.replace(/^\(c\)=>\{/, '').replace(/\}$/, ''));

// ---------- 1. initial state (contract: initial ALL MINI, center transparent, no X) ----------
put('initial_cards', await cardState());
put('initial_material', await materialScan());
await page.screenshot({ path: path.join(OUT, 'R3-A-initial.png') });

// geometry vs previous round baseline (proves the r2 fixes did not move the mini baseline)
try {
  const prev = JSON.parse(fs.readFileSync('.gev-logs/review-t829-r2/C-matrix.json', 'utf8'));
  const base = prev.initial || {};
  const cur = R.initial_cards;
  const diffs = [];
  for (const id of CARDS) {
    if (!base[id] || !cur[id]) continue;
    const d = cur[id].rect.map((v, i) => +(v - base[id].rect[i]).toFixed(1));
    if (d.some((v) => Math.abs(v) > 1)) diffs.push({ id, prev: base[id].rect, now: cur[id].rect, d });
  }
  put('rect_vs_prev_round', { diffs, identical: diffs.length === 0 });
} catch (e) { put('rect_vs_prev_round', { error: String(e).slice(0, 120) }); }

// ---------- 2. chrome inventory: r1 targets (10+1) + r2 status targets ----------
const chromeTargets = () => page.evaluate((ALPHA_SRC) => {
  const a = new Function('c', ALPHA_SRC);
  const ids = ['clear-selected-layers', 'share-btn', 'tilt-map-view', 'north-up-view', 'reset-globe-view',
    'key-setup-chip', 'gev-lang-toggle', 'gev-locate-btn', 'gev-perf-btn', 'gev-perf-fps', 'gev-toast', 'gev-dossier',
    'toast', 'global-loading-status', 'traffic-sync-chip', 'cctv-sync-chip'];
  const o = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) { o[id] = null; continue; }
    const c = getComputedStyle(el); const r = el.getBoundingClientRect();
    o[id] = { bg: c.backgroundColor, bgA: +a(c.backgroundColor).toFixed(3), bgImg: c.backgroundImage === 'none' ? 'none' : c.backgroundImage.slice(0, 40),
      bf: (c.backdropFilter || 'none'), rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)],
      vis: c.display !== 'none' && c.visibility !== 'hidden' };
  }
  return o;
}, ALPHA.replace(/^\(c\)=>\{/, '').replace(/\}$/, ''));
put('chrome_computed_idle', await chromeTargets());

// ---------- 3. 7 headers, real mouse, rect-center + PRE-click ownership ----------
const HEADERS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const clickOwned = async (cardId) => {
  const probe = await page.evaluate((cardId) => {
    const el = document.getElementById(cardId);
    if (!el) return { ok: false };
    const cands = [...el.querySelectorAll('.panel-title, .pp-header-label, .location-toolbar-label, .dock-title, .panel-header, .pp-header-row, .location-toolbar')];
    const pts = [];
    for (const h of cands) {
      const r = h.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      pts.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    }
    const er = el.getBoundingClientRect();
    pts.push({ x: Math.round(er.x + er.width / 2), y: Math.round(er.y + Math.min(12, er.height / 2)) });
    for (const p of pts) {
      const e = document.elementFromPoint(p.x, p.y);
      if (e && el.contains(e)) return { ok: true, at: [p.x, p.y], hit: e.tagName + '.' + String(e.className || '').split(' ')[0], owner: (e.closest('.gev-lc') || {}).id || null };
    }
    const e0 = document.elementFromPoint(pts[0].x, pts[0].y);
    return { ok: false, tried: pts.length, firstHit: e0 && e0.tagName + '.' + String(e0.className || '').split(' ')[0], owner: e0 && e0.closest('.gev-lc') && e0.closest('.gev-lc').id };
  }, cardId);
  if (!probe.ok) return { card: cardId, clicked: false, probe };
  await page.mouse.move(probe.at[0], probe.at[1]); await sleep(80);
  await page.mouse.down(); await sleep(50); await page.mouse.up(); await sleep(650);
  return { card: cardId, clicked: true, preHit: probe.hit, preOwner: probe.owner };
};

const openResults = [];
for (const id of HEADERS) {
  const c = await clickOwned(id);
  const st = await cardState();
  const center = await page.evaluate((id, ALPHA_SRC) => {
    const a = new Function('c', ALPHA_SRC);
    const el = document.getElementById(id); const r = el.getBoundingClientRect();
    const pts = [[0.5, 0.5], [0.3, 0.4], [0.7, 0.4], [0.5, 0.75], [0.5, 0.25]];
    let maxA = 0; const det = [];
    for (const [fx, fy] of pts) {
      const x = Math.round(r.x + r.width * fx), y = Math.round(r.y + r.height * fy);
      const e = document.elementFromPoint(x, y);
      // walk up to the glass layer inside this card, sampling each ancestor's own bg
      let cur = e, worst = 0, wsel = '';
      while (cur && cur !== document.body) {
        const c = getComputedStyle(cur);
        const al = a(c.backgroundColor) * (c.backgroundImage !== 'none' ? 1 : 1);
        if (al > worst) { worst = al; wsel = cur.tagName + '.' + String(cur.className || '').split(' ')[0]; }
        if (cur.closest('.gev-lc') !== el.closest('.gev-lc')) break;
        cur = cur.parentElement;
      }
      det.push({ p: [x, y], hit: e && e.tagName + '.' + String(e.className || '').split(' ')[0], worstA: +worst.toFixed(3), worstSel: wsel });
      if (worst > maxA) maxA = worst;
    }
    const inner = [];
    for (const e of el.querySelectorAll('*')) {
      const c = getComputedStyle(e);
      const bf = c.backdropFilter || 'none';
      if (bf && bf !== 'none' && !/blur\(0px\)/.test(bf)) inner.push({ sel: e.tagName + '.' + String(e.className || '').split(' ')[0], bf });
    }
    const solids = [];
    for (const e of el.querySelectorAll('*')) {
      const c = getComputedStyle(e); const rr = e.getBoundingClientRect();
      const al = a(c.backgroundColor);
      if (al > 0.2 && rr.width * rr.height > 300 && c.display !== 'none' && +c.opacity > 0.05) {
        solids.push({ sel: e.tagName + '.' + String(e.className || '').split(' ')[0], bg: c.backgroundColor, area: Math.round(rr.width * rr.height) });
      }
    }
    return { maxBgAlpha: +maxA.toFixed(3), points: det, innerBf: inner.slice(0, 6), innerBfCount: inner.length, solids: solids.slice(0, 6) };
  }, id, ALPHA.replace(/^\(c\)=>\{/, '').replace(/\}$/, ''));
  openResults.push({ ...c, open: st[id] && st[id].open, hidden: st[id] && st[id].hidden, inView: st[id] && st[id].inView, bgA: st[id] && st[id].bgA, center });
  await page.screenshot({ path: path.join(OUT, `R3-A-open-${id}.png`) });
  // contract: close it again before the next header (7 headers each must open their own card)
  await clickOwned(id); await sleep(400);
}
put('seven_headers', openResults.map((x) => ({ card: x.card, clicked: x.clicked, preHit: x.preHit, preOwner: x.preOwner, open: x.open, hidden: x.hidden, inView: x.inView, bgA: x.bgA,
  maxCenterAlpha: x.center && x.center.maxBgAlpha, innerBf: x.center && x.center.innerBfCount, solids: x.center && x.center.solids })));

put('pointer_trust', await page.evaluate(() => window.__rv));
R.finished = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'A-contract.json'), JSON.stringify(R, null, 1));
console.log('WROTE', path.join(OUT, 'A-contract.json'));
await browser.close();
