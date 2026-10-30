#!/usr/bin/env node
/* ============================================================================
   scripts/lc/phase3-guards.mjs —— Phase 3 护栏（旧按钮 / 位置联动 / 显示拥挤 / chip 重叠）
   ----------------------------------------------------------------------------
   跑法： node scripts/lc/phase3-guards.mjs          （需要 127.0.0.1:4173 在跑）
   输出： PASS/FAIL 表 + .gev-logs/lc/phase3-guards.json
   说明： 全部结论来自 DOM / getBoundingClientRect / 文本扫描，截图只作人工证据。
   ========================================================================== */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = process.env.LC_URL || 'http://127.0.0.1:4173/';
const W = 1536;
const H = 730;
const OUT = '.gev-logs/lc';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox',
    `--window-size=${W + 24},${H + 160}`,
    '--window-position=40,20',
    '--hide-scrollbars',
    '--ignore-gpu-blocklist',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ],
  protocolTimeout: 600000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.clear();
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
  } catch (e) {}
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break;
  await sleep(400);
}
await sleep(9000);

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ← ' + JSON.stringify(detail)}`);
};
const phases = () => page.evaluate(() => (window.__lc ? window.__lc.api.phases() : null));
const quiet = async (ms = 4000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const busy = await page.evaluate(() => Object.values(window.__lc.api.phases()).some((p) => p === 'opening' || p === 'closing') || document.getAnimations().length > 0);
    if (!busy) return true;
    await sleep(60);
  }
  return false;
};
const clickCard = async (sel) => {
  const p = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    for (const fx of [0.5, 0.3, 0.7]) {
      const x = Math.round(b.x + b.width * fx), y = Math.round(b.y + b.height / 2);
      const hit = document.elementFromPoint(x, y);
      if (hit && !hit.closest('button,input,select,textarea,a,label,[role=slider]')) return { x, y };
    }
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
  }, sel);
  if (!p) return false;
  await page.mouse.click(p.x, p.y);
  await quiet();
  await sleep(400);
  return true;
};
const rectsOf = () => page.evaluate(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
  const out = {};
  for (const id of ids) {
    const b = document.getElementById(id).getBoundingClientRect();
    out[id] = [Math.round(b.x * 10) / 10, Math.round(b.y * 10) / 10, Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10];
  }
  return out;
});
const closeAll = async () => {
  for (let pass = 0; pass < 4; pass++) {
    const ph = await phases();
    const open = Object.keys(ph).filter((k) => ph[k] !== 'mini');
    if (!open.length) return;
    for (const id of open) await clickCard(`#${id}`);
  }
};

/* ── G1 旧折叠按钮彻底不存在 ───────────────────────────────────────────── */
record('G1 旧折叠按钮 DOM = 0', (await page.evaluate(() => document.querySelectorAll('.panel-collapse-btn,.pp-collapse-btn,[data-collapse-target]').length)) === 0, await page.evaluate(() => document.querySelectorAll('.panel-collapse-btn,.pp-collapse-btn,[data-collapse-target]').length));

/* ── G2 页面文本无 + / ◀ / ▶ ───────────────────────────────────────────── */
const glyphs = await page.evaluate(() => {
  /* 只看卡片/侧轨这些「旧按钮曾经出现的地方」：
     地图版权（"(ODbL 1.0) + ..."）和性能条的 "+10" 是正文，不是折叠按钮。 */
  const roots = ['#left-panel-stack', '#right-context-rail', '#command-dock', '#lc-stage'];
  const bad = new Set(['+', '◀', '▶', '◁', '▷', '＋', '❮', '❯']);
  const hits = [];
  for (const sel of roots) {
    const root = document.querySelector(sel);
    if (!root) continue;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const host = n.parentElement;
      if (!host) continue;
      if (host.closest('input,textarea,select,code,pre,[contenteditable]')) continue;
      /* 隐藏面板里的旧按钮不算「页面上还能看到」：用 rect + visibility 判可见 */
      const b = host.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      const cs = getComputedStyle(host);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.05) continue;
      const t = (n.nodeValue || '').trim();
      if (!t) continue;
      if ([...t].every((ch) => bad.has(ch) || '\s'.includes(ch))) hits.push([sel, t.slice(0, 12), host.tagName + '.' + String(host.className).slice(0, 20)]);
    }
  }
  return hits;
});
record('G2 页面无 + / ◀ / ▶ 文本', glyphs.length === 0, glyphs.slice(0, 6));

/* ── G3 点位置面板：左右 rail 卡 rect 差 ≤1px（P0-3）──────────────────── */
await closeAll();
const before = await rectsOf();
await clickCard('#location-bar');
const after = await rectsOf();
const deltas = {};
for (const id of Object.keys(before)) {
  deltas[id] = Math.max(...before[id].map((v, i) => Math.abs(v - after[id][i])));
}
const movedIds = Object.keys(deltas).filter((id) => deltas[id] > 1 && id !== 'location-bar' && id !== 'control-panel');
record('G3 位置面板展开不带动其它卡（≤1px）', movedIds.length === 0 && deltas['location-bar'] > 1, { deltas, movedIds });

/* ── G4 pp 显示卡：全量 17 行跨组校验 —— 行距 ≥8、零重叠、组盒不被压扁、滚到底见末项（P0-5）──
   Phase 3 的旧断言只比同一 .pp-toggle-group 内的行，跨组被 flex 压扁产生的重叠完全漏检
   （9 个组盒被压到 74/51/19/18/34/9/18/18/9 而组 scrollHeight 是 314/217/…）。
   现在改为：① 全部行按 top 排序后相邻 gap；② 全量两两重叠；③ 组盒 height 必须 == scrollHeight。 */
