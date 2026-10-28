#!/usr/bin/env node
/**
 * _r4-accept.mjs — 实现方 round-4 验收（1536×730，CDP 真实鼠标，无 JS 注入状态变更）
 *  A 初始全 mini + 材质（卡壳 alpha / 中心 5 点 / ✕ / 全页 backdrop-filter）
 *  B 7 个 header 真实点击 → 打开自己那张 + 卡内材质
 *  C 左/右互斥（rAF 逐帧：maxLeft/maxRight ≤1、emptyFrames=0、旧 header 可点回切）
 *  D pp 展开：真滚轮、行距、按钮无黑底黑字
 *  E 12 组合两两重叠（含 reviewer 阻塞项 control+pp 两种顺序）+ 右栏竖直 gap + header 命中归属
 *  F 快速连点 16 击
 *  G 收起全部 → 与初始基线逐卡 rect diff
 *  H 重载 t+3/5/7s 全 mini
 *  I FPS
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/r4-t829');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = { started: new Date().toISOString(), viewport: `${W}x${H}` };
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v).slice(0, 1800)); };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
  window.__rv = { down: 0, downT: 0, click: 0, clickT: 0, wheel: 0, wheelT: 0 };
  for (const t of ['pointerdown', 'click', 'wheel'])
    document.addEventListener(t, (e) => {
      if (t === 'pointerdown') { window.__rv.down++; if (e.isTrusted) window.__rv.downT++; }
      else if (t === 'click') { window.__rv.click++; if (e.isTrusted) window.__rv.clickT++; }
      else { window.__rv.wheel++; if (e.isTrusted) window.__rv.wheelT++; }
    }, true);
});
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9500);

const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const FOLD = CARDS.slice(0, 7);
const HDR = FOLD;

const ALPHA = `const alpha=(c)=>{const s=String(c);if(!/^rgba?\\(/.test(s))return 0;const p=s.match(/rgba?\\(([^)]+)\\)/)[1].split(/[,\\s\\/]+/).filter(Boolean).map(Number);return p.length>3?p[3]:1;};`;

// 通用快照：卡片 rect/材质/中心透明度 + 两两重叠 + header 命中归属
const snap = () => page.evaluate((IDS) => {
  const alpha = (c) => {
    const s = String(c);
    if (!/^rgba?\(/.test(s)) return 0;
    const p = s.match(/rgba?\(([^)]+)\)/)[1].split(/[,\s\/]+/).filter(Boolean).map(Number);
    return p.length > 3 ? p[3] : 1;
  };
  const a = (c) => alpha(c);
  const o = {};
  for (const id of IDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    // 中心 5 点采样：卡内元素最大背景 alpha（排除已知内容块）
    const pts = [
      [r.x + r.width * 0.5, r.y + r.height * 0.5],
      [r.x + r.width * 0.3, r.y + r.height * 0.35],
      [r.x + r.width * 0.7, r.y + r.height * 0.35],
      [r.x + r.width * 0.3, r.y + r.height * 0.7],
      [r.x + r.width * 0.7, r.y + r.height * 0.7],
    ];
    let maxCenter = 0, maxCenterEl = null;
    for (const [px, py] of pts) {
      let e = document.elementFromPoint(Math.round(px), Math.round(py));
      let n = 0;
      while (e && n++ < 8) {
        if (!el.contains(e)) break;
        const cs = getComputedStyle(e);
        const bg = a(cs.backgroundColor) * (parseFloat(cs.opacity) || 1);
        if (bg > maxCenter) { maxCenter = bg; maxCenterEl = e.id || e.className || e.tagName; }
        e = e.parentElement;
      }
    }
    // 卡内可见的 backdrop-filter 数量
    let bfIn = 0;
    el.querySelectorAll('*').forEach((n) => {
      const cs = getComputedStyle(n);
      if (cs.backdropFilter && cs.backdropFilter !== 'none' && cs.display !== 'none' && +cs.opacity > 0.05) bfIn++;
    });
    o[id] = {
      rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      open: !el.classList.contains('collapsed'),
      hidden: el.hidden || c.display === 'none' || c.visibility === 'hidden',
      vis: c.display !== 'none' && c.visibility !== 'hidden' && +c.opacity > 0.05,
      inView: r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
      bg: c.backgroundColor, bgA: +a(c.backgroundColor).toFixed(3), bf: c.backdropFilter || 'none',
      maxCenter: +maxCenter.toFixed(3), maxCenterEl, bfIn,
    };
  }
  const ov = (p, q) => {
    const ix = Math.max(0, Math.min(p[0] + p[2], q[0] + q[2]) - Math.max(p[0], q[0]));
    const iy = Math.max(0, Math.min(p[1] + p[3], q[1] + q[3]) - Math.max(p[1], q[1]));
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
    hits[id] = { own: !!(e && el.contains(e)), owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : (e ? e.tagName + '.' + String(e.className || '').split(' ')[0] : null) };
  }
  const rail = ['pp-toggles', 'cctv-panel', 'global-context-panel'].filter((k) => o[k] && o[k].vis).sort((x, y) => o[x].rect[1] - o[y].rect[1]);
  const gaps = [];
  const miniRail = rail.filter((k) => !o[k].open);
  for (let i = 1; i < miniRail.length; i++) {
    const p = o[miniRail[i - 1]].rect, q = o[miniRail[i]].rect;
    gaps.push({ pair: miniRail[i - 1] + '|' + miniRail[i], gapY: +(q[1] - (p[1] + p[3])).toFixed(1), prevH: p[3] });
  }
  return { o, overlaps, hits, gaps, rail };
}, CARDS);

const settle = async () => {
  let prev = '';
  for (let i = 0; i < 26; i++) {
    await sleep(200);
    const s = await snap();
    const sig = JSON.stringify(s.o);
    if (sig === prev && i > 2) return s;
    prev = sig;
  }
  return snap();
};

const clickCard = async (cardId, wait = 900) => {
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
  if (!probe.ok) return { clicked: false };
  await page.mouse.move(probe.at[0], probe.at[1]);
  await page.mouse.down();
  await page.mouse.up();
  if (wait) await sleep(wait);
  return { clicked: true };
};

const ownerAt = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  if (!el) return 'missing';
  const r = el.getBoundingClientRect();
  const e = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(14, r.height / 2)));
  return e ? (e.closest('.gev-lc') || {}).id || (e.tagName + '.' + String(e.className || '').split(' ')[0]) : null;
}, id);

const closeAll = async () => {
  for (let pass = 0; pass < 2; pass++) {
    for (const id of FOLD) {
      const open = await page.evaluate((i) => {
        const el = document.getElementById(i);
        return el && !el.classList.contains('collapsed');
      }, id);
      if (open) await clickCard(id, 800);
    }
    // 语音卡不是折叠卡（无 .collapsed，也没有 HEAD_SEL 标题条），展开后点自己收不起来
    // —— 这是 App 既有 dock 逻辑（非本轮验收项）。harness 复位用 lib 自己的 close()。
    await page.evaluate(() => { try { window.__gevLc && window.__gevLc.close('gev-voice-control'); } catch (e) {} });
    await page.keyboard.press('Escape');
    await sleep(600);
  }
  await settle();
};

// 全页扫描：可见深色实底 / 磨砂
const pageScan = () => page.evaluate(() => {
  const alpha = (c) => {
    const s = String(c);
    if (!/^rgba?\(/.test(s)) return 0;
    const p = s.match(/rgba?\(([^)]+)\)/)[1].split(/[,\s\/]+/).filter(Boolean).map(Number);
    return p.length > 3 ? p[3] : 1;
  };
  const frosted = [], dark = [];
  document.querySelectorAll('body *').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return;
    const r = el.getBoundingClientRect();
    if (r.width < 6 || r.height < 6) return;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return;
    const inCard = !!el.closest('.gev-lc');
    if (cs.backdropFilter && cs.backdropFilter !== 'none' && cs.backdropFilter !== 'blur(0px)')
      frosted.push({ tag: el.tagName, id: el.id, cls: String(el.className || '').slice(0, 40), bf: cs.backdropFilter, inCard });
    const a = alpha(cs.backgroundColor) * (parseFloat(cs.opacity) || 1);
    if (a > 0.2 && r.width * r.height > 300 && !inCard)
      dark.push({ tag: el.tagName, id: el.id, cls: String(el.className || '').slice(0, 40), bg: cs.backgroundColor, area: Math.round(r.width * r.height) });
  });
  const xEls = document.querySelectorAll('.gev-lc-close').length;
  let xGlyph = 0;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const re = /[✕✖✗✘╳]/;
  while (walk.nextNode()) { if (re.test(walk.currentNode.nodeValue || '')) xGlyph++; }
  return { frosted, dark, xEls, xGlyph };
});

// ─── A 初始态 ─────────────────────────────────────────────
const s0 = await settle();
put('A_initial', {
  cards: Object.fromEntries(Object.entries(s0.o).map(([k, v]) => [k, { rect: v.rect, open: v.open, hidden: v.hidden, inView: v.inView, bgA: v.bgA, bf: v.bf, maxCenter: v.maxCenter, maxCenterEl: v.maxCenterEl, bfIn: v.bfIn }])),
  overlaps: s0.overlaps,
  foldsOpen: FOLD.filter((k) => s0.o[k].open),
  shellAlphaMax: Math.max(...FOLD.map((k) => s0.o[k].bgA)),
  bfAny: CARDS.filter((k) => s0.o[k].bf !== 'none'),
  outOfView: Object.entries(s0.o).filter(([, v]) => !v.inView).map(([k]) => k),
  gaps: s0.gaps,
});
put('A_scan', await pageScan());
await page.screenshot({ path: path.join(OUT, 'A-initial.png') });

// 与 r3 reviewer 已验收的迷你基线对比
try {
  const r3 = JSON.parse(fs.readFileSync(path.resolve('.gev-logs/review-t829-r3/A-contract.json'), 'utf8'));
  const base = r3.initial_cards;
  const diff = [];
  for (const id of Object.keys(base)) {
    const a = base[id].rect, b = s0.o[id] && s0.o[id].rect;
    if (!b) { diff.push({ id, missing: true }); continue; }
    const d = a.map((n, i) => +(b[i] - n).toFixed(1));
    if (d.some((n) => Math.abs(n) > 0.5)) diff.push({ id, a, b, d });
  }
  put('A_vs_r3_baseline', { diff });
} catch (e) { put('A_vs_r3_baseline', { error: String(e).slice(0, 200) }); }

// ─── B 7 个 header 真实点击 ───────────────────────────────
const openResults = [];
for (const id of HDR) {
  await closeAll();
  const pre = await snap();
  const preOwn = pre.hits[id] ? pre.hits[id].own : null;
  const c = await clickCard(id);
  const s = await settle();
  const card = s.o[id];
  openResults.push({
    id,
    clicked: c.clicked,
    preHitOwn: preOwn,
    open: card.open,
    hidden: card.hidden,
    inView: card.inView,
    bgA: card.bgA,
    bf: card.bf,
    bfIn: card.bfIn,
    maxCenter: card.maxCenter,
    maxCenterEl: card.maxCenterEl,
    rect: card.rect,
    overlaps: s.overlaps,
    otherOpen: HDR.filter((k) => k !== id && s.o[k].open),
  });
  await page.screenshot({ path: path.join(OUT, `B-open-${id}.png`) });
}
put('B_headers', openResults);

// ─── C 互斥（rAF 逐帧 + class 变更时间戳）──────────────────
await closeAll();
const mutex = await (async () => {
  await page.evaluate(() => {
    window.__frames = [];
    window.__cls = [];
    window.__rec = true;
    ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      new MutationObserver(() => {
        window.__cls.push({ id, t: performance.now(), collapsed: el.classList.contains('collapsed') });
      }).observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    const tick = () => {
      if (!window.__rec) return;
      const st = (id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return { id, open: !el.classList.contains('collapsed'), hidden: el.classList.contains('hidden') || el.hidden || cs.display === 'none' || cs.visibility === 'hidden', w: Math.round(r.width), h: Math.round(r.height) };
      };
      window.__frames.push({
        t: performance.now(),
        left: ['data-panel', 'scene-panel'].map(st),
        right: ['pp-toggles', 'cctv-panel', 'global-context-panel'].map(st),
      });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const seq = [['data-panel', 'scene-panel'], ['scene-panel', 'data-panel'], ['pp-toggles', 'cctv-panel'], ['cctv-panel', 'global-context-panel'], ['global-context-panel', 'pp-toggles']];
  const marks = [];
  for (const [a, b] of seq) {
    await clickCard(a, 800);
    marks.push({ pair: `${a}->${b}`, t: await page.evaluate(() => performance.now()) });
    await clickCard(b, 800);
    await clickCard(a, 800); // 旧 header 回切
  }
  const { raw, cls } = await page.evaluate(() => { window.__rec = false; return { raw: window.__frames, cls: window.__cls }; });
  let maxL = 0, maxR = 0, emptyAfterStart = 0, hiddenF = 0, start = null;
  const openWindows = [];
  raw.forEach((f, i) => { if (start === null && f.left.concat(f.right).some((x) => x && x.open)) start = i; });
  raw.forEach((f, i) => {
    const l = f.left.filter((x) => x && x.open).length;
    const r = f.right.filter((x) => x && x.open).length;
    if (start !== null && i >= start) {
      maxL = Math.max(maxL, l); maxR = Math.max(maxR, r);
      if (l === 0 && r === 0) emptyAfterStart++;
    }
    if ([...f.left, ...f.right].some((x) => x && x.hidden)) hiddenF++;
    openWindows.push(l + r);
  });
  // 关旧→开新 时间差（class 变更时间戳）
  const switchGaps = marks.map(({ pair, t }) => {
    const [a, b] = pair.split('->');
    const closeA = cls.filter((c) => c.id === a && c.collapsed && c.t >= t - 5).sort((x, y) => x.t - y.t)[0];
    const openB = cls.filter((c) => c.id === b && !c.collapsed && c.t >= t - 5).sort((x, y) => x.t - y.t)[0];
    return { pair, closeA: closeA ? +closeA.t.toFixed(1) : null, openB: openB ? +openB.t.toFixed(1) : null, gapMs: closeA && openB ? +(openB.t - closeA.t).toFixed(2) : null };
  });
  const zeroDetails = [];
  raw.forEach((f, i) => {
    if (start === null || i < start) return;
    const l = f.left.filter((x) => x && x.open).length, r = f.right.filter((x) => x && x.open).length;
    if (l === 0 && r === 0) zeroDetails.push({ i, t: +f.t.toFixed(0), prev: i > 0 ? raw[i - 1].left.concat(raw[i - 1].right).filter((x) => x && x.open).map((x) => x.id) : [], next: raw[i + 1] ? raw[i + 1].left.concat(raw[i + 1].right).filter((x) => x && x.open).map((x) => x.id) : [], nearMark: marks.map((m) => ({ tag: m.pair, dt: Math.round(f.t - m.t) })).filter((m) => Math.abs(m.dt) < 500) });
  });
  return { frames: raw.length, maxL, maxR, emptyFramesAfterFirstOpen: emptyAfterStart, zeroDetails, hiddenFrames: hiddenF, switchGaps, windowsHead: openWindows.slice(0, 24) };
})();
const backSwitch = [];
for (const [a, b] of [['data-panel', 'scene-panel'], ['pp-toggles', 'cctv-panel']]) {
  await closeAll();
  await clickCard(a, 800);
  await clickCard(b, 800);
  const s1 = await snap();
  const c = await clickCard(a, 800);
  const s2 = await snap();
  backSwitch.push({ pair: `${a}->${b}->${a}`, clickedBack: c.clicked, afterFirst: { a: s1.o[a].open, b: s1.o[b].open }, afterBack: { a: s2.o[a].open, b: s2.o[b].open }, headerStillOwn: s2.hits[a] ? s2.hits[a].own : null });
}
put('C_mutex', { ...mutex, backSwitch });
await page.screenshot({ path: path.join(OUT, 'C-mutex-final.png') });

// ─── D pp 展开：滚轮 / 行距 / 按钮材质 ─────────────────────
await closeAll();
await clickCard('pp-toggles', 900);
const ppBox = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height * 0.6), rect: [r.x, r.y, r.width, r.height] };
});
const ppBefore = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  const body = el.querySelector('.pp-panel-body') || el;
  const rows = [...(body.querySelectorAll(':scope > *') || [])];
  const br = rows.map((r) => { const b = r.getBoundingClientRect(); return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), h: +b.height.toFixed(1), txt: (r.textContent || '').trim().slice(0, 18) }; }).filter((r) => r.h > 2).sort((a, b) => a.top - b.top);
  let minGap = Infinity;
  for (let i = 1; i < br.length; i++) minGap = Math.min(minGap, br[i].top - br[i - 1].bottom);
  const btns = [...el.querySelectorAll('button,.pp-chip,.pp-toggle,.pp-option')].map((b) => {
    const cs = getComputedStyle(b);
    const a = (() => { const s = cs.backgroundColor; if (!/^rgba?\(/.test(s)) return 0; const p = s.match(/rgba?\(([^)]+)\)/)[1].split(/[,\s\/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; })();
    const c = cs.color.match(/\d+/g).map(Number);
    return { txt: (b.textContent || '').trim().slice(0, 14), bgA: +a.toFixed(2), bg: cs.backgroundColor, color: cs.color, darkText: (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) < 90 };
  });
  const scroller = (() => { let n = body; while (n && n !== el) { const cs = getComputedStyle(n); if (/auto|scroll/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 4) return { ch: n.clientHeight, sh: n.scrollHeight, cls: String(n.className || '') }; n = n.parentElement; } return null; })();
  return { rows: br.length, minGap: +minGap.toFixed(1), btns, scroller, solidBtns: btns.filter((b) => b.bgA > 0.5), darkBtns: btns.filter((b) => b.darkText) };
});
await page.mouse.move(ppBox.x, ppBox.y);
const scrollSeq = [];
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel({ deltaY: 120 });
  await sleep(160);
  scrollSeq.push(await page.evaluate(() => {
    const el = document.getElementById('pp-toggles');
    let n = el.querySelector('.pp-panel-body') || el;
    for (const cand of [el, ...el.querySelectorAll('*')]) {
      const cs = getComputedStyle(cand);
      if (/auto|scroll/.test(cs.overflowY) && cand.scrollHeight > cand.clientHeight + 4) { n = cand; break; }
    }
    return n.scrollTop;
  }));
}
await page.screenshot({ path: path.join(OUT, 'D-pp-scrolled.png') });
put('D_pp', { rect: ppBox.rect, before: ppBefore, scrollSeq });
await page.mouse.move(760, 400);

// ─── E 12 组合两两重叠 + header 命中 ──────────────────────
const combos = [
  ['control-panel', 'pp-toggles'], ['pp-toggles', 'control-panel'],
  ['control-panel', 'cctv-panel'], ['cctv-panel', 'control-panel'],
  ['control-panel', 'global-context-panel'], ['global-context-panel', 'control-panel'],
  ['control-panel', 'data-panel'], ['control-panel', 'scene-panel'],
  ['data-panel', 'pp-toggles'], ['scene-panel', 'pp-toggles'],
  ['control-panel', 'location-bar'], ['control-panel', 'location-bar', 'pp-toggles'],
];
const comboRes = [];
for (const steps of combos) {
  await closeAll();
  const cl = [];
  for (const s of steps) cl.push({ id: s, ok: (await clickCard(s, 900)).clicked });
  const s = await settle();
  comboRes.push({
    steps: steps.join(' -> '),
    clicked: cl,
    open: Object.entries(s.o).filter(([, v]) => v.open).map(([k]) => k),
    gaps: s.gaps,
    overlaps: s.overlaps,
    badHits: Object.entries(s.hits).filter(([, v]) => !v.own).map(([k, v]) => ({ id: k, owner: v.owner })),
    outOfView: Object.entries(s.o).filter(([, v]) => v.vis && !v.inView).map(([k]) => k),
    maxCenter: Math.max(...Object.values(s.o).filter((v) => v.open).map((v) => v.maxCenter)),
    shellAlphaMax: Math.max(...Object.values(s.o).map((v) => v.bgA)),
  });
  const f = 'E-' + steps.join('_') + '.png';
  await page.screenshot({ path: path.join(OUT, f) });
}
put('E_combos', comboRes);

// ─── F 快速连点 16 击（40ms 极限 / 150ms 人手快速）────────────
const ORDER = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control',
  'data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control'];
const sigOf = (s) => JSON.stringify(Object.fromEntries(Object.entries(s.o).map(([k, v]) => [k, v.rect])));
const burst = async (cadence, tag, png) => {
  await closeAll();
  const taps = [];
  let missed = 0;
  for (const id of ORDER) {
    let r = { clicked: false }, attempts = 0;
    while (attempts < 10 && !r.clicked) { r = await clickCard(id, cadence); attempts++; }
    taps.push({ id, ok: r.clicked, attempts });
    if (!r.clicked) { missed++; taps[taps.length - 1].ownerAtCenter = await ownerAt(id); }
  }
  await sleep(1200);
  const s1 = await settle();
  await sleep(3500);
  const s2 = await snap();
  await page.screenshot({ path: path.join(OUT, png) });
  return {
    cadenceMs: cadence, taps: ORDER.length, missed, missedDetail: taps.filter((x) => !x.ok),
    settledDeterministic: sigOf(s1) === sigOf(s2),
    overlaps: s2.overlaps,
    outOfView: Object.entries(s2.o).filter(([, v]) => v.vis && !v.inView).map(([k]) => k),
    open: Object.entries(s2.o).filter(([, v]) => v.open).map(([k]) => k),
    leftOpen: ['data-panel', 'scene-panel'].filter((k) => s2.o[k].open).length,
    rightOpen: ['pp-toggles', 'cctv-panel', 'global-context-panel'].filter((k) => s2.o[k].open).length,
    allHeadersOwn: Object.entries(s2.hits).every(([, v]) => v.own),
    badHits: Object.entries(s2.hits).filter(([, v]) => !v.own).map(([k, v]) => ({ id: k, owner: v.owner })),
    gaps: s2.gaps,
  };
};
put('F_rapid_40ms', await burst(40, '40ms', 'F-rapid-40ms.png'));
put('F_rapid_150ms', await burst(150, '150ms', 'F-rapid-150ms.png'));

// ─── G 收起回基线 ─────────────────────────────────────────
await closeAll();
const sEnd = await settle();
const rectDiff = [];
for (const id of Object.keys(s0.o)) {
  const a = s0.o[id].rect, b = sEnd.o[id].rect;
  const d = a.map((n, i) => +(b[i] - n).toFixed(1));
  if (d.some((n) => Math.abs(n) > 0.5)) rectDiff.push({ id, a, b, d });
}
put('G_collapse', { rectDiff, overlaps: sEnd.overlaps, foldsOpen: FOLD.filter((k) => sEnd.o[k].open), allMini: sEnd.overlaps.length === 0 });
await page.screenshot({ path: path.join(OUT, 'G-collapsed.png') });
put('trust', await page.evaluate(() => window.__rv));

// ─── I FPS（先测，再重载）──────────────────────────────────
const fps = await page.evaluate(() => new Promise((res) => {
  const t = [];
  let last = performance.now(), n = 0;
  const tick = () => {
    const now = performance.now();
    t.push(now - last); last = now; n++;
    if (n < 240) requestAnimationFrame(tick); else {
      const s = t.slice(20).sort((a, b) => a - b);
      res({ frames: s.length, medianMs: +s[Math.floor(s.length / 2)].toFixed(2), medianFps: +(1000 / s[Math.floor(s.length / 2)]).toFixed(1), p95Ms: +s[Math.floor(s.length * 0.95)].toFixed(2) });
    }
  };
  requestAnimationFrame(tick);
}));
put('I_fps', fps);

// ─── H 重载仍全 mini（密采样 400ms × 12s）────────────────
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
const reload = [];
let anyExpandedFrame = 0;
for (let i = 0; i < 30; i++) {
  await sleep(400);
  const s = await snap();
  const openNow = FOLD.filter((k) => s.o[k].open);
  if (openNow.length) anyExpandedFrame++;
  reload.push({ at: +((i + 1) * 0.4).toFixed(1), expanded: openNow, overlaps: s.overlaps });
}
put('H_reload', { anyExpandedFrame, samples: reload.length, timeline: reload.map((x) => x.at + ':' + (x.expanded.length ? x.expanded.join('+') : '-')), final: reload[reload.length - 1] });
await page.screenshot({ path: path.join(OUT, 'H-reloaded.png') });

put('console_errors', errors.slice(0, 20));
fs.writeFileSync(path.join(OUT, 'accept.json'), JSON.stringify(R, null, 1));
console.log('WROTE', path.join(OUT, 'accept.json'));
await browser.close();
