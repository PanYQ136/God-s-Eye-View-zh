#!/usr/bin/env node
/**
 * qa-gev-audit.mjs —— t_8cf06356 收口审计
 * 1) 折叠态 7 卡矩形（collapsed 基线）
 * 2) 逐卡展开：矩形 / 与其它可见卡+header 的 overlap 面积 / 安全区重叠
 * 3) 收起后是否回到 collapsed 原位
 * 4) 玻璃材质取证：warp 是否存在、filter、backdrop-filter、底色、gev-gl-on、#gev-gl-glass
 * 5) 滚动条：scrollWidth/clientWidth + 卡片内 webkit scrollbar
 * 用法: node scripts/qa-gev-audit.mjs [url] [outdir]
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.argv[2] || 'http://localhost:4173/';
const OUT = process.argv[3] || 'evidence/_collab/t_8cf06356';
fs.mkdirSync(OUT, { recursive: true });

const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const W = 1536, H = 730;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', `--window-size=${W},${H + 90}`],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(1200);

/* ── 通用测量工具（注入页面） ─────────────────────────────────────────── */
await page.evaluate(() => {
  window.__q = {
    rect(el) { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), r: Math.round(b.right), b: Math.round(b.bottom) }; },
    overlap(a, b) {
      const w = Math.min(a.r, b.r) - Math.max(a.x, b.x);
      const h = Math.min(a.b, b.b) - Math.max(a.y, b.y);
      return (w > 0 && h > 0) ? Math.round(w * h) : 0;
    },
    visible(el) {
      if (!el) return false;
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false;
      const b = el.getBoundingClientRect();
      return b.width > 2 && b.height > 2;
    },
    /* 卡片内所有「可见 header / 交互控件」矩形（用于重叠检测） */
    heads(el) {
      const out = [];
      const sel = '.panel-header,.pp-header-row,.dock-tray-toggle,.location-toolbar,.location-bar-toggle,.panel-title,.pp-header-label';
      el.querySelectorAll(sel).forEach((n) => {
        if (!window.__q.visible(n)) return;
        const b = n.getBoundingClientRect();
        if (b.height < 8) return;
        out.push({ cls: n.className.toString().slice(0, 40), ...window.__q.rect(n) });
      });
      return out;
    },
  };
});

/* ── 1. 材质 / 开关取证 ───────────────────────────────────────────────── */
const material = await page.evaluate(() => {
  const html = document.documentElement;
  const card = document.getElementById('data-panel');
  const cs = getComputedStyle(card);
  const warps = [...document.querySelectorAll('.gev-lg-warp')];
  const canvas = document.getElementById('gev-gl-glass');
  return {
    gevGlOn: html.classList.contains('gev-gl-on'),
    gevRgOn: html.classList.contains('gev-rg-on'),
    glCanvasInDom: !!canvas,
    glCanvasVisible: canvas ? getComputedStyle(canvas).display !== 'none' : false,
    scriptLoaded_gevGlGlass: [...document.scripts].some((s) => (s.src || '').includes('gev-gl-glass')),
    cardBg: cs.backgroundColor,
    cardBackdrop: cs.backdropFilter || cs.webkitBackdropFilter,
    warpCount: warps.length,
    warps: warps.slice(0, 12).map((w) => ({
      card: w.parentElement && w.parentElement.id,
      filter: getComputedStyle(w).filter,
      backdrop: getComputedStyle(w).backdropFilter || getComputedStyle(w).webkitBackdropFilter,
      display: getComputedStyle(w).display,
      z: getComputedStyle(w).zIndex,
      rect: (() => { const b = w.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; })(),
    })),
    svgFilterPresent: !!document.getElementById('gev-lg-svg'),
    lensFilters: [...document.querySelectorAll('svg filter')].map((f) => f.id),
    lum: html.dataset.gevGlassLum || null,
  };
});

/* ── 2. 折叠基线 ─────────────────────────────────────────────────────── */
const collapsed = {};
for (const id of CARDS) {
  collapsed[id] = await page.evaluate((id) => {
    const el = document.getElementById(id);
    return { ...window.__q.rect(el), collapsed: el.classList.contains('collapsed'), heads: window.__q.heads(el) };
  }, id);
}

/* ── 3. 逐卡展开测量 ─────────────────────────────────────────────────── */
const expansions = [];
for (const id of CARDS) {
  await page.evaluate((id) => { window.__gevLc.close(id); }, id).catch(() => {});
  await sleep(500);
  const before = await page.evaluate((id) => window.__gevLc.info(id), id);
  await page.evaluate((id) => window.__gevLc.open(id), id);
  await sleep(900);
  const m = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const self = window.__q.rect(el);
    const others = [];
    for (const oid of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab', 'gev-locate-btn', 'gev-perf-wrap', 'gev-lang-toggle', 'style-indicator', 'key-setup-chip']) {
      if (oid === id) continue;
      const o = document.getElementById(oid);
      if (!o || !window.__q.visible(o)) continue;
      const r = window.__q.rect(o);
      const ov = window.__q.overlap(self, r);
      others.push({ id: oid, rect: r, overlap: ov, collapsed: o.classList.contains('collapsed'), heads: window.__q.heads(o) });
    }
    // 展开卡内部 header 是否被裁切
    const selfHeads = window.__q.heads(el);
    const clipped = selfHeads.filter((h) => h.x < self.x - 1 || h.y < self.y - 1 || h.r > self.r + 1 || h.b > self.b + 1).map((h) => h.cls);
    const cs = getComputedStyle(el);
    return {
      self, cls: el.className, overflowY: cs.overflowY,
      others, clippedHeads: clipped,
      scroll: { sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth },
      innerScrollbars: [...el.querySelectorAll('*')].filter((n) => n.scrollHeight > n.clientHeight + 2).length,
    };
  }, id);
  const shot = path.join(OUT, `expand-${id}.png`);
  await page.screenshot({ path: shot });
  await page.evaluate((id) => window.__gevLc.close(id), id);
  await sleep(900);
  const after = await page.evaluate((id) => window.__gevLc.info(id), id);
  const totalOverlap = m.others.reduce((s, o) => s + o.overlap, 0);
  expansions.push({ id, before, self: m.self, totalOverlap, others: m.others.filter((o) => o.overlap > 0 || o.heads.length), clippedHeads: m.clippedHeads, scroll: m.scroll, after, shot, cls: m.cls, overflowY: m.overflowY });
}

