#!/usr/bin/env node
/**
 * _final-glass-qa.mjs —— t_829dd186 透明液态玻璃验收（1536×730，真实 CDP 鼠标点击）
 *
 * 断言：
 *   1) 初始全 mini：9 卡不展开、无 ✕、中心透明（无 backdrop-filter / 背景 alpha ≤ .02）
 *   2) 7 个 header 真实点击都能打开对应卡
 *   3) 左栏 data↔scene、右栏 pp↔cctv↔global：最多 1 张；切换「先关旧再开新」（时间线采样证明）
 *   4) pp 展开：鼠标滚轮可滚、选项不挤、小卡片透明
 *   5) 快速连点全部：不乱跳 / 不叠 / 不遮挡 / 终态确定
 *   6) 收起全部：回 mini 原位（与初始 rect 逐卡相同）
 *
 * 用法: node scripts/_final-glass-qa.mjs [--tag=f1] [--headful] [--w=1536] [--h=730]
 * 产物: .gev-logs/final/<tag>/{report.json,step-*.png}
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith('--' + k + '='));
  return a ? a.split('=')[1] : d;
};
const TAG = arg('tag', 'f1');
const W = +arg('w', 1536);
const H = +arg('h', 730);
const HEADFUL = process.argv.includes('--headful');
const OUT = path.resolve('.gev-logs/final', TAG);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IDS = [
  'data-panel',
  'scene-panel',
  'pp-toggles',
  'cctv-panel',
  'global-context-panel',
  'location-bar',
  'control-panel',
  'gev-voice-control',
  'gev-gfx-fab',
];
const HEADERS = [
  ['data-panel', '#data-panel .panel-header'],
  ['scene-panel', '#scene-panel .panel-header'],
  ['pp-toggles', '#pp-toggles .pp-header-row'],
  ['cctv-panel', '#cctv-panel .panel-header'],
  ['global-context-panel', '#global-context-panel .panel-header'],
  ['location-bar', '#location-bar .dock-tray-toggle, #location-bar-toggle, #location-bar .panel-header'],
  ['control-panel', '#control-panel .dock-tray-toggle, #control-panel-toggle, #control-panel .panel-header'],
];
const GROUPS = {
  left: ['data-panel', 'scene-panel'],
  right: ['pp-toggles', 'cctv-panel', 'global-context-panel'],
  dock: ['location-bar', 'control-panel', 'gev-voice-control'],
};

const report = { tag: TAG, viewport: [W, H], started: new Date().toISOString(), steps: [], failures: [], timeline: {}, material: {}, fps: null };

const fail = (m) => {
  report.failures.push(m);
  console.log('FAIL:', m);
};

const browser = await puppeteer.launch({
  headless: !HEADFUL,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox',
    '--enable-gpu',
    '--use-angle=d3d11',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    `--window-size=${W + 24},${H + 130}`,
    '--window-position=1900,40',
    '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
  ],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });

// 冷启动：清掉持久化（复刻 Ego Lite 首次打开）
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.removeItem('gev-liquid-cards:v2');
    localStorage.removeItem('gev-liquid-cards:v2:last');
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    window.__gevcDebug = true;
    window.__ptr = [];
    addEventListener(
      'pointerdown',
      (e) => {
        const t = e.target?.closest?.('.gev-lc');
        window.__ptr.push({ trusted: e.isTrusted, id: t?.id || '(none)', ts: Math.round(performance.now()) });
      },
      true
    );
  } catch (e) {}
});

const consoleErrs = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrs.push(m.text().slice(0, 300));
});

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });

// 等 9 张卡登记 + prime 完成（全 mini）
await page.waitForFunction(() => document.querySelectorAll('.gev-lc').length >= 9, { timeout: 120000 });
await page.waitForFunction(
  () => {
    const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
    return ids.every((id) => document.getElementById(id)?.classList.contains('gev-lc'));
  },
  { timeout: 120000 }
);
// 等地图/字体/芯片沉降（Ego Lite 冷启动 ~8s）
await sleep(9000);

/* ── 页面内工具 ───────────────────────────────────────────────────────── */
const installQa = () =>
  page.evaluate(() => {
  const IDS = [
    'data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
    'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab',
  ];
  const alpha = (c) => {
    if (!c || c === 'transparent') return 0;
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return 0;
    const p = m[1].split(',').map((s) => parseFloat(s));
    return p.length > 3 ? p[3] : 1;
  };
  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    return true;
  };
  window.__qa = {
    alpha,
    vis,
    state() {
      const out = {};
      for (const id of IDS) {
        const el = document.getElementById(id);
        if (!el) { out[id] = null; continue; }
        const b = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        out[id] = {
          rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)],
          collapsed: el.classList.contains('collapsed'),
          floating: el.classList.contains('gev-lc-floating'),
          hidden: !window.__qa.vis(el),
          bg: cs.backgroundColor,
          bgA: +window.__qa.alpha(cs.backgroundColor).toFixed(3),
          bd: cs.backdropFilter,
          inView: b.left >= -1 && b.top >= -1 && b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1,
        };
      }
      return out;
    },
    // 材质审计：卡自己的背景/blur + 子树里所有可见层的 backdrop-filter / 大块深色底
    audit() {
      const res = { blur: [], dark: [], warpShown: [], closeBtns: [], xGlyph: [] };
      for (const id of IDS) {
        const el = document.getElementById(id);
        if (!el) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 2) continue;
        const walk = [el, ...el.querySelectorAll('*')];
        for (const n of walk) {
          const cs = getComputedStyle(n);
          if (!window.__qa.vis(n)) continue;
          const bf = cs.backdropFilter || cs.webkitBackdropFilter;
          if (bf && bf !== 'none' && !/blur\(0px\)/.test(bf)) {
            const nb = n.getBoundingClientRect();
            if (nb.width > 8 && nb.height > 8)
              res.blur.push({ id, node: n.className?.toString?.().slice(0, 60) || n.tagName, bf, area: Math.round(nb.width * nb.height) });
          }
          const a = window.__qa.alpha(cs.backgroundColor);
          // 「暗底」判定：alpha 有量 + 颜色本身是深色（白 5% 玻璃 tint 不算暗底）
          const mm = (cs.backgroundColor || '').match(/rgba?\(([^)]+)\)/);
          const p3 = mm ? mm[1].split(',').map((s) => parseFloat(s)) : [0, 0, 0];
          const lum = Math.max(p3[0] || 0, p3[1] || 0, p3[2] || 0);
          const isDark = a > 0.1 && lum < 96;
          if (isDark) {
            const nb = n.getBoundingClientRect();
            const cls = n.className?.toString?.() || '';
            // 排除已知强调色/激活态（青、绿）与图标/文字层
            const isAccent = /active|\.on|pressed|accent/i.test(cls);
            const big = nb.width * nb.height > 900;
            if (big && !isAccent)
              res.dark.push({
                id,
                node: (n.id ? '#' + n.id + ' ' : '') + cls.slice(0, 60),
                bg: cs.backgroundColor,
                a: +a.toFixed(3),
                area: Math.round(nb.width * nb.height),
              });
          }
        }
        const warp = el.querySelector('.gev-lg-warp');
        if (warp && window.__qa.vis(warp)) res.warpShown.push(id);
        const cl = el.querySelectorAll('.gev-lc-close');
        if (cl.length) res.closeBtns.push({ id, n: cl.length, visible: [...cl].filter((n) => window.__qa.vis(n)).length });
        // 任何 ✕ 字形（未删除的圆形关闭钮）——查全页
      }
      const isX = (n) => window.__qa.vis(n) && /^[✕✖✗×]$/.test((n.textContent || '').trim()) && n.children.length === 0;
      const inCard = [...document.querySelectorAll('.gev-lc *, #left-panel-stack *, #right-context-rail *, #command-dock *, .dock-popover-content *')].filter(isX);
      res.xGlyph = inCard.slice(0, 10).map((n) => ({ tag: n.tagName, cls: (n.className || '').toString().slice(0, 50), txt: n.textContent.trim() }));
      // 卡外（Cesium 版权框 / 载具档案框）只记录，不算卡的关闭钮
      const outCard = [...document.querySelectorAll('body *')].filter((n) => isX(n) && !n.closest('.gev-lc, #left-panel-stack, #right-context-rail, #command-dock'));
      res.xExternal = outCard.slice(0, 5).map((n) => ({ tag: n.tagName, cls: (n.className || '').toString().slice(0, 50), chain: (n.parentElement?.className || '').toString().slice(0, 40) }));
      return res;
    },
    headerHit(hsel) {
      const h = document.querySelector(hsel);
      if (!h) return { err: 'no header' };
      const b = h.getBoundingClientRect();
      const x = Math.round(b.left + b.width / 2);
      const y = Math.round(b.top + b.height / 2);
      const hit = document.elementFromPoint(x, y);
      const card = hit?.closest?.('.gev-lc');
      return {
        pt: [x, y],
        headerRect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)],
        hitId: card?.id || '(none)',
        hitTag: hit?.tagName,
        hitCls: (hit?.className || '').toString().slice(0, 60),
      };
    },
  };
  });
