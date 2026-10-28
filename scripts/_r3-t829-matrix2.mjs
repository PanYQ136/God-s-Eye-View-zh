#!/usr/bin/env node
/**
 * _r3-t829-matrix2.mjs — t_829dd186 round-3 · 7 条验收矩阵（CDP 真实鼠标）
 *  A) 初始全 mini（基线）            B) 互斥 5 组：逐帧记录 + 关旧/开新时序
 *  B2) 旧 header 真实点击回切        C) pp 真滚轮 + minGap + 黑底黑字
 *  D) 快速连点 14 击 0 漏击          E) 收起归位
 *  F) 重载 t+3/8/15s 全 mini         G) FPS
 *  H) pointerTrust 计数
 * 设计要点：页面内只做「无 promise 的记录」（rAF/observer 写数组，最后一次性读取），
 * 绝不在点击期间挂一个待 resolve 的 long-running evaluate —— round-3 首跑就是被那个
 * 卡住的 evaluate 干扰了真实鼠标点击的判定（候选点反复 toggle，10 次点击回到原态）。
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/r3-t829');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const LEFT = ['data-panel', 'scene-panel'];
const RIGHT = ['pp-toggles', 'cctv-panel', 'global-context-panel'];
const SEVEN = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const HEADER_SEL = '.panel-header, .pp-header-row, .dock-header, header, .location-toolbar-label, .panel-title, .pp-header-label';
const res = { started: new Date().toISOString(), viewport: W + 'x' + H };
const put = (k, v) => { res[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 1800)); };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860',
    '--autoplay-policy=no-user-gesture-required'],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
  window.__rv = { down: 0, downT: 0, click: 0, clickT: 0, wheel: 0, wheelT: 0 };
  for (const t of ['pointerdown', 'click', 'wheel']) {
    document.addEventListener(t, (e) => {
      const o = window.__rv;
      if (t === 'pointerdown') { o.down++; if (e.isTrusted) o.downT++; }
      else if (t === 'wheel') { o.wheel++; if (e.isTrusted) o.wheelT++; }
      else { o.click++; if (e.isTrusted) o.clickT++; }
    }, true);
  }
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
await sleep(7000);

const inject = () => page.evaluate(() => {
  window.__a = (c) => { const s = String(c || ''); const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return /^rgb\(/.test(s) ? 1 : 0; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; };
});
await inject();

const stateAll = () => page.evaluate((IDS) => {
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id); if (!el) { o[id] = null; continue; }
    const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      area: Math.round(r.width * r.height), open: !el.classList.contains('collapsed'),
      hidden: c.visibility === 'hidden' || c.display === 'none' || +c.opacity < .05,
      bgA: +window.__a(c.backgroundColor).toFixed(3), bf: c.backdropFilter || 'none',
      inView: r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
  }
  return o;
}, CARDS);

const settle = async () => {
  let prev = null;
  for (let i = 0; i < 30; i++) {
    const now = await page.evaluate((IDS) => IDS.map((id) => {
      const e = document.getElementById(id); if (!e) return null;
      const r = e.getBoundingClientRect(); return [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)];
    }), CARDS);
    if (prev && JSON.stringify(prev) === JSON.stringify(now)) return now;
    prev = now; await sleep(300);
  }
  return prev;
};
await settle();
const initialMini = await stateAll();
const isExpanded = (st, id) => {
  const b = initialMini[id];
  if (!b || !st[id] || id === 'gev-gfx-fab') return false;
  if (st[id].hidden) return false;
  return st[id].area > b.area * 1.25 + 400;
};
const expandedIds = (st) => CARDS.filter((id) => isExpanded(st, id));

put('A_initial', {
  rects: Object.fromEntries(CARDS.map((id) => [id, initialMini[id] && initialMini[id].rect])),
  expanded: expandedIds(initialMini),
  closeEls: await page.evaluate(() => document.querySelectorAll('.gev-lc-close').length),
  allBgA0: CARDS.every((id) => !initialMini[id] || initialMini[id].bgA === 0),
  bfAny: CARDS.filter((id) => initialMini[id] && initialMini[id].bf !== 'none'),
  allInView: CARDS.every((id) => !initialMini[id] || initialMini[id].inView),
});
await page.screenshot({ path: path.join(OUT, 'E1-initial.png') });

// 候选点：必须真命中「这张卡自己的 header」（elementFromPoint 归属校验）
const headerPts = (id) => page.evaluate((id, SEL) => {
  const el = document.getElementById(id);
  const out = [];
  for (const h of el.querySelectorAll(SEL)) {
    const r = h.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]]) {
      const x = Math.round(r.x + r.width * fx), y = Math.round(r.y + r.height * fy);
      const e = document.elementFromPoint(x, y);
      const hh = e && e.closest ? e.closest(SEL) : null;
      const owner = e && e.closest ? ((e.closest('.gev-lc') || {}).id || null) : null;
      if (hh && el.contains(hh) && owner === id) out.push({ x, y, hit: e.tagName + '.' + String(e.className || '').slice(0, 22) });
    }
  }
  if (!out.length) {
    const r = el.getBoundingClientRect();
    const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + Math.min(12, r.height / 2));
    const e = document.elementFromPoint(x, y);
    const owner = e && e.closest ? ((e.closest('.gev-lc') || {}).id || null) : null;
    if (owner === id) out.push({ x, y, hit: e.tagName + '.' + String(e.className || '').slice(0, 22) });
  }
  return out;
}, id, HEADER_SEL);

const clickToggle = async (id) => {
  // isExpanded 需要「整张卡表」而不是单卡拉 — 首版误传单卡拉，恒 false → 每张卡连点 3 次
  // 来回 toggle，最终态随机（round-3 首跑 B/D/E 全部报废的根因）。
  const beforeSt = await stateAll();
  const beforeExp = isExpanded(beforeSt, id);
  const pts = await headerPts(id);
  const tries = [];
  for (const p of pts.slice(0, 3)) { // 最多 3 个候选点，避免反复 toggle
    await page.mouse.move(p.x, p.y); await sleep(50);
    await page.mouse.down(); await sleep(45); await page.mouse.up();
    await sleep(900);
    const now = (await stateAll())[id];
    const nowExp = (now.area > initialMini[id].area * 1.25 + 400) && !now.hidden;
    tries.push({ at: [p.x, p.y], hit: p.hit, area: now.area, expanded: nowExp });
    if (nowExp !== beforeExp) return { id, ok: true, expanded: nowExp, tries };
    await sleep(120);
  }
  return { id, ok: false, expanded: isExpanded((await stateAll()), id), tries, cands: pts.length };
};

const collapseAll = async () => {
  for (const id of [...SEVEN, 'gev-voice-control']) {
    const st = await stateAll();
    if (!isExpanded(st, id)) continue;
    await clickToggle(id);
    await sleep(250);
  }
  await settle();
};

// ── B) 互斥：无 promise 的录制（rAF + observer 写数组，最后一次性读）──
const switchCase = async (from, to) => {
  let st = await stateAll();
  if (!isExpanded(st, from)) { await clickToggle(from); await sleep(800); }
  await settle();
  await page.evaluate((L, R) => {
    window.__stop = false; window.__frames = []; window.__cls = {};
    const t0 = performance.now();
    const open = (ids) => ids.filter((i) => { const e = document.getElementById(i); if (!e) return false; const r = e.getBoundingClientRect(); return !e.classList.contains('collapsed') && r.width > 200; }).length;
    const tick = () => { if (window.__stop) return; window.__frames.push({ t: +(performance.now() - t0).toFixed(1), l: open(L), r: open(R) }); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    for (const id of [...L, ...R]) {
      const el = document.getElementById(id);
      if (!el) continue;
      window.__cls[id] = { first: null, last: null };
      new MutationObserver(() => {
        const v = !el.classList.contains('collapsed');
        const rec = window.__cls[id];
        if (rec.first === null) rec.first = { open: v, t: +(performance.now() - t0).toFixed(1) };
        rec.last = { open: v, t: +(performance.now() - t0).toFixed(1) };
      }).observe(el, { attributes: true, attributeFilter: ['class'] });
    }
  }, LEFT, RIGHT);
  const click = await clickToggle(to);
  await sleep(1500);
  const rec = await page.evaluate(() => { window.__stop = true; return { frames: window.__frames, cls: window.__cls }; });
  const st2 = await stateAll();
  return { case: from + '->' + to, clicked: click.ok, frames: rec.frames.length,
    maxLeft: Math.max(...rec.frames.map((s) => s.l)), maxRight: Math.max(...rec.frames.map((s) => s.r)),
    emptyFrames: rec.frames.filter((s) => s.l === 0 && s.r === 0).length,
    order: { from: rec.cls[from], to: rec.cls[to] },
    fromVisible: !st2[from].hidden, fromInView: st2[from].inView,
    toExpanded: isExpanded(st2, to), fromCollapsed: !isExpanded(st2, from),
    endExpanded: expandedIds(st2) };
};
const mutex = [];
for (const [from, to] of [['data-panel', 'scene-panel'], ['scene-panel', 'data-panel'],
  ['pp-toggles', 'cctv-panel'], ['cctv-panel', 'global-context-panel'], ['global-context-panel', 'pp-toggles']]) {
  mutex.push(await switchCase(from, to));
  await page.screenshot({ path: path.join(OUT, 'E2-switch-' + from + '-to-' + to + '.png') });
}
put('B_mutex', mutex);

// ── B2) 旧 header 回切 ──
const backSwitch = [];
for (const [nowOpen, back] of [['global-context-panel', 'pp-toggles'], ['pp-toggles', 'cctv-panel'], ['cctv-panel', 'global-context-panel']]) {
  let st = await stateAll();
  if (!isExpanded(st, nowOpen)) { await clickToggle(nowOpen); await sleep(700); }
  const c = await clickToggle(back);
  await sleep(900);
  const s2 = await stateAll();
  backSwitch.push({ nowOpen, clicked: back, ok: c.ok, backExpanded: isExpanded(s2, back), oldCollapsed: !isExpanded(s2, nowOpen) });
}
put('B2_old_header_back', backSwitch);

// ── C) pp：真滚轮 + minGap ──
await collapseAll();
let st = await stateAll();
if (!isExpanded(st, 'pp-toggles')) { await clickToggle('pp-toggles'); await sleep(1000); }
await settle();
const ppBox = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height * 0.6), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
});
await page.mouse.move(ppBox.x, ppBox.y);
const trace = [ppBox.scrollTop];
for (let i = 0; i < 8; i++) { await page.mouse.wheel({ deltaY: 140 }); await sleep(160); trace.push(await page.evaluate(() => Math.round(document.getElementById('pp-toggles').scrollTop))); }
await page.screenshot({ path: path.join(OUT, 'E3-pp-scrolled.png') });
const ppInfo = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  const a = (c) => { const s = String(c || ''); const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return /^rgb\(/.test(s) ? 1 : 0; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; };
  const rowsByParent = new Map();
  for (const e of el.querySelectorAll('.pp-toggle-btn, .pp-slider-row, .pp-toggle-group, .pp-mode-btn')) {
    const r = e.getBoundingClientRect();
    if (r.height <= 2) continue;
    const k = e.parentElement;
    if (!rowsByParent.has(k)) rowsByParent.set(k, []);
    rowsByParent.get(k).push({ cls: String(e.className).slice(0, 30), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1), h: +r.height.toFixed(1) });
  }
  // 只在「同一父级」的兄弟之间量间距/重叠（跨层级的父子重叠是布局本身，不是挤压）
  let minGap = Infinity, pair = null;
  const sib = [];
  let rows = 0;
  for (const list of rowsByParent.values()) {
    list.sort((x, y) => x.top - y.top);
    rows += list.length;
    for (let i = 1; i < list.length; i++) {
      const g = list[i].top - list[i - 1].bottom;
      if (list[i].top > list[i - 1].bottom - 1 && g < minGap) { minGap = g; pair = [list[i - 1].cls, list[i].cls]; }
    }
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const A = list[i], B = list[j];
      const ix = Math.min(A.right, B.right) - Math.max(A.left, B.left);
      const iy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
      if (ix > 2 && iy > 2) sib.push({ a: A.cls, b: B.cls, ix: +ix.toFixed(0), iy: +iy.toFixed(0) });
    }
  }
  const dark = [], solid = [], clipped = [];
  for (const e of el.querySelectorAll('button, .pp-toggle-btn, .pp-mode-btn, .pp-select, .pp-slider-row')) {
    const c = getComputedStyle(e);
    const bgA = a(c.backgroundColor);
    const m = String(c.color).match(/rgba?\(([^)]+)\)/);
    const rgb = m ? m[1].split(/[,\s/]+/).filter(Boolean).map(Number) : [255, 255, 255];
    const darkText = (rgb[0] + rgb[1] + rgb[2]) / 3 < 90;
    if (bgA > 0.5) solid.push({ cls: String(e.className).slice(0, 28), bg: c.backgroundColor });
    if (bgA > 0.3 && darkText) dark.push({ cls: String(e.className).slice(0, 28), bg: c.backgroundColor, color: c.color });
    if (e.scrollWidth > e.clientWidth + 2 || e.scrollHeight > e.clientHeight + 2) clipped.push(String(e.className).slice(0, 28));
  }
  const hdr = el.querySelector('.pp-header-row');
  const hr = hdr ? hdr.getBoundingClientRect() : null;
  const hitHdr = hr ? (() => { const e = document.elementFromPoint(Math.round(hr.x + hr.width / 2), Math.round(hr.y + hr.height / 2)); return { hit: e ? e.tagName + '.' + String(e.className || '').slice(0, 24) : '', owner: e && e.closest ? ((e.closest('.gev-lc') || {}).id || null) : null }; })() : null;
  return { minGap: +minGap.toFixed(1), gapPair: pair, rows: rows.length, siblingOverlaps: sib.slice(0, 6),
    dark, solid: solid.slice(0, 6), clipped: clipped.slice(0, 6), headerStickyHit: hitHdr, headerTop: hr ? +hr.top.toFixed(0) : null };
});
put('C_pp', { box: ppBox, scrollTrace: trace, maxScroll: Math.max(...trace), ...ppInfo });
await page.mouse.wheel({ deltaY: -3000 }); await sleep(400);

// ── D) 快速连点 14 击 ──
await collapseAll();
const seq = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel',
  'global-context-panel', 'location-bar', 'control-panel'];
const taps = [];
for (const id of seq) {
  const c = await clickToggle(id);
  taps.push({ id, toggled: c.ok, area: c.tries.length ? c.tries[c.tries.length - 1].area : null, tries: c.tries.length });
  await sleep(60);
}
await sleep(1500); await settle();
const afterRapid = await stateAll();
const expanded = expandedIds(afterRapid).map((id) => ({ id, r: afterRapid[id].rect }));
const overlaps = [];
for (let i = 0; i < expanded.length; i++) for (let j = i + 1; j < expanded.length; j++) {
  const A = expanded[i].r, B = expanded[j].r;
  const ix = Math.max(0, Math.min(A[0] + A[2], B[0] + B[2]) - Math.max(A[0], B[0]));
  const iy = Math.max(0, Math.min(A[1] + A[3], B[1] + B[3]) - Math.max(A[1], B[1]));
  if (ix > 2 && iy > 2) overlaps.push({ a: expanded[i].id, b: expanded[j].id, ix: +ix.toFixed(0), iy: +iy.toFixed(0) });
}
put('D_rapid', { count: taps.length, toggled: taps.filter((t) => t.toggled).length + '/' + taps.length,
  missed: taps.filter((t) => !t.toggled), endExpanded: expandedIds(afterRapid), overlaps,
  outOfView: CARDS.filter((id) => afterRapid[id] && !afterRapid[id].inView) });
await page.screenshot({ path: path.join(OUT, 'E4-rapid.png') });

// ── E) 收起归位 ──
await collapseAll();
await sleep(800); await settle();
const collapsed = await stateAll();
const diff = [];
for (const id of CARDS) {
  if (id === 'gev-gfx-fab') continue;
  const A = initialMini[id].rect, B = collapsed[id].rect;
  const d = Math.max(...A.map((u, i) => Math.abs(u - B[i])));
  if (d > 1.5) diff.push({ id, initial: A, now: B, delta: +d.toFixed(1) });
}
put('E_collapse', { expanded: expandedIds(collapsed), rectDiff: diff, allInView: CARDS.every((id) => !collapsed[id] || collapsed[id].inView) });
await page.screenshot({ path: path.join(OUT, 'E5-collapsed.png') });

// ── G) FPS ──
const fps = [];
for (let k = 0; k < 3; k++) {
  fps.push(await page.evaluate(() => new Promise((r) => {
    let n = 0; const t0 = performance.now();
    const tick = () => { n++; const dt = performance.now() - t0; if (dt < 4000) requestAnimationFrame(tick); else r({ frames: n, fps: +(n / (dt / 1000)).toFixed(1) }); };
    requestAnimationFrame(tick);
  })));
  await sleep(250);
}
put('G_fps', { runs: fps, median: fps.map((f) => f.fps).sort((a, b) => a - b)[1] });

// ── H) 重载 → 全 mini ──
const trustBefore = await page.evaluate(() => window.__rv);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
const samples = {};
for (const t of [3000, 8000, 15000]) {
  await sleep(t === 3000 ? 3000 : 5000);
  await inject();
  const s2 = await stateAll();
  samples['t+' + t] = { expanded: expandedIds(s2), rects: Object.fromEntries(CARDS.map((id) => [id, s2[id] && s2[id].rect])) };
}
put('H_reload', { samples, trustBefore, trustAfter: await page.evaluate(() => window.__rv) });
await page.screenshot({ path: path.join(OUT, 'E6-reloaded.png') });

fs.writeFileSync(path.join(OUT, 'matrix.json'), JSON.stringify(res, null, 2));
await browser.close();
console.log('DONE matrix.json');
