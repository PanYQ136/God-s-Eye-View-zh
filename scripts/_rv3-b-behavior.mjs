#!/usr/bin/env node
/**
 * _rv3-b-behavior.mjs — reviewer round-3 probe B (CONTRACT lens, own harness).
 *  mutex frames (left data<->scene, right pp<->cctv<->global), old-header click-back,
 *  pp wheel scroll + row spacing + transparent chips, rapid 16 taps, collapse restore,
 *  reload all-mini at t+3/8/15s, FPS.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r3');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { started: new Date().toISOString(), viewport: `${W}x${H}`, round: 3, lens: 'contract' };
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 1800)); };

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
  // per-frame mutex sampler installed in-page so we do not miss short frames
  window.__frames = [];
  window.__startSampler = () => {
    window.__frames = [];
    const L = ['data-panel', 'scene-panel'], RR = ['pp-toggles', 'cctv-panel', 'global-context-panel'];
    const st = (id) => {
      const el = document.getElementById(id); if (!el) return null;
      const c = getComputedStyle(el);
      return { open: !el.classList.contains('collapsed'), vis: c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05 };
    };
    const tick = () => {
      window.__frames.push({ t: performance.now(), l: L.filter((i) => (st(i) || {}).open), r: RR.filter((i) => (st(i) || {}).open),
        hiddenR: RR.filter((i) => { const s = st(i); return s && !s.vis; }), hiddenL: L.filter((i) => { const s = st(i); return s && !s.vis; }) });
      window.__raf = requestAnimationFrame(tick);
    };
    tick();
  };
  window.__stopSampler = () => { cancelAnimationFrame(window.__raf); return window.__frames; };
});
page.on('pageerror', (e) => (R.page_errors ||= []).push(String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9000);

const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const state = () => page.evaluate((IDS) => {
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id); if (!el) { o[id] = null; continue; }
    const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      open: !el.classList.contains('collapsed'), hidden: c.visibility === 'hidden' || c.display === 'none' || +c.opacity < 0.05,
      inView: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
  }
  return o;
}, CARDS);

const clickOwned = async (cardId, yFrac = null) => {
  const probe = await page.evaluate((cardId, yFrac) => {
    const el = document.getElementById(cardId); if (!el) return { ok: false };
    const er = el.getBoundingClientRect();
    const pts = [];
    if (yFrac != null) pts.push({ x: Math.round(er.x + er.width / 2), y: Math.round(er.y + er.height * yFrac) });
    for (const h of el.querySelectorAll('.panel-title, .pp-header-label, .location-toolbar-label, .dock-title, .panel-header')) {
      const r = h.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) pts.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    }
    pts.push({ x: Math.round(er.x + er.width / 2), y: Math.round(er.y + Math.min(12, er.height / 2)) });
    for (const p of pts) {
      const e = document.elementFromPoint(p.x, p.y);
      if (e && el.contains(e)) return { ok: true, at: [p.x, p.y], hit: e.tagName + '.' + String(e.className || '').split(' ')[0] };
    }
    return { ok: false };
  }, cardId, yFrac);
  if (!probe.ok) return { card: cardId, clicked: false };
  await page.mouse.move(probe.at[0], probe.at[1]); await sleep(70);
  await page.mouse.down(); await sleep(45); await page.mouse.up(); await sleep(600);
  return { card: cardId, clicked: true, preHit: probe.hit, at: probe.at };
};

const baseRects = await state();
put('baseline', baseRects);

// ---------- mutex: 5 switches with rAF frame sampling ----------
await page.evaluate(() => window.__startSampler());
const seq = ['data-panel', 'scene-panel', 'data-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'pp-toggles', 'cctv-panel'];
const clicks = [];
for (const id of seq) { clicks.push(await clickOwned(id)); await sleep(750); }
const frames = await page.evaluate(() => window.__stopSampler());
const gapFrames = [];
for (let i = 1; i < frames.length; i++) {
  if (frames[i].l.length !== frames[i - 1].l.length || frames[i].r.length !== frames[i - 1].r.length) gapFrames.push(frames[i]);
}
put('mutex', {
  clicks: clicks.map((c) => ({ card: c.card, ok: c.clicked, preHit: c.preHit })),
  frames: frames.length,
  maxLeft: Math.max(...frames.map((f) => f.l.length)),
  maxRight: Math.max(...frames.map((f) => f.r.length)),
  emptyFrames: frames.filter((f) => f.l.length === 0 && f.r.length === 0).length,
  hiddenRightFrames: frames.filter((f) => f.hiddenR.length).length,
  hiddenLeftFrames: frames.filter((f) => f.hiddenL.length).length,
  final: frames[frames.length - 1],
});
await page.screenshot({ path: path.join(OUT, 'R3-B-mutex-final.png') });

// ---------- old header click-back (contract: 旧卡 header 保持可见可点) ----------
const backTests = [];
// current: cctv open (right), scene closed? ensure left: click data then scene
await clickOwned('data-panel'); await sleep(600);
let cl = await clickOwned('scene-panel'); await sleep(700);
let st = await state();
backTests.push({ step: 'data->scene', clicked: cl.clicked, dataOpen: st['data-panel'].open, sceneOpen: st['scene-panel'].open, dataHidden: st['data-panel'].hidden });
const backClick = await clickOwned('data-panel'); await sleep(700);
st = await state();
backTests.push({ step: 'back-click-old-data-header', clicked: backClick.clicked, preHit: backClick.preHit, dataOpen: st['data-panel'].open, sceneOpen: st['scene-panel'].open, dataHidden: st['data-panel'].hidden });
// right rail: pp -> cctv -> click pp back
await clickOwned('pp-toggles'); await sleep(600);
const c2 = await clickOwned('cctv-panel'); await sleep(700);
const back2 = await clickOwned('pp-toggles'); await sleep(700);
st = await state();
backTests.push({ step: 'pp->cctv->back-pp', cctvClicked: c2.clicked, backClicked: back2.clicked, preHit: back2.preHit, ppOpen: st['pp-toggles'].open, cctvOpen: st['cctv-panel'].open, cctvHidden: st['cctv-panel'].hidden });
put('old_header_click_back', backTests);

// ---------- pp expanded layout + real wheel ----------
const ppOpen = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  return !el.classList.contains('collapsed');
});
if (!ppOpen) { await clickOwned('pp-toggles'); await sleep(800); }
const ppDetail = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  const rows = [...el.querySelectorAll('.pp-toggle-row, .pp-row, [class*="pp-toggle"], [class*="switch-row"]')];
  const uniq = [...new Set(rows)];
  const rects = uniq.map((e, i) => { const r = e.getBoundingClientRect(); return { i, y: +r.y.toFixed(1), b: +r.bottom.toFixed(1), h: +r.height.toFixed(1), t: (e.textContent || '').trim().slice(0, 14) }; });
  let minGap = Infinity;
  for (let i = 1; i < rects.length; i++) minGap = Math.min(minGap, rects[i].y - rects[i - 1].b);
  const btns = [...el.querySelectorAll('button, .pp-chip, [role="switch"]')];
  const dark = [], solid = [];
  const a = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return 0; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; };
  for (const b of btns) {
    const c = getComputedStyle(b);
    if (a(c.backgroundColor) > 0.35) solid.push({ t: (b.textContent || '').trim().slice(0, 12), bg: c.backgroundColor });
    const col = c.color.match(/\d+/g) || [];
    if (a(c.backgroundColor) > 0.35 && +col[0] + +col[1] + +col[2] < 200) dark.push({ t: (b.textContent || '').trim().slice(0, 12), bg: c.backgroundColor, color: c.color });
  }
  const er = el.getBoundingClientRect();
  const clipped = [];
  for (const r of rects) if (r.y < er.y - 1 || r.b > er.bottom + 1) clipped.push(r.i);
  return { rect: [+er.x.toFixed(0), +er.y.toFixed(0), +er.width.toFixed(0), +er.height.toFixed(0)], rows: rects.length, minGap: minGap === Infinity ? null : +minGap.toFixed(1),
    rowRects: rects, solidButtons: solid.slice(0, 6), darkButtons: dark.slice(0, 6), clippedWhenIdle: clipped,
    clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop,
    headerSticky: getComputedStyle(el.querySelector('.pp-header-row') || el).position };
});
const cx = ppDetail.rect[0] + Math.round(ppDetail.rect[2] / 2), cy = ppDetail.rect[1] + Math.round(ppDetail.rect[3] * 0.72);
await page.mouse.move(cx, cy); await sleep(150);
await page.mouse.wheel({ deltaY: 200 }); await sleep(400);
const s1 = await page.evaluate(() => document.getElementById('pp-toggles').scrollTop);
await page.mouse.wheel({ deltaY: 400 }); await sleep(400);
const s2 = await page.evaluate(() => document.getElementById('pp-toggles').scrollTop);
await page.mouse.wheel({ deltaY: 400 }); await sleep(400);
const s3 = await page.evaluate(() => document.getElementById('pp-toggles').scrollTop);
const ppScroll = { start: 0, after200: s1, after600: s2, after1000: s3 };
const ppBoxVisual = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  const rows = [...new Set([...el.querySelectorAll('.pp-toggle-row, .pp-row, [class*="pp-toggle"], [class*="switch-row"]')])];
  const er = el.getBoundingClientRect();
  const visRows = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.bottom > er.top && b.top < er.bottom; }).length;
  return { visibleRowsInViewport: visRows, totalRows: rows.length };
});
put('pp_expanded', { ...ppDetail, scroll: ppScroll, visual: ppBoxVisual });
await page.screenshot({ path: path.join(OUT, 'R3-B-pp-scrolled.png') });

// ---------- rapid taps (contract #5: 不乱跳/不叠/不遮挡/终态确定) ----------
const RAPID = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'data-panel', 'scene-panel', 'pp-toggles',
  'cctv-panel', 'global-context-panel', 'data-panel', 'pp-toggles', 'scene-panel', 'cctv-panel', 'global-context-panel', 'data-panel'];
const rapid = { taps: 0, missed: [], missedReason: [] };
for (const id of RAPID) {
  const probe = await page.evaluate((cardId) => {
    const el = document.getElementById(cardId); if (!el) return { ok: false };
    const er = el.getBoundingClientRect();
    const pts = [{ x: Math.round(er.x + er.width / 2), y: Math.round(er.y + Math.min(12, er.height / 2)) }];
    for (const h of el.querySelectorAll('.panel-title, .pp-header-label, .location-toolbar-label, .dock-title, .panel-header')) {
      const r = h.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) pts.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    }
    for (const p of pts) {
      const e = document.elementFromPoint(p.x, p.y);
      if (e && el.contains(e)) return { ok: true, at: [p.x, p.y] };
    }
    const e0 = document.elementFromPoint(pts[0].x, pts[0].y);
    return { ok: false, blockedBy: e0 && e0.tagName + '.' + String(e0.className || '').split(' ')[0], owner: e0 && e0.closest('.gev-lc') ? e0.closest('.gev-lc').id : null };
  }, id);
  if (!probe.ok) { rapid.missed.push(id); rapid.missedReason.push({ id, blockedBy: probe.blockedBy, owner: probe.owner }); continue; }
  await page.mouse.move(probe.at[0], probe.at[1]);
  await page.mouse.down(); await page.mouse.up();
  rapid.taps++;
  await sleep(40); // deliberately fast, no settle wait
}
await sleep(1600);
const rapidState = await state();
const overlaps = [];
const rs = Object.entries(rapidState).filter(([, v]) => v);
for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
  const [ia, a] = rs[i], [ib, b] = rs[j];
  const ix = Math.max(0, Math.min(a.rect[0] + a.rect[2], b.rect[0] + b.rect[2]) - Math.max(a.rect[0], b.rect[0]));
  const iy = Math.max(0, Math.min(a.rect[1] + a.rect[3], b.rect[1] + b.rect[3]) - Math.max(a.rect[1], b.rect[1]));
  if (ix * iy > 20) overlaps.push({ a: ia, b: ib, area: Math.round(ix * iy) });
}
put('rapid', { ...rapid, expandedEnd: Object.entries(rapidState).filter(([, v]) => v.open).map(([k]) => k),
  overlaps, outOfView: Object.entries(rapidState).filter(([, v]) => v && !v.inView).map(([k]) => k),
  mutexEnd: { left: ['data-panel', 'scene-panel'].filter((i) => rapidState[i].open), right: ['pp-toggles', 'cctv-panel', 'global-context-panel'].filter((i) => rapidState[i].open) } });
await page.screenshot({ path: path.join(OUT, 'R3-B-rapid.png') });

// ---------- collapse all -> mini baseline ----------
for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
  const s0 = await state();
  if (s0[id].open) { await clickOwned(id); await sleep(500); }
}
await sleep(1200);
const collapsed = await state();
const collapseDiff = [];
for (const id of CARDS) {
  if (!baseRects[id] || !collapsed[id]) continue;
  const d = collapsed[id].rect.map((v, i) => +(v - baseRects[id].rect[i]).toFixed(1));
  if (d.some((v) => Math.abs(v) > 1)) collapseDiff.push({ id, base: baseRects[id].rect, now: collapsed[id].rect, d });
}
put('collapse', { diff: collapseDiff, allMini: Object.entries(collapsed).every(([k, v]) => ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'].includes(k) ? !v.open : true) });
await page.screenshot({ path: path.join(OUT, 'R3-B-collapsed.png') });

// ---------- FPS ----------
const fps = await page.evaluate(() => new Promise((res) => {
  const samples = [];
  let last = performance.now(), frames = 0, t0 = last;
  const tick = () => {
    frames++;
    const now = performance.now();
    if (now - last >= 250) { samples.push(frames * 1000 / (now - last)); frames = 0; last = now; }
    if (now - t0 < 4000) requestAnimationFrame(tick); else res(samples);
  };
  requestAnimationFrame(tick);
}));
fps.sort((a, b) => a - b);
put('fps', { median: +fps[Math.floor(fps.length / 2)].toFixed(1), min: +fps[0].toFixed(1), max: +fps[fps.length - 1].toFixed(1), samples: fps.map((v) => +v.toFixed(1)) });

// ---------- reload: must stay all mini ----------
const reloadCheck = {};
for (const wait of [3000, 5000, 7000]) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(wait);
  const st2 = await page.evaluate((IDS) => {
    const out = {};
    for (const id of IDS) { const el = document.getElementById(id); if (!el) continue; out[id] = { open: !el.classList.contains('collapsed'), rect: [+el.getBoundingClientRect().x.toFixed(1), +el.getBoundingClientRect().y.toFixed(1), +el.getBoundingClientRect().width.toFixed(1), +el.getBoundingClientRect().height.toFixed(1)] }; }
    return out;
  }, CARDS);
  reloadCheck['t+' + wait] = { expanded: Object.entries(st2).filter(([, v]) => v.open).map(([k]) => k), rectDiff: Object.entries(st2).filter(([k, v]) => baseRects[k] && v.rect.some((x, i) => Math.abs(x - baseRects[k].rect[i]) > 1)).map(([k]) => k) };
  if (wait === 3000) await page.screenshot({ path: path.join(OUT, 'R3-B-reloaded.png') });
}
put('reload', reloadCheck);
put('pointer_trust', await page.evaluate(() => window.__rv));
R.finished = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'B-behavior.json'), JSON.stringify(R, null, 1));
console.log('WROTE', path.join(OUT, 'B-behavior.json'));
await browser.close();

