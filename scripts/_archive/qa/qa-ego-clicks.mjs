#!/usr/bin/env node
/**
 * qa-ego-clicks.mjs —— Ego Lite 真实点击序列复刻 + 硬性不变量断言
 *
 * 背景：lead 的 Ego Lite 真实鼠标复测打回 Phase 1（初始态不稳 / 点完只剩 2 张 /
 *      location 飞到 x=-152 / 过程里卡消失跳位）。本脚本用同一顺序的真实 CDP 鼠标点击
 *      （isTrusted=true）在多视口跑，逐步断言：
 *        ① 初始态：冷启动必须只有 1 张浮层主卡（data-panel），盒子在视口内且已展开
 *        ② 7 个 header：elementFromPoint 必须命中自己（可见可点）
 *        ③ 每次点击后：目标卡 floating && 展开；点已展开卡则必须完全收回槽位
 *        ④ 全程：0 越界、0 隐藏、0 重叠、0 半开（迷你态不得残留 inline 几何）
 *        ⑤ 每组最多 1 张浮层（组内切换先关旧再开新）
 *        ⑥ 指针事件 100% trusted
 *
 * 用法: node scripts/qa-ego-clicks.mjs [--tag=r1] [--headful] [--vp=1228x730,1228x680,1536x730] [--keep]
 * 产物: .gev-logs/ego/<tag>/vp-<W>x<H>/{report.json,step-*.png} + summary.json
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith('--' + k + '='));
  return a ? a.split('=')[1] : d;
};
const TAG = arg('tag', 'r1');
const VPS = arg('vp', '1228x730,1228x680,1536x730')
  .split(',')
  .map((s) => s.split('x').map(Number));
const KEEP = process.argv.includes('--keep');
// --keep-last：只清 store、保留 :last（复刻 Ego round-03 的清法）→ 初始态必须仍是 data-panel
const KEEPLAST = process.argv.includes('--keep-last');
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
const GROUPS = [
  ['location-bar', 'control-panel', 'gev-voice-control'],
  ['pp-toggles', 'cctv-panel', 'global-context-panel'],
  ['data-panel', 'scene-panel'],
];

const browser = await puppeteer.launch({
  headless: !process.argv.includes('--headful'),
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
    '--window-size=1600,900', '--window-position=1900,40', '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
  ],
  protocolTimeout: 900000,
});

const summary = { tag: TAG, at: new Date().toISOString(), runs: [] };

for (const [W, H] of VPS) {
  const dir = path.join(OUT, `vp-${W}x${H}`);
  fs.mkdirSync(dir, { recursive: true });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  if (!KEEP) {
    await page.evaluateOnNewDocument((keepLast) => {
      try {
        localStorage.removeItem('gev-liquid-cards:v2');
        if (!keepLast) localStorage.removeItem('gev-liquid-cards:v2:last');
        else localStorage.setItem('gev-liquid-cards:v2:last', 'control-panel');
        localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
        localStorage.setItem('gev.perfMode', '0');
        localStorage.setItem('gev.gfx', JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'default' }));
        window.__gevcDebug = true;
        window.__ptr = [];
        const rec = (ev) => window.__ptr.push({ type: ev.type, trusted: ev.isTrusted, x: ev.clientX, y: ev.clientY, tgt: ev.target && (ev.target.tagName + '.' + String(ev.target.className || '').slice(0, 40)), t: Math.round(performance.now()) });
        for (const t of ['pointerdown', 'pointerup', 'click']) window.addEventListener(t, rec, true);
      } catch (e) {}
    }, KEEPLAST);
  }
  const errs = [], logs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error') errs.push('[console] ' + t.slice(0, 300));
    if (t.includes('[gev-lc]')) logs.push(t.slice(0, 240));
  });

  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
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
  await sleep(6500);

  const snap = () =>
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
          parent: (e.parentNode && (e.parentNode.id || e.parentNode.className || e.parentNode.tagName)) + '',
          inline: { l: e.style.left || '', t: e.style.top || '', w: e.style.width || '', h: e.style.height || '', tf: e.style.transform || '' },
          pos: cs.position,
        };
      }
      return { cards: out, vw: innerWidth, vh: innerHeight };
    }, IDS);

  const hitOf = (sel) =>
    page.evaluate((s) => {
      const e = document.querySelector(s);
      if (!e) return { err: 'no-el' };
      const b = e.getBoundingClientRect();
      const cx = Math.round(b.x + b.width / 2), cy = Math.round(b.y + b.height / 2);
      const h = document.elementFromPoint(cx, cy);
      const self = !!(h && (h === e || e.contains(h)));
      return { cx, cy, rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], hit: h ? h.tagName + '.' + String(h.className || '').slice(0, 46) : null, self };
    }, sel);

  const audit = (tag, s, expect) => {
    const fail = [];
    const cards = s.cards;
    const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const vis = IDS.filter((id) => cards[id] && cards[id].display !== 'none' && cards[id].vis !== 'hidden' && cards[id].w > 4 && cards[id].h > 4);
    for (const id of IDS) {
      const c = cards[id];
      if (!c) { fail.push(id + ':missing'); continue; }
      if (c.display === 'none' || c.vis === 'hidden') fail.push(id + ':hidden(' + c.display + '/' + c.vis + ')');
      if (c.x < -1 || c.y < -1 || c.x + c.w > s.vw + 1 || c.y + c.h > s.vh + 1) fail.push(id + ':offscreen ' + [c.x, c.y, c.w, c.h].join(','));
    }
    const ovs = [];
    for (let i = 0; i < vis.length; i++)
      for (let j = i + 1; j < vis.length; j++) {
        const a = overlap(cards[vis[i]], cards[vis[j]]);
        if (a > 4) ovs.push({ a: vis[i], b: vis[j], area: Math.round(a) });
      }
    if (ovs.length) fail.push('overlap:' + JSON.stringify(ovs));
    for (const id of IDS) {
      const c = cards[id];
      if (!c || c.floating) continue;
      const d = c.inline;
      if (d.l || d.t || d.w || d.h || d.tf) fail.push(id + ':idle-inline-geometry');
      if (!c.collapsed) fail.push(id + ':idle-not-collapsed');
    }
    for (const g of GROUPS) {
      const n = g.filter((id) => cards[id] && cards[id].floating).length;
      if (n > 1) fail.push('group-multi-float:' + g.join('/') + '=' + n);
    }
    for (const id of IDS) {
      const c = cards[id];
      if (c && c.floating && (c.w < 200 || c.h < 140)) fail.push(id + ':floating-but-mini ' + [c.x, c.y, c.w, c.h].join(','));
    }
    if (expect) {
      const c = cards[expect.id];
      if (expect.mode === 'open') {
        if (!c.floating) fail.push(expect.id + ':expected-floating');
        if (c.w < 200 || c.h < 140) fail.push(expect.id + ':expected-expanded');
      } else if (expect.mode === 'close') {
        if (c.floating) fail.push(expect.id + ':expected-closed');
        if (!c.collapsed) fail.push(expect.id + ':expected-mini');
      }
    }
    return { tag, fail, overlaps: ovs };
  };

  const rep = { viewport: [W, H], tLoadGoneMs: tLoadGone, steps: [], audits: [], initial: null, initialHits: {}, errs: [], ptrTrusted: false, ptrCount: 0 };

  rep.initial = await snap();
  for (const [id, sel] of HEADERS) rep.initialHits[id] = await hitOf(sel);
  await page.screenshot({ path: path.join(dir, 'step-00-initial.png') });
  rep.audits.push(audit('initial', rep.initial, null));
  for (const [id, h] of Object.entries(rep.initialHits)) if (!h.self) rep.audits[0].fail.push(id + ':header-not-self-hittable(' + h.hit + ')');
  const float0 = IDS.filter((id) => rep.initial.cards[id] && rep.initial.cards[id].floating);
  rep.initialFloating = float0;
  if (float0.length !== 1) rep.audits[0].fail.push('initial-floating-count=' + float0.length + ' [' + float0.join(',') + ']');

  for (let i = 0; i < HEADERS.length; i++) {
    const [id, sel] = HEADERS[i];
    const before = await snap();
    const wasFloating = !!(before.cards[id] && before.cards[id].floating);
    const hinfo = await hitOf(sel);
    let clicked = false;
    if (hinfo && hinfo.cx != null) {
      try { await page.mouse.click(hinfo.cx, hinfo.cy, { delay: 30 }); clicked = true; } catch (e) {}
    }
    await sleep(1300);
    const after = await snap();
    const a = audit('step' + (i + 1) + ':' + id, after, { id, mode: wasFloating ? 'close' : 'open' });
    if (!hinfo.self) a.fail.push(id + ':header-not-self-hittable(' + hinfo.hit + ')');
    rep.steps.push({ i: i + 1, id, sel, hit: hinfo, clicked, wasFloating, before, after, audit: a });
    rep.audits.push(a);
    await page.screenshot({ path: path.join(dir, `step-${String(i + 1).padStart(2, '0')}-${id}.png`) });
  }

  rep.after = await snap();
  rep.audits.push(audit('final', rep.after, null));
  const ptr = await page.evaluate(() => (window.__ptr || []).map((p) => ({ type: p.type, trusted: p.trusted })));
  rep.ptrTrusted = ptr.length > 0 && ptr.every((p) => p.trusted);
  rep.ptrCount = ptr.length;
  rep.errs = errs.slice(0, 10);
  rep.logs = logs.slice(-80);
  rep.failures = rep.audits.flatMap((a) => a.fail.map((f) => a.tag + ' | ' + f));
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(rep, null, 1));
  summary.runs.push({
    viewport: [W, H],
    tLoadGoneMs: tLoadGone,
    initialFloating: rep.initialFloating,
    initialRects: Object.fromEntries(IDS.map((id) => [id, rep.initial.cards[id] && [rep.initial.cards[id].x, rep.initial.cards[id].y, rep.initial.cards[id].w, rep.initial.cards[id].h]])),
    steps: rep.steps.map((s) => ({ n: s.i, id: s.id, wasFloating: s.wasFloating, rect: [s.after.cards[s.id].x, s.after.cards[s.id].y, s.after.cards[s.id].w, s.after.cards[s.id].h], floating: s.after.cards[s.id].floating, fail: s.audit.fail })),
    finalFloating: IDS.filter((id) => rep.after.cards[id] && rep.after.cards[id].floating),
    failures: rep.failures,
    ptr: { trusted: rep.ptrTrusted, count: rep.ptrCount },
    errs: rep.errs,
  });
  await page.close();
}

fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary.runs.map((r) => ({ vp: r.viewport, initialFloating: r.initialFloating, steps: r.steps, finalFloating: r.finalFloating, failures: r.failures, ptr: r.ptr, errs: r.errs.slice(0, 3) })), null, 1));
await browser.close();