await installQa();
const qa = (fn, ...a) => page.evaluate((f, args) => window.__qa[f](...args), fn, a);
const state = () => qa('state');
const audit = () => qa('audit');
const headerHit = (sel) => qa('headerHit', sel);

const shot = async (name) => {
  const p = path.join(OUT, name + '.png');
  await page.screenshot({ path: p });
  return p;
};

const settle = async (ms = 700) => {
  await sleep(ms);
  // 等所有 WAAPI 动画结束（最多 1.5s）
  try {
    await page.waitForFunction(
      () => [...document.querySelectorAll('.gev-lc')].every((e) => e.getAnimations().every((a) => a.playState !== 'running')),
      { timeout: 2500 }
    );
  } catch (e) {}
  await sleep(120);
};

const snapshot = async (label) => {
  const st = await state();
  const openByGroup = {};
  for (const [g, ids] of Object.entries(GROUPS)) openByGroup[g] = ids.filter((i) => st[i]?.floating);
  const overlapping = [];
  const ids = IDS.filter((i) => st[i] && st[i].rect[2] > 2);
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const A = st[ids[i]].rect, B = st[ids[j]].rect;
      const ix = Math.max(0, Math.min(A[0] + A[2], B[0] + B[2]) - Math.max(A[0], B[0]));
      const iy = Math.max(0, Math.min(A[1] + A[3], B[1] + B[3]) - Math.max(A[1], B[1]));
      if (ix * iy > 64) overlapping.push({ a: ids[i], b: ids[j], area: ix * iy });
    }
  const outOfView = ids.filter((i) => !st[i].inView);
  const hidden = ids.filter((i) => st[i].hidden);
  const rec = { label, openByGroup, overlapping, outOfView, hidden, state: st };
  report.steps.push(rec);
  return rec;
};

