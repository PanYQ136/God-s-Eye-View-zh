#!/usr/bin/env node
/**
 * _audit-deep.mjs — t_829dd186 深度材质/布局审计（1536×730，CDP 真实鼠标）
 *   A) 内层容器（panel-inner / data-panel-inner / pp-panel-body / tray / dock-popover-content）材质
 *   B) pp 展开：逐行 rect / 行间距 / 行内水平重叠 / 裁切 / 局部合成底色 / 文字亮度
 *   C) 全页 ✕ 字形清单（含不可见、含伪元素）
 *   D) 9 卡 mini 初始 + 每卡中心合成 alpha（沿祖先链累乘）
 * 用法: node scripts/_audit-deep.mjs [--tag=audit1]
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const TAG = (process.argv.find((x) => x.startsWith('--tag=')) || '--tag=audit1').split('=')[1];
const OUT = path.resolve('.gev-logs/audit', TAG);
fs.mkdirSync(OUT, { recursive: true });
const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const out = { tag: TAG, steps: [], fails: [] };
const bad = (m) => { out.fails.push(m); console.log('FAIL', m); };
const ok = (m) => console.log('ok  ', m);

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
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 60000 });
// 等 App 就绪：loading 幕消失 + 9 卡矩形稳定
await page.waitForFunction(() => {
  const s = document.querySelector('#gev-loading, .gev-loading-screen, #app-loading');
  const vis = s && getComputedStyle(s).display !== 'none' && parseFloat(getComputedStyle(s).opacity) > 0.05;
  return !vis;
}, { timeout: 60000 }).catch(() => {});
await sleep(6000);

/* 通用：元素材质快照（含祖先链合成 alpha） */
const HELP = () => {
  const parseColor = (s) => {
    const m = /rgba?\(([^)]+)\)/.exec(s || '');
    if (!m) return { a: 0, rgb: [0, 0, 0] };
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { a: p.length > 3 ? p[3] : 1, rgb: p.slice(0, 3) };
  };
  const bgInfo = (el) => {
    const cs = getComputedStyle(el);
    const c = parseColor(cs.backgroundColor);
    const img = cs.backgroundImage && cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 60) : 'none';
    return { bg: cs.backgroundColor, a: Math.round(c.a * 1000) / 1000, img, blur: cs.backdropFilter || cs.webkitBackdropFilter || 'none', filter: cs.filter };
  };
  // 合成 alpha：从元素往上累计（近似，忽略层叠顺序）→ 返回值≈覆盖度（0=全透明）
  const chainAlpha = (el, stopSel) => {
    let a = 1, node = el;
    while (node && node.nodeType === 1) {
      const c = parseColor(getComputedStyle(node).backgroundColor);
      a *= c.a;
      if (stopSel && node.matches(stopSel)) break;
      node = node.parentElement;
    }
    return Math.round(a * 1000) / 1000;
  };
  const luma = (el) => {
    const c = parseColor(getComputedStyle(el).color).rgb;
    return Math.round((0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 * 1000) / 1000;
  };
  const r = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const overlaps = (a, b) => {
    const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]);
    const iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    return ix > 0.5 && iy > 0.5 ? Math.round(Math.min(ix, iy) * 10) / 10 : 0;
  };
  window.__A = { parseColor, bgInfo, chainAlpha, luma, r, overlaps };
  return true;
};

/* ---------- A) 内层容器材质 ---------- */
await page.evaluate(HELP);
const innerAudit = await page.evaluate(() => {
  window.__A = window.__A || {};
  const q = (sel) => [...document.querySelectorAll(sel)];
  const bg = (el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, img: cs.backgroundImage === 'none' ? 'none' : 'img', blur: (cs.backdropFilter || 'none') };
  };
  const sels = ['.panel-inner', '.data-panel-inner', '.pp-panel-body', '.dock-popover-content', '.dock-tray',
    '#command-dock .dock-tray', '.gev-lc-panel-inner', '.pp-toggle-group'];
  const res = [];
  for (const s of sels) {
    for (const el of q(s)) {
      const b = bg(el);
      const bb = el.getBoundingClientRect();
      res.push({ sel: s, cls: el.className.toString().slice(0, 60), ...b, rect: [Math.round(bb.width), Math.round(bb.height)] });
    }
  }
  return res;
});
out.inner = innerAudit;
const innerBad = innerAudit.filter((x) => {
  if (x.rect[0] < 2 || x.rect[1] < 2) return false; // 0×0 的隐藏组不算
  const a = /rgba?\(([^)]+)\)/.exec(x.bg);
  const al = a ? parseFloat((a[1].split(',')[3] ?? '1')) : 1;
  return al > 0.02 || x.blur !== 'none';
});
if (innerBad.length) bad(`内层仍有底色/磨砂: ${JSON.stringify(innerBad.slice(0, 6))}`);
else ok(`内层容器 ${innerAudit.length} 个：全部 alpha≤0.02 且 blur=none`);

