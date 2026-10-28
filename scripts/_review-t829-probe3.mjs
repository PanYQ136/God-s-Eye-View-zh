#!/usr/bin/env node
/**
 * _review-t829-probe3.mjs — reviewer probe v3: dock card collapse/restore focus.
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const res = {};
const log = (k, v) => { res[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 1500)); };

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
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
for (let i = 0; i < 20; i++) {
  const bad = await page.evaluate(() => {
    const l = document.getElementById('first-run-launcher');
    if (l) { const r = l.getBoundingClientRect(); const c = getComputedStyle(l); if (r.width > 8 && r.height > 8 && c.visibility !== 'hidden' && +c.opacity > .05) return true; }
    return false;
  });
  if (!bad) break;
  await page.keyboard.press('Escape'); await sleep(400);
}
await sleep(6500);

const snap = () => page.evaluate(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control'];
  const o = {};
  for (const id of ids) {
    const e = document.getElementById(id); if (!e) continue;
    const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
    o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], open: !e.classList.contains('collapsed'), cls: String(e.className).slice(0, 60) };
  }
  return o;
});

// header plan for a card: where the clickable header is + what's under each candidate point
const plan = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const hdr = el.querySelector('.panel-header, .pp-header-row, .dock-header, header') || el;
  const hr = hdr.getBoundingClientRect();
  const pts = [];
  const title = el.querySelector('.panel-title, .pp-header-label, .dock-title, [class*="title"]');
  if (title) { const t = title.getBoundingClientRect(); pts.push({ x: Math.round(t.x + t.width / 2), y: Math.round(t.y + t.height / 2), why: 'title' }); }
  pts.push({ x: Math.round(hr.x + hr.width * 0.5), y: Math.round(hr.y + hr.height / 2), why: 'header-mid' });
  pts.push({ x: Math.round(hr.x + hr.width * 0.9), y: Math.round(hr.y + hr.height / 2), why: 'header-right' });
  return pts.map((p) => {
    const e = document.elementFromPoint(p.x, p.y);
    return { ...p, inCard: !!(e && el.contains(e)), tag: e && e.tagName, cls: e && String(e.className || '').slice(0, 28), id: e && e.id };
  });
}, id);

const clickAt = async (x, y) => { await page.mouse.move(x, y); await sleep(60); await page.mouse.down(); await sleep(45); await page.mouse.up(); await sleep(1300); };

const baseline = await snap();
log('baseline', baseline);

for (const id of ['location-bar', 'control-panel']) {
  const steps = { id, clicks: [] };
  for (let round = 0; round < 2; round++) {
    const pl = await plan(id);
    const good = pl.find((p) => p.inCard) || pl[0];
    await clickAt(good.x, good.y);
    const st = await snap();
    steps.clicks.push({ round, point: [good.x, good.y], why: good.why, hit: good.tag + '.' + good.cls, openAfter: st[id].open, rectAfter: st[id].rect });
  }
  steps.final = (await snap())[id];
  // try the dock tray toggle button if present
  const trayBtn = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const b = el.querySelector('.dock-tray-toggle, .panel-collapse-btn, [class*="collapse"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const e = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
    return { cls: String(b.className).slice(0, 40), rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)], hit: e && e.tagName + '.' + String(e.className).slice(0, 20), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, id);
  steps.trayBtn = trayBtn;
  if (trayBtn) {
    await clickAt(trayBtn.x, trayBtn.y);
    steps.afterTrayClick = (await snap())[id];
  }
  log('dock_' + id, steps);
  await page.screenshot({ path: path.join(OUT, 'v3-' + id + '.png') });
}

// restore check: ensure everything closed then compare rects to baseline
for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
  let st = await snap();
  if (!st[id] || !st[id].open) continue;
  const pl = await plan(id);
  const good = pl.find((p) => p.inCard);
  if (good) { await clickAt(good.x, good.y); }
  st = await snap();
  if (st[id].open) {
    const t = await page.evaluate((id) => {
      const el = document.getElementById(id);
      const b = el.querySelector('.dock-tray-toggle, .panel-collapse-btn');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, id);
    if (t) await clickAt(t.x, t.y);
  }
}
await sleep(2500);
const end = await snap();
const diff = [];
for (const id of Object.keys(baseline)) {
  const a = baseline[id].rect, b = end[id].rect;
  const d = Math.max(...a.map((u, i) => Math.abs(u - b[i])));
  if (d > 1.5 || baseline[id].open !== end[id].open) diff.push({ id, baseline: a, now: b, delta: +d.toFixed(1), wasOpen: baseline[id].open, isOpen: end[id].open });
}
log('restore', { diff, end });

fs.writeFileSync(path.join(OUT, 'probe3.json'), JSON.stringify(res, null, 1));
await browser.close();
console.log('WROTE probe3.json');
