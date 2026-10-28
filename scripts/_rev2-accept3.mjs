#!/usr/bin/env node
/**
 * _rev2-accept3.mjs — t_829dd186 第二轮证据（chrome 透明化返工后）
 * 覆盖 probe.mjs / probe2.mjs 没覆盖或口径不稳的三块：
 *   A) 左/右互斥逐帧采样（含 close→open gap ms）
 *   B) 14 次快速连点（稳健 header 命中 + 校正后终态）
 *   C) 收起全部归位 → 重载仍全 mini（分时刻采样）→ FPS
 * 点击全部走 CDP 真实鼠标；trust 计数在 reload 前快照（避免 reload 清零误读）。
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/rev2-accept');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const LEFT = ['data-panel', 'scene-panel'];
const RIGHT = ['pp-toggles', 'cctv-panel', 'global-context-panel'];

const res = { started: new Date().toISOString(), checks: {} };
const put = (k, v) => { res.checks[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 1600)); };

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
  window.__rv = { down: 0, downTrusted: 0, click: 0, clickTrusted: 0 };
  const rec = (e) => {
    const o = window.__rv;
    if (e.type === 'pointerdown') { o.down++; if (e.isTrusted) o.downTrusted++; }
    else { o.click++; if (e.isTrusted) o.clickTrusted++; }
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

// 等轨道沉降（dock 由 CSS 26vh 兜底过渡到 JS 值，约 2s）
const settled = async () => {
  let prev = null;
  for (let i = 0; i < 40; i++) {
    const now = await page.evaluate((IDS) => IDS.map((id) => {
      const e = document.getElementById(id); if (!e) return null;
      const r = e.getBoundingClientRect(); return [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)];
    }), CARDS);
    if (prev && JSON.stringify(prev) === JSON.stringify(now)) return now;
    prev = now; await sleep(400);
  }
  return prev;
};
await settled();

const stateAll = () => page.evaluate((IDS) => {
  const a = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return /^rgb\(/.test(String(c)) ? 1 : 0; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1; };
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id); if (!el) { o[id] = null; continue; }
    const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      open: !el.classList.contains('collapsed'), cls: String(el.className).slice(0, 50),
      hidden: c.visibility === 'hidden' || c.display === 'none' || +c.opacity < .05,
      bgA: +a(c.backgroundColor).toFixed(3), bf: c.backdropFilter,
      inView: r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
  }
  return o;
}, CARDS);

// 迷你基线（本次运行的「初始全 mini」参照，收起后所有卡必须回到这套矩形）
const initialMini = await stateAll();
put('initial_mini', initialMini);
// 判定「真展开」= 矩形比迷你基线明显变大（gev-voice-control 从不上 .collapsed，
// 只能靠几何判定它是否被展开；实测它的矩形恒为 140×85.6）
const expandedList = (st) => Object.entries(st).filter(([k, v]) => {
  if (!v || k === 'gev-gfx-fab') return false;
  const b = initialMini[k];
  if (!b) return false;
  return !v.hidden && (v.rect[2] > b.rect[2] + 2 || v.rect[3] > b.rect[3] + 2);
}).map(([k]) => k);

// ── 稳健 header 点击：只认 header / 标题元素，命中后校验状态，失败换点重试 ──
const HEADER_SEL = '.panel-header, .pp-header-row, .dock-header, header, .location-toolbar-label, .panel-title, .pp-header-label';
const clickToggle = async (id, { expectOpen } = {}) => {
  const before = (await stateAll())[id].open;
  const getCands = () => page.evaluate((id, SEL) => {
    const el = document.getElementById(id);
    const out = [];
    for (const h of el.querySelectorAll(SEL)) {
      const r = h.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const pts = [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]];
      for (const [fx, fy] of pts) {
        out.push({ x: Math.round(r.x + r.width * fx), y: Math.round(r.y + r.height * fy), cls: String(h.className).slice(0, 30) });
      }
    }
    return out.map((p) => {
      const e = document.elementFromPoint(p.x, p.y);
      const hh = e && e.closest ? e.closest(SEL) : null;
      return { ...p, hit: e ? e.tagName + '.' + String(e.className || '').slice(0, 26) : '', onHeader: !!(hh && el.contains(hh)) };
    }).filter((p) => p.onHeader);
  }, id, HEADER_SEL);
  let cands = await getCands();
  // 快速连点时上一张卡还在 morph，可能整卡没有可命中点：等一拍再算（最多 3 次）
  for (let k = 0; k < 3 && !cands.length; k++) { await sleep(450); cands = await getCands(); }
  const order = cands.slice(0, 12);
  const tries = [];
  for (const p of order) {
    await page.mouse.move(p.x, p.y); await sleep(60);
    await page.mouse.down(); await sleep(45); await page.mouse.up();
    await sleep(900);
    const now = (await stateAll())[id].open;
    tries.push({ at: [p.x, p.y], cls: p.cls, hit: p.hit, openAfter: now });
    if (now !== before) return { id, before, after: now, tries };
    await sleep(200);
  }
  return { id, before, after: (await stateAll())[id].open, tries, failed: true };
};

// ── A) 互斥：逐帧采样 + 关旧→开新 gap ──
const switchCase = async (from, to) => {
  let st = await stateAll();
  if (!st[from].open) await clickToggle(from);
  await sleep(1100);
  // 逐帧 rAF 采样 + class 变化级精确时序（observer 必须在点击前挂上）
  await page.evaluate((L, R) => {
    window.__tl = []; window.__stop = false;
    const t0 = performance.now();
    const tick = () => {
      if (window.__stop) return;
      const open = (ids) => ids.filter((i) => { const e = document.getElementById(i); return e && !e.classList.contains('collapsed'); }).length;
      window.__tl.push({ t: +(performance.now() - t0).toFixed(1), l: open(L), r: open(R) });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, LEFT, RIGHT);
  const orderPromise = page.evaluate((from, to) => new Promise((resolve) => {
    const t0 = performance.now();
    const rec = { fromClose: null, toOpen: null };
    const fromEl = document.getElementById(from), toEl = document.getElementById(to);
    const obs = new MutationObserver(() => {
      if (rec.fromClose === null && fromEl.classList.contains('collapsed')) rec.fromClose = +(performance.now() - t0).toFixed(2);
      if (rec.toOpen === null && !toEl.classList.contains('collapsed')) rec.toOpen = +(performance.now() - t0).toFixed(2);
      if (rec.fromClose !== null && rec.toOpen !== null) { obs.disconnect(); resolve(rec); }
    });
    obs.observe(fromEl, { attributes: true, attributeFilter: ['class'] });
    obs.observe(toEl, { attributes: true, attributeFilter: ['class'] });
    setTimeout(() => { obs.disconnect(); resolve(rec); }, 3000);
  }), from, to);
  const c = await clickToggle(to);
  await sleep(1500);
  const tl = await page.evaluate(() => { window.__stop = true; return window.__tl; });
  const careful = await orderPromise;
  const st2 = await stateAll();
  const maxL = Math.max(...tl.map((s) => s.l));
  const maxR = Math.max(...tl.map((s) => s.r));
  const empty = tl.filter((s) => s.l === 0 && s.r === 0).length;
  return { case: from + '->' + to, clicked: !c.failed, frames: tl.length, maxLeft: maxL, maxRight: maxR,
    emptyFrames: empty, order: careful,
    end: { [from]: { open: st2[from].open, hidden: st2[from].hidden }, [to]: { open: st2[to].open, hidden: st2[to].hidden } } };
};
// 二次准备：把互斥专用的打开/关闭做成配对（先 from 打开，再点 to）
const mutex = [];
for (const [from, to] of [['data-panel', 'scene-panel'], ['scene-panel', 'data-panel'],
  ['pp-toggles', 'cctv-panel'], ['cctv-panel', 'global-context-panel'], ['global-context-panel', 'pp-toggles']]) {
  mutex.push(await switchCase(from, to));
  await page.screenshot({ path: path.join(OUT, 'switch-' + from + '-to-' + to + '.png') });
}
put('mutex', mutex);

// ── B) 快速连点 14 次 ──
const seq = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel',
  'global-context-panel', 'location-bar', 'control-panel'];
const taps = [];
for (const id of seq) {
  const c = await clickToggle(id);
  taps.push({ id, toggled: !c.failed, tries: c.tries.length });
  await sleep(90);
}
await sleep(1800);
await settled();
const afterRapid = await stateAll();
const rects = Object.entries(afterRapid).filter(([, v]) => v && v.open).map(([k, v]) => ({ id: k, r: v.rect }));
const overlaps = [];
for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
  const a = rects[i].r, b = rects[j].r;
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  if (ix > 2 && iy > 2) overlaps.push({ a: rects[i].id, b: rects[j].id, ix: +ix.toFixed(0), iy: +iy.toFixed(0) });
}
put('rapid', { taps, toggled: taps.filter((t) => t.toggled).length + '/' + taps.length,
  endOpen: Object.entries(afterRapid).filter(([, v]) => v && v.open).map(([k]) => k),
  endExpanded: expandedList(afterRapid),
  overlaps, outOfView: Object.entries(afterRapid).filter(([, v]) => v && !v.inView).map(([k]) => k),
  mutualStillHolds: { left: Object.entries(afterRapid).filter(([k, v]) => LEFT.includes(k) && v.rect[2] > initialMini[k].rect[2] + 2).length,
    right: Object.entries(afterRapid).filter(([k, v]) => RIGHT.includes(k) && v.rect[2] > initialMini[k].rect[2] + 2).length } });
await page.screenshot({ path: path.join(OUT, 'rapid-final.png') });

// ── C) 收起全部 → 归位（基线 = 本次运行开始时确认过的迷你矩形）──
for (const id of CARDS) {
  if (id === 'gev-gfx-fab') continue;
  let st = await stateAll();
  if (!st[id].open) continue;
  const c = await clickToggle(id);
  if (c.failed) {
    // 兜底：dock 托盘开关
    const t = await page.evaluate((id) => {
      const el = document.getElementById(id);
      const b = el.querySelector('.dock-tray-toggle, .panel-collapse-btn');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, id);
    if (t) { await page.mouse.move(t.x, t.y); await sleep(60); await page.mouse.down(); await sleep(45); await page.mouse.up(); await sleep(900); }
  }
}
await sleep(2500);
await settled();
const collapsed = await stateAll();
const diff = [];
for (const id of CARDS) {
  if (id === 'gev-gfx-fab') continue;
  const a = initialMini[id].rect, b = collapsed[id].rect;
  const d = Math.max(...a.map((u, i) => Math.abs(u - b[i])));
  if (d > 1.5) diff.push({ id, initialMini: a, now: b, delta: +d.toFixed(1), open: collapsed[id].open });
}
put('collapse', { stillOpen: Object.entries(collapsed).filter(([k, v]) => v && v.open && k !== 'gev-gfx-fab').map(([k]) => k),
  expanded: expandedList(collapsed), rectDiffVsInitialMini: diff });
await page.screenshot({ path: path.join(OUT, 'collapsed.png') });

// ── C2) reload → 仍全 mini（分时刻采样，避免 init class 未落盘误判）──
const trustBefore = await page.evaluate(() => window.__rv);
put('trust_before_reload', trustBefore);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
const samples = {};
for (const t of [3000, 8000, 15000]) {
  await sleep(t === 3000 ? 3000 : 5000);
  const st = await stateAll();
  samples['t+' + t] = { open: Object.entries(st).filter(([k, v]) => v && v.open && k !== 'gev-gfx-fab').map(([k]) => k),
    expanded: expandedList(st),
    rects: Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v ? v.rect : null])) };
}
const reloaded = await stateAll();
put('reload', { samples, openAtEnd: Object.entries(reloaded).filter(([k, v]) => v && v.open && k !== 'gev-gfx-fab').map(([k]) => k),
  expandedAtEnd: expandedList(reloaded),
  bgAlpha: Object.fromEntries(CARDS.map((i) => [i, reloaded[i] ? reloaded[i].bgA : null])) });
await page.screenshot({ path: path.join(OUT, 'reloaded.png') });

// ── D) FPS ──
const fps = await page.evaluate(() => new Promise((r) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else r({ frames: n, ms: Math.round(performance.now() - t0), fps: +(n / ((performance.now() - t0) / 1000)).toFixed(1) }); };
  requestAnimationFrame(tick);
}));
put('fps', fps);

res.finished = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'probe3.json'), JSON.stringify(res, null, 1));
await browser.close();
console.log('WROTE probe3.json');