const clickHeader = async (id, hsel, waitMs = 900) => {
  const hit = await headerHit(hsel);
  if (hit.err) {
    fail(`header missing: ${id}`);
    return hit;
  }
  if (hit.hitId !== id) fail(`header hit mismatch ${id} → ${hit.hitId} @${hit.pt}`);
  await page.mouse.move(hit.pt[0], hit.pt[1]);
  await page.mouse.down();
  await sleep(40);
  await page.mouse.up();
  await settle(waitMs);
  return hit;
};

/* ── 1) 初始态 ───────────────────────────────────────────────────────── */
const st0 = await snapshot('initial');
report.initialRects = Object.fromEntries(IDS.map((i) => [i, st0.state[i]?.rect]));
const EXPANDABLE = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const expanded0 = EXPANDABLE.filter((i) => st0.state[i] && !st0.state[i].collapsed);
if (expanded0.length) fail(`初始态有展开卡: ${expanded0.join(',')}`);
const floating0 = IDS.filter((i) => st0.state[i]?.floating);
if (floating0.length) fail(`初始态有浮层卡: ${floating0.join(',')}`);
const oov0 = IDS.filter((i) => st0.state[i] && !st0.state[i].inView);
if (oov0.length) fail(`初始态有卡飞出屏幕: ${oov0.join(',')}`);
const audit0 = await audit();
report.material.initial = audit0;
if (audit0.blur.length) fail(`初始态存在 backdrop-filter: ${audit0.blur.map((b) => b.id + '/' + b.bf).join(' | ')}`);
if (audit0.dark.length) fail(`初始态存在深色底: ${audit0.dark.map((d) => d.id + '/' + d.node + '/' + d.bg).join(' | ')}`);
if (audit0.warpShown.length) fail(`.gev-lg-warp 可见: ${audit0.warpShown.join(',')}`);
if (audit0.closeBtns.some((c) => c.visible)) fail(`可见 ✕ 关闭钮: ${JSON.stringify(audit0.closeBtns)}`);
if (audit0.xGlyph.length) fail(`页面出现 ✕ 字形: ${JSON.stringify(audit0.xGlyph)}`);
await shot('step-01-initial');
console.log('initial:', JSON.stringify({ expanded0, floating0, blur: audit0.blur.length, dark: audit0.dark.length, warp: audit0.warpShown.length, x: audit0.xGlyph.length }));