/* ---------- C) 全页 ✕ 清单 ---------- */
const xList = await page.evaluate(() => {
  const hits = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    const t = (n.nodeValue || '').trim();
    if (/^[×✕✖xX]$/.test(t)) {
      const el = n.parentElement;
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      const before = getComputedStyle(el, '::before').content;
      hits.push({
        tag: el.tagName, cls: (el.className || '').toString().slice(0, 50), id: el.id, text: t,
        rect: [Math.round(b.width), Math.round(b.height)], fs: cs.fontSize, vis: cs.visibility, op: cs.opacity,
        disp: cs.display, before,
      });
    }
  }
  // 伪元素里的 ✕
  for (const el of document.querySelectorAll('*')) {
    for (const pe of ['::before', '::after']) {
      const c = getComputedStyle(el, pe).content;
      if (c && /[×✕✖]/.test(c)) {
        const b = el.getBoundingClientRect();
        hits.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 50), id: el.id, pe, text: c, rect: [Math.round(b.width), Math.round(b.height)] });
      }
    }
  }
  const visible = hits.filter((h) => h.rect[0] > 1 && h.rect[1] > 1 && h.vis !== 'hidden' && parseFloat(h.op || 1) > 0.1);
  return { all: hits, visible };
});
out.xGlyph = xList;
if (xList.visible.length) bad(`存在可见 ✕ 字形 ${xList.visible.length}: ${JSON.stringify(xList.visible.slice(0, 5))}`);
else ok(`可见 ✕ 字形 0（DOM 中残留 ${xList.all.length} 个均 0×0/隐藏）`);

/* ---------- D) 初始 9 卡 ---------- */
const initial = await page.evaluate((IDS) => {
  const { bgInfo, chainAlpha, r } = window.__A;
  return IDS.map((id) => {
    const el = document.getElementById(id);
    if (!el) return { id, missing: true };
    const b = bgInfo(el);
    return {
      id, rect: r(el), collapsed: el.classList.contains('collapsed'),
      bg: b.bg, img: b.img, blur: b.blur, filter: b.filter,
      centerDarkAlpha: chainAlpha(el.querySelector('.panel-header') || el, '.gev-lc'),
    };
  });
}, IDS);
out.initial = initial;
const initOpen = initial.filter((c) => !c.collapsed && c.id !== 'gev-gfx-fab' && c.id !== 'gev-voice-control');
if (initOpen.length) bad(`初始不是全 mini: ${initOpen.map((c) => c.id).join(',')}`);
else ok('初始：9 卡全 mini');
const initMat = initial.filter((c) => c.bg !== 'rgba(0, 0, 0, 0)' || c.blur !== 'none');
if (initMat.length) bad(`初始卡壳非全透明: ${JSON.stringify(initMat.map((c) => [c.id, c.bg, c.blur]))}`);
else ok('初始：卡壳 background 全 rgba(0,0,0,0) / backdrop-filter none');

await page.screenshot({ path: path.join(OUT, 'audit-00-initial.png') });

/* ---------- B) pp 展开：真实鼠标点击 header ---------- */
const ppHeader = await page.evaluate(() => {
  const card = document.getElementById('pp-toggles');
  const h = card.querySelector('.panel-header, .pp-header-row');
  const b = h.getBoundingClientRect();
  return { x: b.left + Math.min(60, b.width / 2), y: b.top + b.height / 2, hit: document.elementFromPoint(b.left + 20, b.top + b.height / 2)?.closest('.gev-lc')?.id || '' };
});
await page.mouse.click(ppHeader.x, ppHeader.y);
await sleep(1400);

