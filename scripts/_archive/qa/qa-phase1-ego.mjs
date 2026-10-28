#!/usr/bin/env node
/**
 * qa-phase1-ego.mjs —— 复刻 Ego Lite 真实点击序列（1228×730，冷启动，逐 header 点击）
 *
 * 目的：lead 的 Ego Lite 复测失败（初始态不稳、点完只剩 2 张、location 飞出屏幕、
 *      过程里卡消失/跳位）。本脚本用同一顺序的真实 CDP 鼠标点击在 Ego 的视口宽度下复现，
 *      并逐步抓「rect / classList / 父节点 / inline style / 命中元素 / 是否越界」。
 *
 * 用法: node scripts/qa-phase1-ego.mjs [--w=1228] [--h=730] [--tag=r1] [--headful] [--keep]
 * 产物: .gev-logs/ego/<tag>/{report.json, step-*.png}
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith('--' + k + '='));
  return a ? a.split('=')[1] : d;
};
const W = +arg('w', 1228), H = +arg('h', 730), TAG = arg('tag', 'r1');
const KEEP = process.argv.includes('--keep');
const OUT = path.resolve('.gev-logs/ego', TAG);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const HEADERS = [
  ['data-panel', '#data-panel .panel-header'],
  ['scene-panel', '#scene-panel .panel-header'],
  ['pp-toggles', '#pp-toggles .pp-header-row'],
  ['cctv-panel', '#cctv-panel .panel-header'],
  ['global-context-panel', '#global-context-panel .panel-header'],
  ['location-bar', '#location-bar-toggle'],
  ['control-panel', '#control-panel-toggle'],
];

const browser = await puppeteer.launch({
  headless: !process.argv.includes('--headful'),
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
    `--window-size=${W + 24},${H + 130}`, '--window-position=1900,40', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
  ],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

if (!KEEP) {
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.removeItem('gev-liquid-cards:v2');
      localStorage.removeItem('gev-liquid-cards:v2:last');
      localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
      localStorage.setItem('gev.perfMode', '0');
      localStorage.setItem('gev.gfx', JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'default' }));
      window.__gevcDebug = true;
      window.__ptr = [];
      const rec = (ev) => window.__ptr.push({ type: ev.type, trusted: ev.isTrusted, x: ev.clientX, y: ev.clientY, tgt: ev.target && (ev.target.tagName + '.' + String(ev.target.className || '').slice(0, 40)), t: Math.round(performance.now()) });
      for (const t of ['pointerdown', 'pointerup', 'click']) window.addEventListener(t, rec, true);
    } catch (e) {}
  });
}

const logs = [];
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error') errs.push('[console] ' + t.slice(0, 300));
  if (t.includes('[gev-lc]') || t.includes('[gev-edge]')) logs.push(t.slice(0, 240));
});

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
// 与 Ego 同节奏：等加载幕消失 + 再等 6s
let tLoadGone = null;
for (let i = 0; i < 160; i++) {
  const gone = await page.evaluate(() => {
    const l = document.querySelector('#loading-screen');
    if (!l) return true;
    return parseFloat(getComputedStyle(l).opacity || '1') < 0.05;
  }).catch(() => false);
  if (gone) { tLoadGone = i * 500; break; }
  await sleep(500);
}
await sleep(6000);

const state = () =>
  page.evaluate((ids) => {
    const out = {};
    for (const id of ids) {
      const e = document.getElementById(id);
      if (!e) { out[id] = null; continue; }
      const b = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      out[id] = {
        x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
        display: cs.display, vis: cs.visibility,
        collapsed: e.classList.contains('collapsed'),
        floating: e.classList.contains('gev-lc-floating'),
        cls: e.className,
        parent: (e.parentNode && (e.parentNode.id || e.parentNode.className || e.parentNode.tagName)) + '',
        inline: (e.getAttribute('style') || '').slice(0, 160),
        offscreen: b.right <= 0 || b.bottom <= 0 || b.left >= innerWidth || b.top >= innerHeight,
        z: cs.zIndex, pos: cs.position,
      };
    }
    return out;
  }, IDS);

const hitOf = (sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    if (!e) return { err: 'no-el' };
    const b = e.getBoundingClientRect();
    const cx = Math.round(b.x + b.width / 2), cy = Math.round(b.y + b.height / 2);
    const h = document.elementFromPoint(cx, cy);
    const self = h && (h === e || e.contains(h));
    return { cx, cy, rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], hit: h ? h.tagName + '.' + String(h.className || '').slice(0, 46) : null, self: !!self };
  }, sel);

// 不变量：可点 header 必须可见可命中；主卡不得越界
const invariants = (tag, s) => {
  const bad = {};
  for (const id of IDS) {
    const c = s[id];
    if (!c) { bad[id] = 'missing'; continue; }
    if (c.offscreen) bad[id] = 'offscreen ' + [c.x, c.y, c.w, c.h].join(',');
    if (c.display === 'none' || c.vis === 'hidden') bad[id] = 'hidden(' + c.display + '/' + c.vis + ')';
  }
  return { tag, bad, ok: !Object.keys(bad).length };
};

const report = { tag: TAG, viewport: [W, H], tLoadGoneMs: tLoadGone, initial: null, steps: [], invariants: [], errs: [] };
report.initial = await state();
await page.screenshot({ path: path.join(OUT, 'step-00-initial.png') });
report.invariants.push(invariants('initial', report.initial));

const hits = {};
for (const [id, sel] of HEADERS) hits[id] = await hitOf(sel);
report.initialHits = hits;

for (let i = 0; i < HEADERS.length; i++) {
  const [id, sel] = HEADERS[i];
  const before = await state();
  const hinfo = await hitOf(sel);
  let clicked = false;
  if (hinfo && hinfo.cx != null) {
    try { await page.mouse.click(hinfo.cx, hinfo.cy, { delay: 30 }); clicked = true; } catch (e) { report.steps.push({ id, clickErr: String(e).slice(0, 120) }); }
  }
  await sleep(1200);
  const after = await state();
  const inv = invariants(id, after);
  const self = after[id];
  report.steps.push({
    i: i + 1, id, sel, hit: hinfo, clicked,
    before: { [id]: before[id] },
    during: { [id]: { ...self } },
    after,
    inv,
    judged: {
      targetFloating: !!(self && self.floating),
      targetExpanded: !!(self && self.w > 200 && self.h > 150),
      targetOnscreen: !!(self && !self.offscreen),
    },
  });
  await page.screenshot({ path: path.join(OUT, `step-${String(i + 1).padStart(2, '0')}-${id}.png`) });
}

report.after = await state();
report.finalInv = invariants('final', report.after);
report.ptr = await page.evaluate(() => (window.__ptr || []).map((p) => ({ type: p.type, trusted: p.trusted, x: p.x, y: p.y, tgt: p.tgt })).slice(-60));
report.ptrTrusted = report.ptr.every((p) => p.trusted) && report.ptr.length > 0;
report.errs = errs.slice(0, 12);
report.logs = logs.slice(-120);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));

const brief = {
  tag: TAG, viewport: [W, H], tLoadGoneMs: tLoadGone,
  initial: Object.fromEntries(Object.entries(report.initial).map(([k, v]) => [k, v && { r: [v.x, v.y, v.w, v.h], f: v.floating, c: v.collapsed, off: v.offscreen }])),
  initialHits: Object.fromEntries(Object.entries(hits).map(([k, v]) => [k, v && { self: v.self, hit: v.hit, rect: v.rect }])),
  steps: report.steps.map((s) => ({ n: s.i, id: s.id, self: s.judged, inv: s.inv.bad, rect: s.after[s.id] && [s.after[s.id].x, s.after[s.id].y, s.after[s.id].w, s.after[s.id].h] })),
  final: Object.fromEntries(Object.entries(report.after).map(([k, v]) => [k, v && { r: [v.x, v.y, v.w, v.h], f: v.floating, c: v.collapsed, off: v.offscreen, parent: v.parent }])),
  finalInv: report.finalInv.bad,
  ptrTrusted: report.ptrTrusted, ptrCount: report.ptr.length,
  errs: report.errs.slice(0, 4),
};
console.log(JSON.stringify(brief, null, 1));
await browser.close();