/* ── 2) 7 个 header 真实点击 ─────────────────────────────────────────── */
/* 时间线采样：click 之后 900ms 内每 16ms 记录每组浮层数量（证明「先关旧再开新」） */
const watchTimeline = async (ms) =>
  page.evaluate(
    (dur) =>
      new Promise((resolve) => {
        const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
        const G = { left: ['data-panel', 'scene-panel'], right: ['pp-toggles', 'cctv-panel', 'global-context-panel'], dock: ['location-bar', 'control-panel'] };
        const frames = [];
        const t0 = performance.now();
        const tick = () => {
          const cur = {};
          for (const id of IDS) cur[id] = document.getElementById(id)?.classList.contains('gev-lc-floating') ? 1 : 0;
          frames.push({ t: Math.round(performance.now() - t0), cur });
          if (performance.now() - t0 < dur) setTimeout(tick, 16);
          else {
            const maxSimul = {};
            for (const [g, ids] of Object.entries(G)) maxSimul[g] = Math.max(...frames.map((f) => ids.reduce((s, i) => s + f.cur[i], 0)));
            resolve({ frames: frames.filter((f, i) => i === 0 || i === frames.length - 1 || JSON.stringify(f.cur) !== JSON.stringify(frames[i - 1].cur)), maxSimul });
          }
        };
        tick();
      }),
    ms
  );

const opened = [];
for (const [id, hsel] of HEADERS) {
  const hit = await clickHeader(id, hsel, 1000);
  const snap = await snapshot('click-' + id);
  const st = snap.state[id];
  const ok = st && st.floating && !st.collapsed;
  if (!ok) fail(`点击 header 未打开 ${id}: ${JSON.stringify(st)}`);
  else opened.push(id);
  for (const [g, ids] of Object.entries(GROUPS)) {
    const f = ids.filter((i) => snap.state[i]?.floating);
    if (f.length > 1) fail(`组 ${g} 同时展开 ${f.length} 张: ${f.join(',')}`);
  }
  if (snap.overlapping.length) fail(`click-${id} 重叠: ${JSON.stringify(snap.overlapping)}`);
  if (snap.outOfView.length) fail(`click-${id} 飞出屏幕: ${snap.outOfView.join(',')}`);
  await shot('step-02-open-' + id);
}
report.openedByClick = opened;

/* 材质审计：每张展开态单独再查一次（此时最后一轮只有一张展开 = control-panel，已在上面快照；
   其余卡的展开态材质在 click 步骤期间已测 —— 这里对所有展开过的卡做一次全量审计） */
const auditExpandedAll = {};
for (const [id, hsel] of HEADERS) {
  // 确保该卡是当前打开的（同组互斥，其它组的卡可能也开着 → 关掉它们再开这张，保证审计就是这张的展开态）
  await page.evaluate((i) => window.__gevLc.close(i), id);
  await settle(400);
  await clickHeader(id, hsel, 900);
  const a = await audit();
  auditExpandedAll[id] = a;
  if (a.blur.length) fail(`展开态 ${id} 存在 backdrop-filter: ${a.blur.map((b) => b.node + '/' + b.bf).join(' | ')}`);
  if (a.dark.length) fail(`展开态 ${id} 存在深色底: ${a.dark.map((d) => d.node + '/' + d.bg).join(' | ')}`);
  if (a.closeBtns.some((c) => c.visible)) fail(`展开态 ${id} 出现可见 ✕`);
  await shot('step-02b-expanded-mat-' + id);
}
report.material.expanded = Object.fromEntries(
  Object.entries(auditExpandedAll).map(([k, v]) => [k, { blur: v.blur.length, dark: v.dark.length, warp: v.warpShown.length, x: v.xGlyph.length, darkList: v.dark }])
);

