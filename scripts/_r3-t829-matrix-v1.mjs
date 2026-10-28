#!/usr/bin/env node
/**
 * _r3-t829-matrix.mjs — t_829dd186 round-3 · 7 条验收矩阵（真实鼠标）
 *  A) 初始全 mini（基线）           B) 互斥 5 组逐帧采样
 *  C) pp 真滚轮 + minGap + 黑底黑字  D) 快速连点 14 击 0 漏击
 *  E) 收起归位                      F) 重载 t+3/8/15s 全 mini
 *  G) FPS                           H) pointerTrust 计数
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
const res = { started: new Date().toISOString() };
const put = (k, v) => { res[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 2000)); };

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
  window.__rv = { down: 0, downT: 0, click: 0, clickT: 0, move: 0, wheel: 0 };
  for (const t of ['pointerdown', 'click', 'wheel']) {
    document.addEventListener(t, (e) => {
      const o = window.__rv;
      if (t === 'pointerdown') { o.down++; if (e.isTrusted) o.downT++; }
      else if (t === 'wheel') { o.wheel++; }
      else { o.click++; if (e.isTrusted) o.clickT++; }
    }, true);
  }
  document.addEventListener('mousemove', () => { window.__rv.move++; }, true);
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

await page.evaluate(() => {
  window.__a = (c) => {
    const s = String(c || '');
    if (/^rgba?\(/.test(s)) { const p = s.match(/rgba?\(([^)]+)\)/)[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; }
    return 0;
  };
});

const stateAll = () => page.evaluate((IDS) => {
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id); if (!el) { o[id] = null; continue; }
    const r = el.getBoundingClientRect(); const c = getComputedStyle(el);
    o[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      area: Math.round(r.width * r.height),
      open: !el.classList.contains('collapsed'),
      hidden: c.visibility === 'hidden' || c.display === 'none' || +c.opacity < .05,
      bgA: +window.__a(c.backgroundColor).toFixed(3), bf: c.backdropFilter || 'none',
      inView: r.x >= -1 && r.y >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 };
  }
  return o;
}, CARDS);

const settle = async () => {
  let prev = null;
  for (let i = 0; i < 40; i++) {
    const now = await page.evaluate((IDS) => IDS.map((id) => {
      const e = document.getElementById(id); if (!e) return null;
      const r = e.getBoundingClientRect(); return [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)];
    }), CARDS);
    if (prev && JSON.stringify(prev) === JSON.stringify(now)) return now;
    prev = now; await sleep(350);
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
put('A_initial', { rects: Object.fromEntries(CARDS.map((id) => [id, initialMini[id] && initialMini[id].rect])),
  expanded: expandedIds(initialMini), closeEls: await page.evaluate(() => document.querySelectorAll('.gev-lc-close').length),
  allBgA0: CARDS.every((id) => !initialMini[id] || initialMini[id].bgA === 0),
  bfAny: CARDS.filter((id) => initialMini[id] && initialMini[id].bf !== 'none') });
await page.screenshot({ path: path.join(OUT, 'E1-initial.png') });

const HEADER_SEL = '.panel-header, .pp-header-row, .dock-header, header, .location-toolbar-label, .panel-title, .pp-header-label';
// 语音卡没有 header 类元素：退回「卡片矩形顶部中心」作为标题区
const clickToggle = async (id) => {
  const before = (await stateAll())[id];
  // 候选点必须真的落在「这张卡自己的 header」上（elementFromPoint 归属校验）——
  // 否则展开卡覆盖的位置上点下去会点到别的卡，把展开卡关掉（round-3 首跑就是这么失败的）。
  const pts = await page.evaluate((id, SEL) => {
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
        if (!(hh && el.contains(hh) && owner === id)) continue;
        out.push({ x, y, owner, hit: e ? e.tagName + '.' + String(e.className || '').slice(0, 24) : '' });
      }
    }
    if (!out.length) {
      const r = el.getBoundingClientRect();
      const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + Math.min(12, r.height / 2));
      const e = document.elementFromPoint(x, y);
      const owner = e && e.closest ? ((e.closest('.gev-lc') || {}).id || null) : null;
      if (owner === id) out.push({ x, y, owner, hit: e ? e.tagName + '.' + String(e.className || '').slice(0, 24) : '' });
    }
    return out;
  }, id, HEADER_SEL);
  const tries = [];
  for (const p of pts.slice(0, 10)) {
    await page.mouse.move(p.x, p.y); await sleep(50);
    await page.mouse.down(); await sleep(45); await page.mouse.up();
    await sleep(950);
    const now = (await stateAll())[id];
    const changed = isExpanded(now, id) !== isExpanded(before, id);
    tries.push({ at: [p.x, p.y], hit: p.hit, owner: p.owner, expandedAfter: isExpanded(now, id) });
    if (changed) return { id, ok: true, tries, expanded: isExpanded(now, id) };
    await sleep(150);
  }
  return { id, ok: false, tries, expanded: isExpanded((await stateAll()), id) };
};
const collapseAll = async () => {
  for (const id of SEVEN) {
    const st = await stateAll();
    if (!isExpanded(st, id)) continue;
    await clickToggle(id);
    await sleep(400);
  }
  await settle();
};

// ── B) 互斥 5 组：逐帧采样 + 关旧→开新顺序 ──
const switchCase = async (from, to) => {
  let st = await stateAll();
  if (!isExpanded(st, from)) { await clickToggle(from); await sleep(900); }
  await settle();
  await page.evaluate((L, R) => {
    window.__tl = []; window.__stop = false;
    const t0 = performance.now();
    const tick = () => {
      if (window.__stop) return;
      const open = (ids) => ids.filter((i) => { const e = document.getElementById(i); if (!e) return false; const r = e.getBoundingClientRect(); return !e.classList.contains('collapsed') && r.width > 200; }).length;
      window.__tl.push({ t: +(performance.now() - t0).toFixed(1), l: open(L), r: open(R) });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, LEFT, RIGHT);
  const orderPromise = page.evaluate((from, to) => new Promise((resolve) => {
    const t0 = performance.now();
    const rec = { fromClose: null, toOpen: null };
    const f = document.getElementById(from), t = document.getElementById(to);
    const obs = new MutationObserver(() => {
      if (rec.fromClose === null && f.classList.contains('collapsed')) rec.fromClose = +(performance.now() - t0).toFixed(2);
      if (rec.toOpen === null && !t.classList.contains('collapsed')) rec.toOpen = +(performance.now() - t0).toFixed(2);
      if (rec.fromClose !== null && rec.toOpen !== null) { obs.disconnect(); resolve(rec); }
    });
    obs.observe(f, { attributes: true, attributeFilter: ['class'] });
    obs.observe(t, { attributes: true, attributeFilter: ['class'] });
    setTimeout(() => { obs.disconnect(); resolve(rec); }, 4000);
  }), from, to);
  const click = await clickToggle(to);
  await sleep(1600);
  const tl = await page.evaluate(() => { window.__stop = true; return window.__tl; });
  const order = await orderPromise;
  const st2 = await stateAll();
  return { case: from + '->' + to, clicked: click.ok, frames: tl.length,
    maxLeft: Math.max(...tl.map((s) => s.l)), maxRight: Math.max(...tl.map((s) => s.r)),
    emptyFrames: tl.filter((s) => s.l === 0 && s.r === 0).length, order,
    fromVisible: !st2[from].hidden, fromInView: st2[from].inView,
    toOpen: isExpanded(st2, to), fromClosed: !isExpanded(st2, from),
    endExpanded: expandedIds(st2) };
};
const mutex = [];
for (const [from, to] of [['data-panel', 'scene-panel'], ['scene-panel', 'data-panel'],
  ['pp-toggles', 'cctv-panel'], ['cctv-panel', 'global-context-panel'], ['global-context-panel', 'pp-toggles']]) {
  mutex.push(await switchCase(from, to));
  await page.screenshot({ path: path.join(OUT, 'E2-switch-' + from + '-to-' + to + '.png') });
}
put('B_mutex', mutex);
// 旧 header 回切：从当前展开的卡点回上一张
const backSwitch = [];
for (const [nowOpen, back] of [['global-context-panel', 'pp-toggles'], ['pp-toggles', 'cctv-panel'], ['cctv-panel', 'global-context-panel']]) {
  const st = await stateAll();
  if (!isExpanded(st, nowOpen)) { await clickToggle(nowOpen); await sleep(900); }
  const c = await clickToggle(back);
  await sleep(1200);
  const s2 = await stateAll();
  backSwitch.push({ clicked: back, ok: c.ok, backOpen: isExpanded(s2, back), oldClosed: !isExpanded(s2, nowOpen) });
}
put('B2_old_header_back', backSwitch);

// ── C) pp 展开：真滚轮 + minGap + 黑底黑字 ──
await collapseAll();
let st = await stateAll();
if (!isExpanded(st, 'pp-toggles')) { await clickToggle('pp-toggles'); await sleep(1200); }
await settle();
const ppScroll = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height * 0.6),
    clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
});
await page.mouse.move(ppScroll.x, ppScroll.y);
const scrollTrace = [ppScroll.scrollTop];
for (let i = 0; i < 8; i++) {
  await page.mouse.wheel({ deltaY: 120 }); await sleep(180);
  scrollTrace.push(await page.evaluate(() => Math.round(document.getElementById('pp-toggles').scrollTop)));
}
await page.screenshot({ path: path.join(OUT, 'E3-pp-scrolled.png') });
const ppInfo = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  const rows = [...el.querySelectorAll('.pp-toggle-btn, .pp-slider-row, .pp-toggle-group, .pp-mode-btn')]
    .map((e) => { const r = e.getBoundingClientRect(); return { cls: String(e.className).slice(0, 34), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1), h: +r.height.toFixed(1) }; })
    .filter((r) => r.h > 2);
  rows.sort((a, b) => a.top - b.top);
  let minGap = Infinity, gapPair = null;
  for (let i = 1; i < rows.length; i++) {
    const g = rows[i].top - rows[i - 1].bottom;
    if (g < minGap) { minGap = g; gapPair = [rows[i - 1].cls, rows[i].cls]; }
  }
  // 兄弟控件级重叠
  const sib = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    if (ix > 2 && iy > 2) sib.push({ a: a.cls, b: b.cls, ix: +ix.toFixed(0), iy: +iy.toFixed(0) });
  }
  // 黑底黑字普查
  const dark = [], solid = [];
  const a = (c) => { const s = String(c || ''); const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return /^rgb\(/.test(s) ? 1 : 0; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; };
  for (const e of el.querySelectorAll('button, .pp-toggle-btn, .pp-mode-btn, .pp-select, .pp-slider-row')) {
    const c = getComputedStyle(e);
    const bg = c.backgroundColor, col = c.color;
    const bgA = a(bg);
    const darkText = /rgb\(\s*(\d+),\s*(\d+),\s*(\d+)/.test(col) ? (() => { const m = col.match(/rgba?\(([^)]+)\)/)[1].split(/[,\s/]+/).filter(Boolean).map(Number); return (m[0] + m[1] + m[2]) / 3 < 90; })() : false;
    if (bgA > 0.5) solid.push({ cls: String(e.className).slice(0, 30), bg, bgA: +bgA.toFixed(2) });
    if (a(bg) > 0.3 && darkText) dark.push({ cls: String(e.className).slice(0, 30), bg, color: col });
  }
  const clipped = [...el.querySelectorAll('.pp-toggle-btn, .pp-slider-row')].filter((e) => e.scrollWidth > e.clientWidth + 2 || e.scrollHeight > e.clientHeight + 2)
    .map((e) => String(e.className).slice(0, 30));
  return { minGap: +minGap.toFixed(1), gapPair, siblings: rows.length, siblingOverlaps: sib.slice(0, 6), dark, solid: solid.slice(0, 8), clipped: clipped.slice(0, 6) };
});
put('C_pp', { box: ppScroll, scrollTrace, minGap: ppInfo.minGap, gapPair: ppInfo.gapPair, siblings: ppInfo.siblings,
  siblingOverlaps: ppInfo.siblingOverlaps, dark: ppInfo.dark, solid: ppInfo.solid, clipped: ppInfo.clipped });
// 滚回顶部 + header sticky 命中
await page.mouse.wheel({ deltaY: -2000 }); await sleep(500);

// ── D) 快速连点 14 击（0 漏击）──
await collapseAll();
const seq = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel',
  'global-context-panel', 'location-bar', 'control-panel'];
const taps = [];
for (const id of seq) {
  const c = await clickToggle(id);
  taps.push({ id, toggled: c.ok, tries: c.tries.length, hit: c.tries[c.tries.length - 1] && c.tries[c.tries.length - 1].hit, owner: c.tries[c.tries.length - 1] && c.tries[c.tries.length - 1].owner });
  await sleep(80);
}
await sleep(1800); await settle();
const afterRapid = await stateAll();
const rects = expandedIds(afterRapid).map((id) => ({ id, r: afterRapid[id].rect }));
const overlaps = [];
for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
  const a = rects[i].r, b = rects[j].r;
  const ix = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  if (ix > 2 && iy > 2) overlaps.push({ a: rects[i].id, b: rects[j].id, ix: +ix.toFixed(0), iy: +iy.toFixed(0) });
}
put('D_rapid', { count: taps.length, missed: taps.filter((t) => !t.toggled).map((t) => ({ id: t.id, hit: t.hit, owner: t.owner })),
  toggled: taps.filter((t) => t.toggled).length + '/' + taps.length,
  endExpanded: expandedIds(afterRapid), overlaps,
  outOfView: CARDS.filter((id) => afterRapid[id] && !afterRapid[id].inView) });
await page.screenshot({ path: path.join(OUT, 'E4-rapid.png') });

// ── E) 收起归位 ──
await collapseAll();
await sleep(1200); await settle();
const collapsed = await stateAll();
const diff = [];
for (const id of CARDS) {
  if (id === 'gev-gfx-fab') continue;
  const a = initialMini[id].rect, b = collapsed[id].rect;
  const d = Math.max(...a.map((u, i) => Math.abs(u - b[i])));
  if (d > 1.5) diff.push({ id, initial: a, now: b, delta: +d.toFixed(1) });
}
put('E_collapse', { expanded: expandedIds(collapsed), rectDiff: diff, allInView: CARDS.every((id) => !collapsed[id] || collapsed[id].inView) });
await page.screenshot({ path: path.join(OUT, 'E5-collapsed.png') });

// ── G) FPS（预热后 3 段 4s）──
const fps = [];
for (let k = 0; k < 3; k++) {
  fps.push(await page.evaluate(() => new Promise((r) => {
    let n = 0; const t0 = performance.now();
    const tick = () => { n++; const dt = performance.now() - t0; if (dt < 4000) requestAnimationFrame(tick); else r({ frames: n, fps: +(n / (dt / 1000)).toFixed(1) }); };
    requestAnimationFrame(tick);
  })));
  await sleep(300);
}
put('G_fps', { runs: fps, median: fps.map((f) => f.fps).sort((a, b) => a - b)[1] });

// ── H) 重载 → 仍全 mini（分时刻采样）──
const trustBefore = await page.evaluate(() => window.__rv);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
const samples = {};
for (const t of [3000, 8000, 15000]) {
  await sleep(t === 3000 ? 3000 : 5000);
  await page.evaluate(() => {
    window.__a = (c) => { const s = String(c || ''); const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return /^rgb\(/.test(s) ? 1 : 0; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; };
  });
  const s2 = await stateAll();
  samples['t+' + t] = { expanded: expandedIds(s2), rects: Object.fromEntries(CARDS.map((id) => [id, s2[id] && s2[id].rect])) };
}
put('H_reload', { samples, trustBefore, after: await page.evaluate(() => window.__rv) });
await page.screenshot({ path: path.join(OUT, 'E6-reloaded.png') });

fs.writeFileSync(path.join(OUT, 'matrix.json'), JSON.stringify(res, null, 2));
await browser.close();
console.log('DONE matrix.json');