const ppAudit = await page.evaluate(() => {
  const { bgInfo, chainAlpha, luma, r, overlaps } = window.__A;
  const card = document.getElementById('pp-toggles');
  const cs = getComputedStyle(card);
  const vis = (e) => {
    const b = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    return b.width > 2 && b.height > 2 && s.visibility !== 'hidden' && parseFloat(s.opacity) > 0.05;
  };
  // 所有可见「行级」块（容器的直接子块 + 组内子块）
  const rowEls = [...card.querySelectorAll('.pp-toggle-group, .pp-slider-row, .pp-mode-seg, .pp-header-row, .pp-text-row')].filter(vis);
  const rowsInfo = rowEls.map((e) => ({ el: e, cls: e.className.toString().slice(0, 44), rect: r(e) }));
  // 行间：只比较互不包含、且在 x 上重叠的块，取「上一个的下边 → 这个的上边」
  const pairs = [];
  for (let i = 0; i < rowsInfo.length; i++) {
    for (let j = 0; j < rowsInfo.length; j++) {
      if (i === j) continue;
      const A = rowsInfo[i], B = rowsInfo[j];
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      if (A.rect[1] >= B.rect[1]) continue; // 只看 A 在 B 上
      const xo = Math.min(A.rect[0] + A.rect[2], B.rect[0] + B.rect[2]) - Math.max(A.rect[0], B.rect[0]);
      if (xo > 20) pairs.push({ a: A.cls, b: B.cls, gap: Math.round((B.rect[1] - (A.rect[1] + A.rect[3])) * 10) / 10 });
    }
  }
  const vOverlap = [];
  for (let i = 0; i < rowsInfo.length; i++) for (let j = i + 1; j < rowsInfo.length; j++) {
    const A = rowsInfo[i], B = rowsInfo[j];
    if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
    const o = overlaps(A.rect, B.rect);
    if (o > 2) vOverlap.push([A.cls, B.cls, o]);
  }
  // 行内控件水平重叠
  const hOverlap = [];
  for (const row of rowEls) {
    const items = [...row.querySelectorAll('button, .pp-label, .pp-slider, .pp-mode-btn, .pp-value, .pp-slider-val')].filter((e) => e.getBoundingClientRect().width > 2 && getComputedStyle(e).visibility !== 'hidden');
    const rects = items.map((e) => ({ e, rr: r(e) }));
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      if (rects[i].e.contains(rects[j].e) || rects[j].e.contains(rects[i].e)) continue;
      const o = overlaps(rects[i].rr, rects[j].rr);
      if (o > 2) hOverlap.push({ row: row.className.toString().slice(0, 30), a: rects[i].e.className.toString().slice(0, 26) + '|' + (rects[i].e.textContent || '').trim().slice(0, 8), b: rects[j].e.className.toString().slice(0, 26) + '|' + (rects[j].e.textContent || '').trim().slice(0, 8), ov: o });
    }
  }
  // 裁切：任何可见元素超出卡片内框
  const cardR = r(card);
  const clipped = [...card.querySelectorAll('*')].filter((e) => {
    const b = e.getBoundingClientRect();
    if (b.width < 3 || b.height < 3) return false;
    const s = getComputedStyle(e);
    if (s.visibility === 'hidden' || s.position === 'fixed') return false;
    return b.right > cardR[0] + cardR[2] + 2 || b.left < cardR[0] - 2;
  }).map((e) => ({ cls: e.className.toString().slice(0, 34), r: r(e) }));
  // 小卡片材质 + 文字亮度
  const ctrls = [...card.querySelectorAll('button, .pp-slider-row, .pp-mode-btn, .pp-toggle-btn, .map-stack-chip')].filter(vis);
  const ctrlInfo = ctrls.map((e) => {
    const b = bgInfo(e);
    return { cls: e.className.toString().slice(0, 40), bg: b.bg, blur: b.blur, comp: chainAlpha(e, '.gev-lc'), luma: luma(e), active: /(^|\s)(active|on|is-active)(\s|$)/.test(e.className) || e.getAttribute('aria-pressed') === 'true' };
  });
  return {
    rect: cardR, padding: cs.padding, rowGap: cs.rowGap, overflowY: cs.overflowY,
    scroll: { top: card.scrollTop, h: card.scrollHeight, ch: card.clientHeight },
    rows: rowsInfo.map((x) => ({ cls: x.cls, rect: x.rect })),
    pairs: pairs.slice(0, 30), minGap: pairs.length ? Math.min(...pairs.map((p) => p.gap)) : null,
    vOverlap, hOverlap: hOverlap.slice(0, 12), clipped: clipped.slice(0, 8),
    ctrls: ctrlInfo,
    darkText: ctrlInfo.filter((c) => c.luma < 0.45),
    solid: ctrlInfo.filter((c) => c.comp > 0.25 && !c.active),
  };
});
out.pp = ppAudit;
await page.screenshot({ path: path.join(OUT, 'audit-01-pp-open.png') });