/* ── 3) 左右互斥切换 + 先关旧再开新（时间线） ─────────────────────────── */
const mutexTests = [
  ['left', 'data-panel', 'scene-panel'],
  ['left', 'scene-panel', 'data-panel'],
  ['right', 'pp-toggles', 'cctv-panel'],
  ['right', 'cctv-panel', 'global-context-panel'],
  ['right', 'global-context-panel', 'pp-toggles'],
];
for (const [g, from, to] of mutexTests) {
  // 复位：关掉所有浮层
  await page.evaluate(() => ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'].forEach((i) => window.__gevLc.close(i)));
  await settle(600);
  await clickHeader(from, HEADERS.find((h) => h[0] === from)[1], 800);
  const beforeState = await state();
  if (!beforeState[from]?.floating) fail(`mutex 预备失败：${from} 未展开`);
  const hit2 = await headerHit(HEADERS.find((h) => h[0] === to)[1]);
  await page.evaluate(() => {
    const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
    window.__tl = [];
    window.__tlT0 = performance.now();
    window.__tlTimer = setInterval(() => {
      const cur = {};
      for (const id of IDS) cur[id] = document.getElementById(id)?.classList.contains('gev-lc-floating') ? 1 : 0;
      window.__tl.push({ t: Math.round(performance.now() - window.__tlT0), cur });
    }, 16);
  });
  await page.mouse.move(hit2.pt[0], hit2.pt[1]);
  await page.mouse.down();
  await sleep(40);
  await page.mouse.up();
  await sleep(1200);
  const tl2 = await page.evaluate(() => {
    clearInterval(window.__tlTimer);
    const frames = window.__tl;
    const G = { left: ['data-panel', 'scene-panel'], right: ['pp-toggles', 'cctv-panel', 'global-context-panel'], dock: ['location-bar', 'control-panel'] };
    const maxSimul = {};
    for (const [g, ids] of Object.entries(G)) maxSimul[g] = Math.max(...frames.map((f) => ids.reduce((s, i) => s + f.cur[i], 0)));
    const changes = frames.filter((f, i) => i === 0 || JSON.stringify(f.cur) !== JSON.stringify(frames[i - 1].cur));
    // 目标卡是否曾经被隐藏（visibility/opacity）
    const tEl = document.getElementById(window.__tlTarget);
    return { maxSimul, changes, frames: frames.length };
  });
  const after = await state();
  if (!after[to]?.floating) fail(`切换失败 ${from}→${to}: 目标未展开`);
  if (after[from]?.floating) fail(`切换失败 ${from}→${to}: 旧卡仍展开`);
  if (tl2.maxSimul[g] > 1) fail(`组 ${g} 切换时同时展开 ${tl2.maxSimul[g]} 张（时间线）`);
  report.timeline[`${from}->${to}`] = tl2;
  const hitCheck = await headerHit(HEADERS.find((h) => h[0] === to)[1]);
  if (hitCheck.hitId !== to) fail(`切换后 ${to} header 不可点（命中 ${hitCheck.hitId}）`);
  await snapshot('switch-' + from + '-to-' + to);
  await shot('step-03-switch-' + from + '-to-' + to);
  console.log('switch', from, '→', to, 'maxSimul', JSON.stringify(tl2.maxSimul), 'changes', tl2.changes.length);
}

/* ── 4) pp 展开：滚轮 / 选项不挤 / 小卡片透明 ─────────────────────────── */
await page.evaluate(() => ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'].forEach((i) => window.__gevLc.close(i)));
await settle(600);
await clickHeader('pp-toggles', '#pp-toggles .pp-header-row', 1000);
const ppBefore = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  const b = el.getBoundingClientRect();
  const body = el.querySelector('.pp-panel-body') || el;
  const rows = [...el.querySelectorAll('.pp-toggle-group, .pp-slider-row, .pp-header-row, .pp-toggle-btn, .pp-mode-btn')].map((n) => {
    const r = n.getBoundingClientRect();
    return { node: n, cls: (n.className || '').toString().slice(0, 40), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
  });
  // 行间距：相邻行 top 差 - 高（只比同级/异级但非父子关系的行）
  const gaps = [];
  const sorted = rows.filter((r) => r.rect[3] > 4).sort((a, b) => a.rect[1] - b.rect[1]);
  for (let i = 1; i < sorted.length; i++) {
    const A = sorted[i - 1], B = sorted[i];
    if (A.node.contains(B.node) || B.node.contains(A.node)) continue;
    gaps.push(B.rect[1] - (A.rect[1] + A.rect[3]));
  }
  return {
    rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)],
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    scrollable: el.scrollHeight > el.clientHeight + 2,
    minGap: gaps.length ? Math.min(...gaps) : null,
    overlapRows: (() => {
      let ov = 0;
      for (let i = 0; i < sorted.length; i++)
        for (let j = i + 1; j < sorted.length; j++) {
          // 父子不算重叠（.pp-toggle-group 与内部按钮矩形本来就相同）
          if (sorted[i].node.contains(sorted[j].node) || sorted[j].node.contains(sorted[i].node)) continue;
          const A = sorted[i].rect, B = sorted[j].rect;
          const ix = Math.max(0, Math.min(A[0] + A[2], B[0] + B[2]) - Math.max(A[0], B[0]));
          const iy = Math.max(0, Math.min(A[1] + A[3], B[1] + B[3]) - Math.max(A[1], B[1]));
          if (ix * iy > 40) ov++;
        }
      return ov;
    })(),
    smallCards: [...el.querySelectorAll('.pp-toggle-btn, .pp-mode-btn')].slice(0, 10).map((n) => {
      const cs = getComputedStyle(n);
      return { cls: (n.className || '').toString().slice(0, 30), bg: cs.backgroundColor, color: cs.color, bd: cs.backdropFilter };
    }),
  };
});
report.pp = { before: ppBefore };
await shot('step-04-pp-open');
const ppRect = ppBefore.rect;
await page.mouse.move(ppRect[0] + ppRect[2] / 2, ppRect[1] + ppRect[3] / 2);
await page.mouse.wheel({ deltaY: 260 });
await sleep(400);
await page.mouse.wheel({ deltaY: 260 });
await sleep(500);
const ppAfter = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  return { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
});
report.pp.after = ppAfter;
if (!ppBefore.scrollable) fail(`pp 展开内容不可滚（scrollHeight ${ppBefore.scrollHeight} ≤ clientHeight ${ppBefore.clientHeight}）`);
if (ppAfter.scrollTop <= 0) fail(`pp 鼠标滚轮无效：scrollTop 仍 ${ppAfter.scrollTop}`);
if (ppBefore.overlapRows > 0) fail(`pp 选项互相重叠 ${ppBefore.overlapRows} 处`);
if (ppBefore.smallCards.some((c) => /rgba\(0, 0, 0/.test(c.bg) && !/,\s*0\)/.test(c.bg))) fail(`pp 小卡片黑底: ${JSON.stringify(ppBefore.smallCards.filter((c) => /rgba\(0, 0, 0/.test(c.bg)))}`);
if (ppBefore.smallCards.some((c) => c.bd && c.bd !== 'none')) fail(`pp 小卡片有 backdrop-filter`);
await shot('step-04b-pp-scrolled');
console.log('pp:', JSON.stringify({ ...ppBefore, smallCards: ppBefore.smallCards.length, after: ppAfter }));

