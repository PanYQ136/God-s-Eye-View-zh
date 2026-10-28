#!/usr/bin/env node
/**
 * _rv2-t829-confirm.mjs — reviewer round-2 probe D: two blocker confirmations
 *  (1) #toast reached by a REAL mouse click on the now-transparent #tilt-map-view:
 *      measure its computed surface while it is naturally visible + crop a shot.
 *  (2) right-rail header occlusion by the dock-spill voice card: with
 *      control-panel (dock) expanded, real-click the global header and see where
 *      the click actually lands (pre-click hit test, then post state).
 * Also re-does the 7-header click test with card-rect targeting (probe C mis-hit
 * data-panel because it picked an off-layout title node).
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r2');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const R = { started: new Date().toISOString() };
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 1500)); };

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
  window.__rv = { down: 0, downT: 0, click: 0, clickT: 0, last: [] };
  for (const t of ['pointerdown', 'click']) {
    document.addEventListener(t, (e) => {
      const o = window.__rv;
      if (t === 'pointerdown') { o.down++; if (e.isTrusted) o.downT++; }
      else { o.click++; if (e.isTrusted) o.clickT++; }
      const c = e.target && e.target.closest ? e.target.closest('.gev-lc') : null;
      o.last.push({ t, trusted: e.isTrusted, id: c && c.id, tag: e.target && e.target.tagName });
      if (o.last.length > 40) o.last.shift();
    }, true);
  }
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(8000);

const cardState = () => page.evaluate((IDS) => {
  const a = (c) => { if (/^rgba?\(/.test(String(c))) { const p = String(c).match(/rgba?\(([^)]+)\)/)[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; } return 0; };
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id); if (!el) { o[id] = null; continue; }
    const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      open: !el.classList.contains('collapsed'), hidden: c.visibility === 'hidden' || c.display === 'none' || +c.opacity < .05,
      bgA: +a(c.backgroundColor).toFixed(3), inView: r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
  }
  return o;
}, CARDS);

// click the card's own visible rect centre (mini chip == header), with a PRE-click hit test
const clickCardCentre = async (id) => {
  const info = await page.evaluate((id) => {
    const el = document.getElementById(id); if (!el) return null;
    const r = el.getBoundingClientRect();
    const pt = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    const e = document.elementFromPoint(pt.x, pt.y);
    const owner = e && e.closest('.gev-lc');
    return { pt, hitTag: e && e.tagName, hitCls: e && String(e.className || '').slice(0, 30),
      hitOwner: owner && owner.id, own: !!(e && el.contains(e)), rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)] };
  }, id);
  if (!info) return { id, ok: false };
  await page.mouse.move(info.pt.x, info.pt.y); await sleep(80);
  await page.mouse.down(); await sleep(45); await page.mouse.up(); await sleep(600);
  return { id, ...info };
};

// ---------- (1) natural #toast via real click on #tilt-map-view ----------
const tiltBefore = await page.evaluate(() => document.getElementById('tilt-map-view').getAttribute('aria-pressed'));
const tiltPt = await page.evaluate(() => { const r = document.getElementById('tilt-map-view').getBoundingClientRect(); return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; });
await page.mouse.move(tiltPt[0], tiltPt[1]); await sleep(80);
await page.mouse.down(); await sleep(45); await page.mouse.up(); await sleep(320);
const toastNatural = await page.evaluate(() => {
  const el = document.getElementById('toast'); if (!el) return null;
  const c = getComputedStyle(el); const r = el.getBoundingClientRect();
  const a = (s) => { if (/^rgba?\(/.test(String(s))) { const p = String(s).match(/rgba?\(([^)]+)\)/)[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; } return 0; };
  return { text: el.textContent, cls: el.className, rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)],
    bg: c.backgroundColor, bgA: +a(c.backgroundColor).toFixed(2), bf: c.backdropFilter, opacity: c.opacity, visibility: c.visibility,
    color: c.color, boxShadow: String(c.boxShadow).slice(0, 60) };
});
put('toast_after_real_tilt_click', { tiltPressedBefore: tiltBefore, tiltPressedAfter: await page.evaluate(() => document.getElementById('tilt-map-view').getAttribute('aria-pressed')), toast: toastNatural });
if (toastNatural && toastNatural.rect[2] > 4) {
  const t = toastNatural.rect;
  await page.screenshot({ path: path.join(OUT, 'D-toast-natural.png'), clip: { x: Math.max(0, t[0] - 40), y: Math.max(0, t[1] - 30), width: Math.min(400, t[2] + 80), height: t[3] + 60 } });
}
await page.screenshot({ path: path.join(OUT, 'D-after-tilt.png') });
// restore tilt
await page.mouse.move(tiltPt[0], tiltPt[1]); await sleep(60); await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(400);

// ---------- (2a) 7 headers with card-rect targeting ----------
const seven = [];
for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
  const c = await clickCardCentre(id);
  const st = await cardState();
  // a clicked card toggles: if it was open, we closed it — record resulting state honestly
  seven.push({ id, preHit: c.hitTag + '.' + c.hitCls, hitOwner: c.hitOwner, ownHit: c.own, at: c.pt, openAfter: st[id] && st[id].open, hiddenAfter: st[id] && st[id].hidden, bgA: st[id] && st[id].bgA });
  await sleep(250);
}
put('seven_headers_cardrect', seven);
put('trust_after_seven', await page.evaluate(() => { const o = window.__rv; return { down: o.down, downT: o.downT, click: o.click, clickT: o.clickT }; }));

// ---------- (2b) occlusion: expand dock control-panel, then click global header ----------
// make sure everything is collapsed first
for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
  const st = await cardState(); if (st[id] && st[id].open) { await clickCardCentre(id); await sleep(350); }
}
await sleep(600);
const dockClick = await clickCardCentre('control-panel');
await sleep(900);
let st = await cardState();
put('dock_expanded', { clicked: dockClick, control: st['control-panel'], voice: st['gev-voice-control'] });

// now real-click the global header at its own centre and see what the browser hits
const globalHit = await page.evaluate(() => {
  const el = document.getElementById('global-context-panel'); const r = el.getBoundingClientRect();
  const pts = [[Math.round(r.x + r.width * 0.5), Math.round(r.y + 10)], [Math.round(r.x + r.width * 0.5), Math.round(r.y + r.height / 2)], [Math.round(r.x + 12), Math.round(r.y + 10)]];
  return pts.map((p) => { const e = document.elementFromPoint(p[0], p[1]); const o = e && e.closest('.gev-lc'); return { pt: p, hit: e && (e.tagName + '.' + String(e.className || '').slice(0, 28)), owner: o && o.id, isGlobalChild: !!(e && el.contains(e)) }; });
});
put('global_header_hit_while_dock_open', { globalRect: st['global-context-panel'].rect, voiceRect: st['gev-voice-control'].rect, pts: globalHit });
await page.screenshot({ path: path.join(OUT, 'D-occlusion.png') });

const globalClick = await clickCardCentre('global-context-panel');
const stAfter = await cardState();
put('global_click_while_dock_open', { click: globalClick, globalOpenAfter: stAfter['global-context-panel'] && stAfter['global-context-panel'].open, voiceOpenAfter: stAfter['gev-voice-control'] && stAfter['gev-voice-control'].open, cctvOpen: stAfter['cctv-panel'] && stAfter['cctv-panel'].open });
put('trust_final', await page.evaluate(() => { const o = window.__rv; return { down: o.down, downT: o.downT, click: o.click, clickT: o.clickT, last: o.last.slice(-8) }; }));

fs.writeFileSync(path.join(OUT, 'D-confirm.json'), JSON.stringify(R, null, 1));
await browser.close();