await closeAll();
await clickCard('#pp-toggles .pp-header-row');
await sleep(1800);
const pp = await page.evaluate(() => {
  const card = document.getElementById('pp-toggles');
  const groups = new Map();
  const all = [...card.querySelectorAll('.pp-slider-row')].map((e) => {
    const b = e.getBoundingClientRect();
    const p = e.parentElement;
    if (!groups.has(p)) groups.set(p, groups.size);
    return { top: Math.round(b.top * 10) / 10, bottom: Math.round(b.bottom * 10) / 10, left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height), group: groups.get(p), vis: b.height > 1 && getComputedStyle(e).display !== 'none', t: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 12) || e.id };
  });
  const rows = all.filter((r) => r.vis).sort((a, b) => a.top - b.top);
  /* 全量两两重叠（同一列里垂直 + 水平同时相交才算；不按组过滤） */
  const overlaps = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (a.bottom > b.top + 0.5 && b.bottom > a.top + 0.5 && a.right > b.left + 0.5 && b.right > a.left + 0.5) overlaps.push([a.t, b.t]);
    }
  }
  /* 全量相邻 gap（跨组也算）+ 组内 gap 双保险 */
  const gaps = [];
  for (let k = 1; k < rows.length; k++) gaps.push(Math.round((rows[k].top - rows[k - 1].bottom) * 10) / 10);
  const innerGaps = [];
  const byGroup = {};
  rows.forEach((r) => { (byGroup[r.group] = byGroup[r.group] || []).push(r); });
  for (const g in byGroup) {
    const list = byGroup[g];
    for (let k = 1; k < list.length; k++) innerGaps.push(Math.round((list[k].top - list[k - 1].bottom) * 10) / 10);
  }
  /* 组盒压扁检测：height 必须等于内容高度 */
  const squashed = [...card.querySelectorAll('.pp-toggle-group')].map((g) => ({ h: Math.round(g.getBoundingClientRect().height), sh: g.scrollHeight, flex: getComputedStyle(g).flexShrink })).filter((g) => g.h < g.sh - 1);
  return {
    rows: rows.length, domRows: all.length, groups: Object.keys(byGroup).length,
    minGap: gaps.length ? Math.min(...gaps) : null, gaps,
    minInnerGap: innerGaps.length ? Math.min(...innerGaps) : null,
    overlaps: overlaps.slice(0, 6), overlapCount: overlaps.length,
    squashed,
    minRowH: rows.length ? Math.min(...rows.map((r) => r.h)) : null,
    scrollH: card.scrollHeight, clientH: card.clientHeight,
  };
});
const scrolled = await page.evaluate(() => {
  const card = document.getElementById('pp-toggles');
  card.scrollTop = card.scrollHeight;
  const last = [...card.querySelectorAll('.pp-slider-row')].filter((e) => e.getBoundingClientRect().height > 1).pop();
  const b = last.getBoundingClientRect(), c = card.getBoundingClientRect();
  return { hidden: Math.round(last.getBoundingClientRect().bottom - c.bottom), visible: b.top >= c.top - 1 && b.bottom <= c.bottom + 1, scrollTop: Math.round(card.scrollTop) };
});
record('G4 显示卡全量行距/零重叠/组盒不压扁/滚动到底', pp.rows >= 15 && pp.overlapCount === 0 && pp.minGap >= 7.5 && pp.minInnerGap >= 7.5 && pp.squashed.length === 0 && pp.minRowH >= 29 && pp.scrollH > pp.clientH && scrolled.visible, { ...pp, scrolled });

/* ── G5 中/EN 与 GPU chip 不重叠（1536/1280/375，P0-6）────────────────── */
await closeAll();
const overlapAt = async (w, h) => {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await sleep(1500);
  return page.evaluate(() => {
    const ids = ['gev-lang-toggle', 'gev-perf-wrap'];
    const r = {};
    for (const id of ids) {
      const e = document.getElementById(id);
      if (!e) { r[id] = null; continue; }
      const cs = getComputedStyle(e);
      const b = e.getBoundingClientRect();
      r[id] = { box: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], shown: cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 1 };
    }
    const hit = (id) => {
      const e = document.getElementById(id);
      if (!e) return false;
      const b = e.getBoundingClientRect();
      const el = document.elementFromPoint(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2));
      return !!(el && el.closest('#' + id));
    };
    let overlap = false;
    if (r['gev-lang-toggle'] && r['gev-perf-wrap'] && r['gev-lang-toggle'].shown && r['gev-perf-wrap'].shown) {
      const [ax, ay, aw, ah] = r['gev-lang-toggle'].box;
      const [bx, by, bw, bh] = r['gev-perf-wrap'].box;
      overlap = ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
    }
    return { ...r, overlap, hitLang: hit('gev-lang-toggle'), hitPerf: hit('gev-perf-wrap') };
  });
};
const vp1536 = await overlapAt(1536, 730);
const vp1280 = await overlapAt(1280, 720);
const vp375 = await overlapAt(375, 812);
const okChips = [vp1536, vp1280, vp375].every((v) => !v.overlap && v.hitLang && v.hitPerf);
record('G5 中/EN 与 GPU chip 不重叠且各自可点（1536/1280/375）', okChips, { vp1536, vp1280, vp375 });
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await sleep(1200);

const pass = results.filter((r) => r.ok).length;
writeFileSync(`${OUT}/phase3-guards.json`, JSON.stringify({ at: new Date().toISOString(), url: URL, results }, null, 2));
console.log(`\n=== ${pass}/${results.length} PASS ===`);
await browser.close();
process.exit(pass === results.length ? 0 : 1);