/* ── 5) 快速连点全部 ─────────────────────────────────────────────────── */
await page.evaluate(() => ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'].forEach((i) => window.__gevLc.close(i)));
await settle(700);
const order = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
for (const id of order) {
  const hit = await headerHit(HEADERS.find((h) => h[0] === id)[1]);
  if (hit.hitId !== id) fail(`快速连点 ${id}: header 被遮（命中 ${hit.hitId}）`);
  await page.mouse.move(hit.pt[0], hit.pt[1]);
  await page.mouse.down();
  await sleep(20);
  await page.mouse.up();
  await sleep(70);
}
await sleep(1600);
const rapid = await snapshot('rapid-final');
if (rapid.overlapping.length) fail(`快速连点后重叠: ${JSON.stringify(rapid.overlapping)}`);
if (rapid.outOfView.length) fail(`快速连点后飞出屏幕: ${rapid.outOfView.join(',')}`);
if (rapid.hidden.length) fail(`快速连点后隐形卡: ${rapid.hidden.join(',')}`);
for (const [g, ids] of Object.entries(GROUPS)) {
  const f = ids.filter((i) => rapid.state[i]?.floating);
  if (f.length > 1) fail(`快速连点后组 ${g} 展开 ${f.length} 张: ${f.join(',')}`);
}
await shot('step-05-rapid-final');
console.log('rapid:', JSON.stringify(rapid.openByGroup));

/* ── 6) 收起全部 → 回 mini 原位 ─────────────────────────────────────── */
await page.evaluate(() => ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'].forEach((i) => window.__gevLc.close(i)));
await settle(900);
const stEnd = await snapshot('collapsed-all');
const diff = [];
for (const id of IDS) {
  const a = report.initialRects[id], b = stEnd.state[id]?.rect;
  if (!a || !b) continue;
  if (JSON.stringify(a) !== JSON.stringify(b)) diff.push({ id, initial: a, now: b });
}
report.collapseDiff = diff;
if (diff.length) fail(`收起后未回原位: ${JSON.stringify(diff)}`);
if (EXPANDABLE.some((i) => stEnd.state[i] && !stEnd.state[i].collapsed)) fail(`收起后仍有展开卡: ${EXPANDABLE.filter((i) => stEnd.state[i] && !stEnd.state[i].collapsed).join(',')}`);
await shot('step-06-collapsed');

/* ── 6b) FPS（1536×730 全 mini，沉降后测） ───────────────────────────── */
const measureFps = (ms = 3000) =>
  page.evaluate(
    (dur) =>
      new Promise((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (performance.now() - t0 < dur) requestAnimationFrame(tick);
          else resolve({ frames: n, ms: Math.round(performance.now() - t0), fps: +(n / ((performance.now() - t0) / 1000)).toFixed(1) });
        };
        requestAnimationFrame(tick);
      }),
    ms
  );
await sleep(2500);
const fps = await measureFps(4000);
report.fps = fps;
if (fps.fps < 30) fail(`FPS ${fps.fps} < 30`);
console.log('fps:', JSON.stringify(fps));

/* ── 7) 刷新后仍全 mini ──────────────────────────────────────────────── */
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelectorAll('.gev-lc').length >= 9, { timeout: 120000 });
await sleep(9000);
await installQa();
const stReload = await snapshot('reload-initial');
const expReload = EXPANDABLE.filter((i) => stReload.state[i] && !stReload.state[i].collapsed);
if (expReload.length) fail(`刷新后自动展开: ${expReload.join(',')}`);
const oovReload = IDS.filter((i) => stReload.state[i] && !stReload.state[i].inView);
if (oovReload.length) fail(`刷新后有卡飞出屏幕: ${oovReload.join(',')}`);
await shot('step-07-reload-initial');

/* ── 8) 刷新后再测一次 FPS（只作记录，不参与判定） ─────────────────────── */
await sleep(2500);
const fpsAfterReload = await measureFps(3000);
report.fpsAfterReload = fpsAfterReload;
console.log('fpsAfterReload:', JSON.stringify(fpsAfterReload));
console.log('fps:', JSON.stringify(fps));

/* ── 9) 真实鼠标可信度 ────────────────────────────────────────────────── */
const ptr = await page.evaluate(() => window.__ptr || []);
report.pointerTrust = { total: ptr.length, trusted: ptr.filter((p) => p.trusted).length, sample: ptr.slice(0, 5) };
if (ptr.length && ptr.filter((p) => p.trusted).length !== ptr.length) fail('存在非可信指针事件');

report.consoleErrors = consoleErrs.slice(0, 10);
report.finished = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log('=== FAILURES', report.failures.length, '===');
report.failures.forEach((f) => console.log(' -', f));
console.log('OUT', OUT);
await browser.close();