if (ppAudit.vOverlap.length) bad(`pp 行垂直重叠 ${ppAudit.vOverlap.length} 处: ${JSON.stringify(ppAudit.vOverlap.slice(0, 4))}`);
else ok(`pp 行 ${ppAudit.rows.length} 行，无垂直重叠，minGap=${ppAudit.minGap}px`);
if (ppAudit.minGap !== null && ppAudit.minGap < 3) bad(`pp 行间距过小 minGap=${ppAudit.minGap}`);
if (ppAudit.hOverlap.length) bad(`pp 行内水平重叠 ${ppAudit.hOverlap.length} 处: ${JSON.stringify(ppAudit.hOverlap.slice(0, 4))}`);
else ok('pp 行内控件无水平重叠');
if (ppAudit.clipped.length) bad(`pp 内容水平裁切 ${ppAudit.clipped.length} 个: ${JSON.stringify(ppAudit.clipped.slice(0, 4))}`);
else ok('pp 内容无水平裁切');
if (ppAudit.darkText.length) bad(`pp 内深色字 ${ppAudit.darkText.length}: ${JSON.stringify(ppAudit.darkText.slice(0, 4))}`);
else ok(`pp 内 ${ppAudit.ctrls.length} 个控件无深色字（luma≥0.45）`);
if (ppAudit.solid.length) bad(`pp 内实底控件 ${ppAudit.solid.length}: ${JSON.stringify(ppAudit.solid.slice(0, 4))}`);
else ok('pp 内控件合成底色全部 ≤0.25');
ok(`pp 可滚: scrollHeight=${ppAudit.scroll.h} clientHeight=${ppAudit.scroll.ch} overflowY=${ppAudit.overflowY}`);

/* 滚轮实测 */
const wheelBefore = ppAudit.scroll.top;
const cardC = await page.evaluate(() => {
  const b = document.getElementById('pp-toggles').getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
});
await page.mouse.move(cardC.x, cardC.y);
for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: 120 }); await sleep(90); }
await sleep(500);
const wheelAfter = await page.evaluate(() => document.getElementById('pp-toggles').scrollTop);
out.wheel = { before: wheelBefore, after: wheelAfter };
if (wheelAfter - wheelBefore < 40) bad(`pp 滚轮无效: ${wheelBefore} → ${wheelAfter}`);
else ok(`pp 滚轮生效: scrollTop ${wheelBefore} → ${wheelAfter}`);
await page.screenshot({ path: path.join(OUT, 'audit-02-pp-scrolled.png') });

/* header sticky 仍可见可点 */
const sticky = await page.evaluate(() => {
  const card = document.getElementById('pp-toggles');
  const h = card.querySelector('.panel-header, .pp-header-row');
  const b = h.getBoundingClientRect(), c = card.getBoundingClientRect();
  return { headerTop: Math.round(b.top), cardTop: Math.round(c.top), visible: b.top >= c.top - 1 && b.height > 4, hit: (() => { const e = document.elementFromPoint(b.left + 30, b.top + b.height / 2); return e && (e.closest('#pp-toggles') ? 'pp-toggles' : e.className.toString().slice(0, 30)); })() };
});
out.sticky = sticky;
if (!sticky.visible) bad(`pp 滚动后 header 不可见: ${JSON.stringify(sticky)}`);
else ok(`pp 滚动后 header 仍可见 (top ${sticky.headerTop} ≥ cardTop ${sticky.cardTop})`);

fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(out, null, 1));
console.log('=== FAILURES', out.fails.length, '===');
out.fails.forEach((f) => console.log(' -', f));
console.log('OUT', OUT);
await browser.close();
