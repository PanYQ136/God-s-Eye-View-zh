#!/usr/bin/env node
/**
 * _r4-repro.mjs — targeted repro for reviewer round-3 blocker:
 * 「视觉预设(#control-panel, dock) + 显示(#pp-toggles, right rail) 同时展开」时右栏
 * 监控(#cctv-panel) / 上下文(#global-context-panel) 迷你卡叠压。
 * 纯 CDP 真实鼠标；两种点击顺序各跑一遍；settle 后打印右栏竖直 gap + 全卡两两重叠 + header 命中归属。
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/r4-t829');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v)); };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
});
const trust = { down: 0, downTrusted: 0, click: 0, clickTrusted: 0 };
await page.exposeFunction('__trust', (kind, ok) => {
  if (kind === 'pointerdown') { trust.down++; if (ok) trust.downTrusted++; }
  if (kind === 'click') { trust.click++; if (ok) trust.clickTrusted++; }
});
await page.evaluateOnNewDocument(() => {
  for (const k of ['pointerdown', 'click'])
    window.addEventListener(k, (e) => { try { window.__trust(k, e.isTrusted === true); } catch (_) {} }, true);
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9500);

const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const FOLD = CARDS.slice(0, 7);
const HEADERS = FOLD;

const clickCard = async (cardId) => {
  const probe = await page.evaluate((cardId) => {
    const el = document.getElementById(cardId);
    if (!el) return { ok: false };
    const er = el.getBoundingClientRect();
    const pts = [];
    for (const h of el.querySelectorAll('.pp-header-label, .panel-title, .location-toolbar-label, .dock-title, .panel-header, .dock-tray-toggle')) {
      const r = h.getBoundingClientRect();
      if (r.width > 4 && r.height > 4) pts.push({ x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) });
    }
    pts.push({ x: Math.round(er.x + er.width / 2), y: Math.round(er.y + Math.min(14, er.height / 2)) });
    for (const p of pts) {
      const e = document.elementFromPoint(p.x, p.y);
      if (e && el.contains(e)) return { ok: true, at: [p.x, p.y] };
    }
    return { ok: false };
  }, cardId);
  if (!probe.ok) return false;
  await page.mouse.move(probe.at[0], probe.at[1]);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(120);
  return true;
};

const snap = () => page.evaluate((IDS) => {
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    o[id] = {
      rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      open: !el.classList.contains('collapsed'),
      vis: c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05,
      bg: c.backgroundColor,
      bf: c.backdropFilter,
    };
  }
  const ov = (a, b) => {
    const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
    const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
    return { x: +ix.toFixed(1), y: +iy.toFixed(1), area: Math.round(ix * iy) };
  };
  const ids = Object.keys(o).filter((k) => o[k].vis);
  const overlaps = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const v = ov(o[ids[i]].rect, o[ids[j]].rect);
      if (v.area > 0) overlaps.push({ a: ids[i], b: ids[j], ...v });
    }
  const hits = {};
  for (const id of IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    const e = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(12, r.height / 2)));
    hits[id] = { own: !!(e && el.contains(e)), owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : (e ? e.tagName + '.' + (e.className || '') : null) };
  }
  // 右栏竖直栈：按 top 排序后的相邻 gap（真实 rect）
  const railOrder = ['pp-toggles', 'cctv-panel', 'global-context-panel']
    .filter((k) => o[k] && o[k].vis)
    .sort((a, b) => o[a].rect[1] - o[b].rect[1]);
  const gaps = [];
  for (let i = 1; i < railOrder.length; i++) {
    const a = o[railOrder[i - 1]].rect, b = o[railOrder[i]].rect;
    gaps.push({ pair: railOrder[i - 1] + '|' + railOrder[i], gapY: +(b[1] - (a[1] + a[3])).toFixed(1) });
  }
  return { o, overlaps, hits, railOrder, gaps };
}, CARDS);

// 等布局完全沉降：连续 3 次取样 rect 完全一致
const settle = async (tag) => {
  let prev = '';
  for (let i = 0; i < 30; i++) {
    await sleep(220);
    const s = await snap();
    const sig = JSON.stringify(s.o);
    if (sig === prev && i > 3) return s;
    prev = sig;
  }
  return snap();
};

const closeAll = async () => {
  for (const id of FOLD) {
    const open = await page.evaluate((i) => {
      const el = document.getElementById(i);
      return el && !el.classList.contains('collapsed');
    }, id);
    if (open) await clickCard(id);
  }
  await sleep(800);
};

// 初始基线（全 mini）
let s0 = await settle('init');
put('baseline', { rects: Object.fromEntries(Object.entries(s0.o).map(([k, v]) => [k, v.rect])), overlaps: s0.overlaps, gaps: s0.gaps });
await page.screenshot({ path: path.join(OUT, 'A-baseline-all-mini.png') });

const runs = [];
for (const order of [['control-panel', 'pp-toggles'], ['pp-toggles', 'control-panel'], ['control-panel', 'cctv-panel'], ['control-panel', 'global-context-panel'], ['location-bar', 'pp-toggles'], ['control-panel', 'location-bar', 'pp-toggles']]) {
  await closeAll();
  const clicked = [];
  for (const id of order) clicked.push({ id, ok: await clickCard(id) });
  const s = await settle(order.join('-'));
  runs.push({
    order: order.join(' -> '),
    clicked,
    open: Object.entries(s.o).filter(([, v]) => v.open).map(([k]) => k),
    railOrder: s.railOrder,
    gaps: s.gaps,
    overlaps: s.overlaps,
    headerHitsOwn: Object.fromEntries(Object.entries(s.hits).map(([k, v]) => [k, v.own])),
    badHits: Object.entries(s.hits).filter(([, v]) => !v.own).map(([k, v]) => ({ id: k, owner: v.owner })),
    rects: Object.fromEntries(Object.entries(s.o).map(([k, v]) => [k, v.rect])),
    outOfView: Object.entries(s.o).filter(([, v]) => v.vis && (v.rect[0] < -1 || v.rect[1] < -1 || v.rect[0] + v.rect[2] > 1536 + 1 || v.rect[1] + v.rect[3] > 730 + 1)).map(([k]) => k),
    shellAlpha: Object.fromEntries(Object.entries(s.o).map(([k, v]) => [k, v.bg])),
    shellBf: Object.fromEntries(Object.entries(s.o).map(([k, v]) => [k, v.bf])),
  });
  const fname = 'B-' + order.join('_') + '.png';
  await page.screenshot({ path: path.join(OUT, fname) });
}
put('runs', runs);

// 收起回基线
await closeAll();
const sEnd = await settle('end');
put('collapse', { rectDiff: Object.entries(s0.o).map(([k, v]) => ({ id: k, d: v.rect.map((n, i) => +(sEnd.o[k].rect[i] - n).toFixed(1)) })).filter((x) => x.d.some((n) => Math.abs(n) > 0.5)), overlaps: sEnd.overlaps });
put('trust', trust);

fs.writeFileSync(path.join(OUT, 'repro.json'), JSON.stringify(R, null, 1));
console.log('WROTE', path.join(OUT, 'repro.json'));
await browser.close();
