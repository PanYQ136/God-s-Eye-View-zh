#!/usr/bin/env node
/**
 * _rv2-t829-matrix.mjs — reviewer round-2 probe C (execution lens, own harness):
 *  (1) trigger the global status toast and measure it (dark frosted residual?)
 *  (2) 7 headers real click open + material checks
 *  (3) left/right mutual exclusion frame sampling
 *  (4) pp wheel scroll
 *  (5) collapse restore + reload all-mini
 *  (6) dock-spill voice card vs right-rail header occlusion (acceptance #5 遮挡)
 *  (7) FPS
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r2');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CARD_IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];

const R = { started: new Date().toISOString(), viewport: `${W}x${H}`, checks: {} };
const put = (k, v) => { R.checks[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 1600)); };

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
  window.__rv = { down: 0, downT: 0, click: 0, clickT: 0 };
  for (const t of ['pointerdown', 'click']) {
    document.addEventListener(t, (e) => {
      if (t === 'pointerdown') { window.__rv.down++; if (e.isTrusted) window.__rv.downT++; }
      else { window.__rv.click++; if (e.isTrusted) window.__rv.clickT++; }
    }, true);
  }
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(8000);

const alphaOf = (c) => {
  const s = String(c);
  if (/^rgba?\(/.test(s)) { const p = s.match(/rgba?\(([^)]+)\)/)[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; }
  return 0;
};

const cardState = () => page.evaluate((IDS) => {
  const a = (c) => { const s = String(c); if (/^rgba?\(/.test(s)) { const p = s.match(/rgba?\(([^)]+)\)/)[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; } return 0; };
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id);
    if (!el) { o[id] = null; continue; }
    const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      open: !el.classList.contains('collapsed'),
      hidden: c.visibility === 'hidden' || c.display === 'none' || +c.opacity < .05,
      bgA: +a(c.backgroundColor).toFixed(3), bf: c.backdropFilter,
      inView: r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
  }
  return o;
}, CARD_IDS);

// ---------- (1) trigger the global #toast ----------
put('initial', await cardState());
await page.evaluate(() => { const t = document.getElementById('toast'); if (t) { t.textContent = 'REVIEW PROBE TOAST'; t.classList.add('visible'); } });
await sleep(400);
put('toast_visible_state', await page.evaluate(() => {
  const el = document.getElementById('toast'); if (!el) return null;
  const c = getComputedStyle(el); const r = el.getBoundingClientRect();
  const a = (s) => { if (/^rgba?\(/.test(String(s))) { const p = String(s).match(/rgba?\(([^)]+)\)/)[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; } return 0; };
  return { rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)],
    bg: c.backgroundColor, bgA: +a(c.backgroundColor).toFixed(2), bf: c.backdropFilter,
    color: c.color, opacity: c.opacity, visibility: c.visibility, text: el.textContent };
}));
await page.screenshot({ path: path.join(OUT, 'C-toast-visible.png'), clip: { x: 600, y: 560, width: 340, height: 110 } });
await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.classList.remove('visible'); });
await sleep(400);

// ---------- (2) 7 headers via real mouse ----------
const HEADERS = [
  { card: 'data-panel', sel: '.panel-header, .panel-title' },
  { card: 'scene-panel', sel: '.panel-header, .panel-title' },
  { card: 'pp-toggles', sel: '.pp-header-row, .pp-header-label' },
  { card: 'cctv-panel', sel: '.panel-header, .panel-title' },
  { card: 'global-context-panel', sel: '.panel-header, .panel-title' },
  { card: 'location-bar', sel: '.location-toolbar-label, .location-toolbar, .panel-title' },
  { card: 'control-panel', sel: '.panel-header, .dock-title' },
];

const preHitClick = async (cardId, sel) => {
  const pts = await page.evaluate((cardId, sel) => {
    const el = document.getElementById(cardId); if (!el) return [];
    const cands = [el.querySelector(sel), el.querySelector('.panel-header'), el.querySelector('.pp-header-row'), el].filter(Boolean);
    const out = [];
    for (const h of cands) {
      const r = h.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const title = h.querySelector('span, .panel-title, .pp-header-label, .location-toolbar-label');
      if (title) { const tr = title.getBoundingClientRect(); out.push({ x: Math.round(tr.x + tr.width / 2), y: Math.round(tr.y + tr.height / 2) }); }
      for (const fx of [0.08, 0.5, 0.9]) out.push({ x: Math.round(r.x + r.width * fx), y: Math.round(r.y + r.height / 2) });
    }
    return out.map((p) => {
      const e = document.elementFromPoint(p.x, p.y);
      return { ...p, ok: !!(e && el.contains(e)), hitTag: e && e.tagName, hitCls: e && String(e.className || '').slice(0, 28), hitId: e && e.id };
    });
  }, cardId, sel);
  const good = pts.find((p) => p.ok);
  if (!good) return { card: cardId, clicked: false, tried: pts.slice(0, 3) };
  await page.mouse.move(good.x, good.y); await sleep(70);
  await page.mouse.down(); await sleep(45); await page.mouse.up(); await sleep(500);
  return { card: cardId, clicked: true, at: [good.x, good.y], preHit: good.hitTag + '.' + good.hitCls };
};

const openResults = [];
for (const h of HEADERS) {
  const c = await preHitClick(h.card, h.sel);
  const st = await cardState();
  c.state = st[h.card];
  openResults.push(c);
  await page.screenshot({ path: path.join(OUT, `C-open-${h.card}.png`) });
}
put('seven_headers', openResults.map((x) => ({ card: x.card, clicked: x.clicked, at: x.at, preHit: x.preHit, open: x.state && x.state.open, hidden: x.state && x.state.hidden, inView: x.state && x.state.inView, bgA: x.state && x.state.bgA, bf: x.state && x.state.bf, triedCount: x.tried ? x.tried.length : 0 })));

// ---------- (3) mutual exclusion frame sampling ----------
const frameStates = async (ms) => {
  const out = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    out.push(await page.evaluate(() => {
      const L = ['data-panel', 'scene-panel'], Rr = ['pp-toggles', 'cctv-panel', 'global-context-panel'];
      const op = (id) => { const el = document.getElementById(id); if (!el) return false; const c = getComputedStyle(el); return !el.classList.contains('collapsed') && c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > .05; };
      return { l: L.filter(op), r: Rr.filter(op), hiddenR: Rr.filter((id) => { const el = document.getElementById(id); if (!el) return false; const c = getComputedStyle(el); return c.visibility === 'hidden' || +c.opacity < .05; }) };
    }));
    await sleep(60);
  }
  return out;
};
const mutexSteps = [];
const clickCard = async (id) => { const r = await preHitClick(id, '.panel-header'); mutexSteps.push({ clicked: id, ok: r.clicked, preHit: r.preHit }); return r; };
await clickCard('data-panel'); const fa = await frameStates(900);
await clickCard('scene-panel'); const fb = await frameStates(900);
await clickCard('pp-toggles'); const fc = await frameStates(900);
await clickCard('cctv-panel'); const fd = await frameStates(900);
await clickCard('global-context-panel'); const fe = await frameStates(900);
const frames = [...fa, ...fb, ...fc, ...fd, ...fe];
put('mutex', {
  steps: mutexSteps,
  frames: frames.length,
  maxLeft: Math.max(...frames.map((f) => f.l.length)),
  maxRight: Math.max(...frames.map((f) => f.r.length)),
  emptyFrames: frames.filter((f) => f.l.length === 0 && f.r.length === 0).length,
  hiddenRightFrames: frames.filter((f) => f.hiddenR.length).length,
  final: frames[frames.length - 1],
});

// ---------- (6) dock spill vs right rail header occlusion ----------
await page.evaluate(() => {});
put('occlusion', await page.evaluate(() => {
  const ids = ['pp-toggles', 'cctv-panel', 'global-context-panel', 'control-panel', 'gev-voice-control'];
  const st = {};
  for (const id of ids) { const el = document.getElementById(id); if (!el) { st[id] = null; continue; } const r = el.getBoundingClientRect(); st[id] = { rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)], open: !el.classList.contains('collapsed') }; }
  const hits = {};
  for (const id of ['cctv-panel', 'global-context-panel', 'pp-toggles']) {
    const el = document.getElementById(id); if (!el) continue;
    const r = el.getBoundingClientRect();
    const hx = Math.round(r.x + r.width * 0.5), hy = Math.round(r.y + 10);
    const e = document.elementFromPoint(hx, hy);
    hits[id] = { at: [hx, hy], hit: e && (e.tagName + '.' + String(e.className || '').slice(0, 26)), owner: e && e.closest('.gev-lc') && e.closest('.gev-lc').id, ownHeader: !!(e && el.contains(e)) };
  }
  return { st, hits };
}));
await page.screenshot({ path: path.join(OUT, 'C-occlusion.png') });

// ---------- (4) pp scroll ----------
await clickCard('pp-toggles'); await sleep(700);
const ppBox = await page.evaluate(() => { const el = document.getElementById('pp-toggles'); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height * 0.7), h: Math.round(r.height), ch: el.clientHeight, sh: el.scrollHeight, st: el.scrollTop }; });
await page.mouse.move(ppBox.x, ppBox.y); await sleep(120);
await page.mouse.wheel({ deltaY: 220 }); await sleep(350);
const s1 = await page.evaluate(() => document.getElementById('pp-toggles').scrollTop);
await page.mouse.wheel({ deltaY: 400 }); await sleep(350);
const s2 = await page.evaluate(() => document.getElementById('pp-toggles').scrollTop);
put('pp_scroll', { box: ppBox, after220: s1, after620: s2, rows: await page.evaluate(() => document.querySelectorAll('#pp-toggles .pp-toggle-row, #pp-toggles [class*="toggle"]').length) });
await page.screenshot({ path: path.join(OUT, 'C-pp-scrolled.png') });

// ---------- (5) collapse all + restore ----------
const baseline = await cardState();
const collapseAll = async () => {
  for (const h of HEADERS) {
    const st = await cardState();
    if (st[h.card] && st[h.card].open) { await preHitClick(h.card, h.sel); await sleep(350); }
  }
};
await collapseAll(); await sleep(1200);
const afterCollapse = await cardState();
put('collapse', {
  diff: Object.keys(baseline).filter((k) => baseline[k] && afterCollapse[k] && JSON.stringify(baseline[k].rect) !== JSON.stringify(afterCollapse[k].rect)).map((k) => ({ k, before: baseline[k].rect, after: afterCollapse[k].rect })),
  stillOpen: Object.keys(afterCollapse).filter((k) => afterCollapse[k] && afterCollapse[k].open),
});
await page.screenshot({ path: path.join(OUT, 'C-collapsed.png') });

// ---------- reload ----------
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(9000);
put('reload', await cardState());
await page.screenshot({ path: path.join(OUT, 'C-reloaded.png') });

// ---------- (7) FPS ----------
const fps = await page.evaluate(() => new Promise((res) => {
  const marks = [];
  let last = performance.now();
  const tick = (t) => { marks.push(t - last); last = t; if (marks.length < 300) requestAnimationFrame(tick); else res(marks); };
  requestAnimationFrame(tick);
}));
const sorted = [...fps].sort((a, b) => a - b);
put('fps', { frames: fps.length, medianFrameMs: +sorted[Math.floor(sorted.length / 2)].toFixed(2), medianFps: +(1000 / sorted[Math.floor(sorted.length / 2)]).toFixed(1) });
put('pointerTrust', await page.evaluate(() => window.__rv));

fs.writeFileSync(path.join(OUT, 'C-matrix.json'), JSON.stringify(R, null, 1));
await browser.close();