/* ── 4. 各互斥组各开一张（3 张同屏 = 真实最坏情况）位置表 ──────────────── */
const COMBOS = [
  ['data-panel', 'pp-toggles', 'control-panel'],
  ['scene-panel', 'cctv-panel', 'location-bar'],
  ['data-panel', 'global-context-panel', 'location-bar'],
  ['scene-panel', 'pp-toggles', 'control-panel'],
];
const combos = [];
for (const combo of COMBOS) {
  for (const id of combo) { await page.evaluate((id) => window.__gevLc.open(id), id); await sleep(650); }
  const rows = await page.evaluate((ids) => {
    const out = [];
    for (const id of ids) {
      const el = document.getElementById(id);
      const self = window.__q.rect(el);
      const others = ids.filter((o) => o !== id).map((o) => ({ id: o, overlap: window.__q.overlap(self, window.__q.rect(document.getElementById(o))) }));
      const vis = window.__q.visible(el);
      out.push({ id, self, visible: vis, overlaps: others, total: others.reduce((s, o) => s + o.overlap, 0) });
    }
    return out;
  }, combo);
  const shot = `evidence/_collab/t_8cf06356/combo-${combo.join('+')}.png`;
  await page.screenshot({ path: shot });
  combos.push({ combo, rows, shot });
  for (const id of combo) { await page.evaluate((id) => window.__gevLc.close(id), id); await sleep(650); }
}
await sleep(600);

/* ── 4b. 全部收起后：卡片是否都回到 collapsed 原位、无隐藏残留 ──────────── */
const afterAll = await page.evaluate((ids) => {
  const rows = ids.map((id) => {
    const el = document.getElementById(id);
    return { id, rect: window.__q.rect(el), visible: window.__q.visible(el), hid: el.classList.contains('gev-lc-hid'), collapsed: el.classList.contains('collapsed') };
  });
  return { rows, hidCount: document.querySelectorAll('.gev-lc-hid').length, phantoms: document.querySelectorAll('.gev-lc-placeholder').length, floating: document.querySelectorAll('.gev-lc-floating').length };
}, CARDS);
await page.screenshot({ path: path.join(OUT, 'after-all-closed.png') });

/* ── 5. 滚动条证据 ───────────────────────────────────────────────────── */
const scrollbars = await page.evaluate(() => {
  const html = document.documentElement;
  const card = document.getElementById('data-panel');
  const inner = card.querySelector('.data-toggle-list') || card.firstElementChild;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-9999px;width:100px;height:100px;overflow:scroll';
  document.body.appendChild(probe);
  const res = {
    pageScrollWidth: html.scrollWidth, innerWidth: window.innerWidth, scrollbarPx: probe.offsetWidth - probe.clientWidth,
    cardFound: !!card,
    cardScrollWidth: card ? card.scrollWidth : null, cardClientWidth: card ? card.clientWidth : null,
    innerWebkitScrollbarWidth: inner ? (getComputedStyle(inner, '::-webkit-scrollbar').width) : null,
    innerScrollbarWidthProp: inner ? getComputedStyle(inner).scrollbarWidth : null,
    bodyScrollbarWidthProp: getComputedStyle(document.body).scrollbarWidth,
  };
  probe.remove();
  return res;
});

fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify({ errs, material, collapsed, expansions, combos, afterAll, scrollbars }, null, 1));
console.log(JSON.stringify({ errs: errs.slice(0, 8), material: { gevGlOn: material.gevGlOn, canvas: material.glCanvasInDom, warps: material.warpCount, scriptLoaded: material.scriptLoaded_gevGlGlass }, scrollbars, expansions: expansions.map((e) => ({ id: e.id, self: e.self, before: e.before, after: e.after, totalOverlap: e.totalOverlap, clippedHeads: e.clippedHeads, overlaps: e.others.filter((o) => o.overlap > 0).map((o) => [o.id, o.overlap]) })), combos: combos.map((c) => ({ combo: c.combo, rows: c.rows.map((r) => ({ id: r.id, self: r.self, visible: r.visible, total: r.total, hits: r.overlaps.filter((o) => o.overlap > 0).map((o) => [o.id, o.overlap]) })) })), afterAll }, null, 1));
await browser.close();
