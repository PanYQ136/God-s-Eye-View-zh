#!/usr/bin/env node
/**
 * qa-mat-audit.mjs —— iOS27 / Figma Liquid Glass 材质审计（t_fdd76e7a · v2）
 *
 * 关键改动（v2）：每个 phase 只取「一次 DOM 读数 + 一次全屏截图」，所有像素
 *   计算都在同一帧的 buffer 上做 —— 侧栏 top 会被 App 在运行中改（93.8 ↔
 *   189.8），分次截图会让 clip 落到地图上（v1 就吃了这个亏）。
 *
 * 每个 phase：pin → 读 rects/computed → 一张全屏 PNG → 从该 PNG 算
 *   文字对比度 / 边缘环可见度 / 局部 crop。
 *
 * 用法: node scripts/qa-mat-audit.mjs <outDir> <tag>
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'evidence/_collab/t_fdd76e7a/after';
const TAG = process.argv[3] || 'run';
const URL = process.env.GEV_URL || 'http://127.0.0.1:4173/';
const VW = 1536, VH = 730, DSF = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const CARDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const STYLE_SEL = {
  card: '#data-panel',
  cardRight: '#pp-toggles',
  cardDock: '#control-panel',
  tray: '#control-panel .dock-popover-content',
  trayLocation: '#location-bar .dock-popover-content',
  ppToggle: '#pp-toggles .pp-toggle-btn:not(.active)',
  dataToggle: '#data-panel .data-toggle-btn:not(.active)',
  styleBtn: '#control-panel .style-btn:not(.active)',
  mapChip: '#control-panel .map-stack-chip:not(.active)',
  chipLocate: '#gev-locate-btn',
  chipPerf: '#gev-perf-btn:not(.on)',
  chipFps: '#gev-perf-fps',
  chipLang: '#gev-lang-toggle',
  fab: '#gev-gfx-fab',
  ppHeader: '#pp-toggles .pp-header-row',
  warp: '#data-panel .gev-lg-warp',
};

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,820', '--hide-scrollbars'],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: VW, height: VH, deviceScaleFactor: DSF });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.removeItem('gev-liquid-cards:v2');
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
    localStorage.setItem('gev.gfx', JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'default' }));
  } catch (e) {}
});
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 240)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 240)); });

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(2500);

/* 固定相机并冻结渲染循环：暗场景的 A/B 必须在同一帧上，否则「材质差异」会
   被飞行中的瓦片分辨率/位置差异污染。 */
await page.evaluate(() => {
  try {
    const C = window.__CESIUM__ || window.Cesium;
    const v = window.__gevViewer;
    v.camera.cancelFlight();
    v.camera.setView({ destination: C.Cartesian3.fromDegrees(-46.6333, -23.5505, 9000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
  } catch (e) {}
});
await sleep(14000);
await page.evaluate(() => { try { window.__gevViewer.scene.tweens.removeAll && window.__gevViewer.scene.tweens.removeAll(); window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await sleep(1200);

const pin = () => page.evaluate(() => {
  const L = document.getElementById('left-panel-stack');
  if (L) { L.style.setProperty('top', '189.8px', 'important'); L.style.setProperty('transform', 'translateY(-96px)', 'important'); }
  const R = document.getElementById('right-context-rail');
  if (R) { R.style.setProperty('top', '93.8px', 'important'); R.style.removeProperty('transform'); }
});

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lumOf = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
/* 对比度必须与「谁亮谁暗」无关：(max+.05)/(min+.05)。
   早先写成 (Ld+.05)/(bg+.05) 会在深墨浅底（light 材质）时把 12:1 报成 0.08 —— 已修正。 */
const con = (a, b) => +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2);
/* 通用：给定文字盒 + 同一帧 buffer，算「声明色 vs 盒内亮度中位数」的对比度 */
const textRows = (texts, raw) => {
  const { data: rgb, info } = raw;
  const ch = info.channels, W = info.width;
  const rows = [];
  for (const tx of texts) {
    const x0 = Math.max(0, Math.floor(tx.rect[0]) - 1), y0 = Math.max(0, Math.floor(tx.rect[1]) - 1);
    const x1 = Math.min(VW, Math.ceil(tx.rect[0] + tx.rect[2]) + 1), y1 = Math.min(VH, Math.ceil(tx.rect[1] + tx.rect[3]) + 1);
    if (x1 - x0 < 4 || y1 - y0 < 4) continue;
    const L = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const xi = Math.round(x * DSF), yi = Math.round(y * DSF);
      if (xi < 0 || yi < 0 || xi >= W || yi >= info.height) continue;
      const i = (yi * W + xi) * ch;
      L.push(lumOf(rgb[i], rgb[i + 1], rgb[i + 2]));
    }
    if (!L.length) continue;
    L.sort((a, b) => a - b);
    const bg = L[Math.floor(L.length / 2)];
    const m = tx.color.match(/[\d.]+/g) || [255, 255, 255];
    const Ld = lumOf(+m[0], +m[1], +m[2]);
    rows.push({ tray: tx.tray, sel: tx.sel, t: tx.t, fs: tx.fs, color: tx.color, base: +bg.toFixed(3), declared: con(Ld, bg) });
  }
  return rows;
};

const collect = () => page.evaluate((CARDS, SEL) => {
  const norm = (v) => String(v).replace(/\s+/g, ' ').trim();
  const props = ['background-color', 'background-image', 'box-shadow', 'border', 'border-radius', 'corner-shape', 'backdrop-filter', 'color', 'opacity'];
  const styles = {};
  for (const [k, sel] of Object.entries(SEL)) {
    const el = document.querySelector(sel);
    if (!el) { styles[k] = { sel, missing: true }; continue; }
    const cs = getComputedStyle(el);
    const o = { sel, cls: String(el.className || '').slice(0, 120) };
    for (const p of props) o[p] = norm(cs.getPropertyValue(p));
    styles[k] = o;
  }
  const cards = {}, cardTexts = {}, rings = [];
  for (const id of CARDS) {
    const el = document.getElementById(id);
    if (!el) continue;
    const b = el.getBoundingClientRect();
    cards[id] = [Math.round(b.left * 10) / 10, Math.round(b.top * 10) / 10, Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10];
    rings.push({ id, rect: [b.left, b.top, b.width, b.height] });
    const texts = [];
    el.querySelectorAll('*').forEach((n) => {
      if (n.children.length) return;
      const t = (n.textContent || '').trim();
      if (!t || t.length > 10) return;
      const r = n.getBoundingClientRect();
      if (r.width < 8 || r.height < 7) return;
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.3) return;
      texts.push({ t, rect: [r.left, r.top, r.width, r.height], color: cs.color, fs: cs.fontSize });
    });
    cardTexts[id] = texts.slice(0, 5);
  }
  /* 悬浮 chip（定位 / FPS / 性能 / 中EN / 密钥）单独量：它们在卡片之外、直接压地图 */
  const CHIPS = ['#gev-locate-btn', '#gev-perf-fps', '#gev-lang-toggle', '#key-setup-chip', '#gev-perf-btn'];
  const chipTexts = [];
  for (const sel of CHIPS) {
    const el = document.querySelector(sel);
    if (!el) continue;
    el.querySelectorAll('*').forEach((n) => {
      if (n.children.length) return;
      const t = (n.textContent || '').trim();
      if (!t || t.length > 12) return;
      const r = n.getBoundingClientRect();
      if (r.width < 4 || r.height < 6) return;
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.3) return;
      chipTexts.push({ sel, t, rect: [r.left, r.top, r.width, r.height], color: cs.color, fs: cs.fontSize });
    });
  }
  /* 布局 A/B：卡壳 / 托盘 / 按钮 / chip 的盒模型与溢出指标（§12 只应改绘制，不改几何） */
  const UI_SEL = ['.gev-lc', '.dock-popover-content', '.pp-toggle-btn', '.data-toggle-btn', '.style-btn',
    '.map-stack-chip', '.pp-mode-btn', '.context-mode-button', '.search-toggle-btn',
    '#gev-locate-btn', '#gev-perf-fps', '#gev-lang-toggle', '#key-setup-chip', '#gev-perf-btn'];
  const ui = [];
  for (const sel of UI_SEL) {
    document.querySelectorAll(sel).forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1) return;
      ui.push({
        k: sel + '#' + i,
        r: [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10],
        sw: el.scrollWidth, cw: el.clientWidth, sh: el.scrollHeight, ch: el.clientHeight,
      });
    });
  }

  const trays = {};
  for (const id of ['location-bar', 'control-panel']) {
    const t = document.querySelector('#' + id + ' .dock-popover-content');
    if (!t) continue;
    const b = t.getBoundingClientRect();
    const cs = getComputedStyle(t);
    trays[id] = { rect: [b.left, b.top, b.width, b.height], display: cs.display, visibility: cs.visibility, opacity: cs.opacity };
  }
  /* 托盘内文字（展开时）：小字密集，是本层最容易掉对比度的地方 */
  const trayTexts = [];
  for (const id of ['location-bar', 'control-panel']) {
    const t = document.querySelector('#' + id + ' .dock-popover-content');
    if (!t) continue;
    const tb = t.getBoundingClientRect();
    if (tb.width < 20) continue;
    t.querySelectorAll('*').forEach((n) => {
      if (n.children.length) return;
      const s = (n.textContent || '').trim();
      if (!s || s.length > 12) return;
      const r = n.getBoundingClientRect();
      if (r.width < 6 || r.height < 7) return;
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.3) return;
      if (r.top < tb.top || r.bottom > tb.bottom) return;
      trayTexts.push({ tray: id, t: s, rect: [r.left, r.top, r.width, r.height], color: cs.color, fs: cs.fontSize });
    });
  }
  return {
    lum: document.documentElement.dataset.gevGlassLum || null,
    mat: document.documentElement.dataset.gevMat || null,
    lgGlassSkins: document.querySelectorAll('.lg-glass-skin').length,
    cards, cardTexts, chipTexts, trayTexts, trays, rings, styles, ui,
  };
}, CARDS, STYLE_SEL);

function analyze(dom, raw, label) {
  const { data: rgb, info } = raw;
  const ch = info.channels, W = info.width;
  const pxLum = (x, y) => {
    const xi = Math.round(x * DSF), yi = Math.round(y * DSF);
    if (xi < 0 || yi < 0 || xi >= W || yi >= info.height) return null;
    const i = (yi * W + xi) * ch;
    return lumOf(rgb[i], rgb[i + 1], rgb[i + 2]);
  };
  /* 文字对比度：clip 内亮度中位数当底色，声明色当字色 */
  const contrastRows = [];
  for (const [cardId, texts] of Object.entries(dom.cardTexts)) {
    const row = { id: cardId, card: dom.cards[cardId], texts: [] };
    for (const tx of texts) {
      const x0 = Math.max(0, Math.floor(tx.rect[0]) - 1), y0 = Math.max(0, Math.floor(tx.rect[1]) - 1);
      const x1 = Math.min(VW, Math.ceil(tx.rect[0] + tx.rect[2]) + 1), y1 = Math.min(VH, Math.ceil(tx.rect[1] + tx.rect[3]) + 1);
      if (x1 - x0 < 4 || y1 - y0 < 4) continue;
      const L = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const l = pxLum(x, y); if (l != null) L.push(l); }
      L.sort((a, b) => a - b);
      const bg = L[Math.floor(L.length / 2)];
      const m = tx.color.match(/[\d.]+/g) || [255, 255, 255];
      const Ld = lumOf(+m[0], +m[1], +m[2]);
      row.texts.push({ t: tx.t, fs: tx.fs, color: tx.color, base: +bg.toFixed(3), declared: con(Ld, bg) });
    }
    if (row.texts.length) contrastRows.push(row);
  }
  const all = contrastRows.flatMap((c) => c.texts.map((t) => t.declared));
  /* chip 对比度（卡片之外，直接压地图） */
  const chipRows = [];
  for (const tx of dom.chipTexts || []) {
    const x0 = Math.max(0, Math.floor(tx.rect[0]) - 1), y0 = Math.max(0, Math.floor(tx.rect[1]) - 1);
    const x1 = Math.min(VW, Math.ceil(tx.rect[0] + tx.rect[2]) + 1), y1 = Math.min(VH, Math.ceil(tx.rect[1] + tx.rect[3]) + 1);
    if (x1 - x0 < 4 || y1 - y0 < 4) continue;
    const L = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const l = pxLum(x, y); if (l != null) L.push(l); }
    if (!L.length) continue;
    L.sort((a, b) => a - b);
    const bg = L[Math.floor(L.length / 2)];
    const m = tx.color.match(/[\d.]+/g) || [255, 255, 255];
    const Ld = lumOf(+m[0], +m[1], +m[2]);
    chipRows.push({ sel: tx.sel, t: tx.t, fs: tx.fs, color: tx.color, base: +bg.toFixed(3), declared: con(Ld, bg) });
  }
  /* 边缘环：卡中线左右各取样 34 CSS px 的亮度极差 */
  const ringRows = [];
  for (const r of dom.rings) {
    if (!r.rect || r.rect[2] < 40) continue;
    const y = r.rect[1] + r.rect[3] / 2, xa = r.rect[0], xb = r.rect[0] + r.rect[2];
    if (y < 0 || y > VH) continue;
    const series = [];
    for (let x = Math.round(xa - 2); x <= Math.round(xb + 2); x++) series.push(pxLum(x, y));
    const band = Math.min(34, Math.floor(series.length * 0.25));
    const Lb = series.slice(2, 2 + band), Rb = series.slice(series.length - 2 - band, series.length - 2);
    const mid = series.slice(Math.floor(series.length * 0.4), Math.floor(series.length * 0.6));
    const span = (a) => Math.max(...a) - Math.min(...a);
    ringRows.push({
      id: r.id,
      leftBand: +(span(Lb) * 255).toFixed(1),
      rightBand: +(span(Rb) * 255).toFixed(1),
      centerLum: +(mid.reduce((a, b) => a + b, 0) / mid.length).toFixed(3),
    });
  }
  return {
    label,
    lum: dom.lum, mat: dom.mat, lgGlassSkins: dom.lgGlassSkins,
    cards: dom.cards, trays: dom.trays, styles: dom.styles, ui: dom.ui,
    contrast: { rows: contrastRows, worst: all.length ? +Math.min(...all).toFixed(2) : null, pass: all.filter((v) => v >= 4.5).length + '/' + all.length },
    chips: chipRows,
    ring: ringRows,
  };
}

async function phase(name) {
  await pin(); await sleep(350);
  const dom = await collect();
  const buf = await page.screenshot();
  fs.writeFileSync(path.join(OUT, `${TAG}-${name}-full.png`), buf);
  const raw = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rep = analyze(dom, raw, name);
  /* 局部 crop（同一帧 buffer 上切） */
  const crop = async (tag, r, m = 14, extraH = 0) => {
    if (!r) return;
    const left = Math.max(0, Math.round((r[0] - m) * DSF)), top = Math.max(0, Math.round((r[1] - m) * DSF));
    const width = Math.min(Math.round(raw.info.width - left), Math.round((r[2] + m * 2) * DSF));
    const height = Math.min(Math.round(raw.info.height - top), Math.round((r[3] + m * 2 + extraH) * DSF));
    if (width < 8 || height < 8) return;
    await sharp(buf).extract({ left, top, width, height }).toFile(path.join(OUT, `${TAG}-${name}-${tag}.png`));
  };
  await crop('left', rep.cards['data-panel'], 12, 116);
  await crop('right', rep.cards['pp-toggles'], 12, 120);
  await crop('dock', rep.cards['location-bar'], 12, 6);
  await crop('fab', rep.cards['gev-gfx-fab'], 16, 0);
  await crop('chips', [686, 32, 512, 56], 6, 0);
  return rep;
}

const report = { tag: TAG, url: URL, viewport: [VW, VH, DSF], phases: {} };

/* 同帧 A/B：把改造前的表面声明临时注回去（值取自改前的 computed 实测），
   这样「改前/改后」在同一相机、同一位置、同一帧上量，不受侧栏漂移影响。 */
const SIM_CSS = `
.gev-lc { background: rgba(12,18,26,.52) !important; background-image: none !important;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.10), 0 12px 40px rgba(0,0,0,.28) !important; }
html[data-gev-glass-lum="bright"] .gev-lc { background: rgba(5,9,14,.72) !important; }
.gev-lc:hover { box-shadow: inset 0 0 0 1px rgba(255,255,255,.10), 0 14px 44px rgba(0,0,0,.34) !important; }
#command-dock .dock-popover-content { background: rgba(8,20,30,.94) !important; border-color: rgba(123,189,211,.32) !important;
  box-shadow: 0 .9rem 2.4rem rgba(0,0,0,.58), 0 0 1.5rem rgba(0,212,255,.08), 0 0 0 1px rgba(255,255,255,.025) inset !important; }
:is(#left-panel-stack,#right-context-rail,#command-dock,.dock-popover-content) :is(.data-toggle-btn,.style-btn,.map-stack-chip,.context-mode-button,.pp-mode-btn):not(.active):not(.on) {
  background-color: rgba(255,255,255,.04) !important; background-image: none !important; border-color: rgba(255,255,255,.08) !important; box-shadow: none !important; }
:is(#left-panel-stack,#right-context-rail,#command-dock,.dock-popover-content) .pp-toggle-btn:not(.active) {
  background-color: transparent !important;
  background-image: linear-gradient(rgba(255,255,255,.35),rgba(255,255,255,.35)), linear-gradient(rgba(255,255,255,.14),rgba(255,255,255,.14)) !important;
  border-color: transparent !important;
  box-shadow: rgba(40,40,40,.4) 0 11.2px 2.8px -11.2px inset, rgba(40,40,40,.4) 0 -11.2px 2.8px -11.2px inset, rgba(230,230,230,.4) 0 11.2px 8.4px -11.2px inset, rgba(0,0,0,.28) 0 1px 5px !important;
  backdrop-filter: blur(22px) saturate(1.9) !important; }
#gev-locate-btn, #gev-lang-toggle { background: rgba(12,12,20,.72) !important; border-color: rgba(0,212,255,.28) !important;
  box-shadow: 0 8px 28px rgba(0,0,0,.5), 0 0 18px rgba(0,212,255,.08) !important; }
#gev-perf-btn:not(.on), #gev-perf-fps { background: rgba(8,20,30,.72) !important; border-color: #2b4a63 !important; box-shadow: none !important; }
`;
const simOn = () => page.evaluate((css) => {
  let s = document.getElementById('qa-mat-sim');
  if (!s) { s = document.createElement('style'); s.id = 'qa-mat-sim'; document.head.appendChild(s); }
  s.textContent = css;
}, SIM_CSS);
const simOff = () => page.evaluate(() => { const s = document.getElementById('qa-mat-sim'); if (s) s.remove(); });

const sampleFps = async (tag) => {
  const vals = [];
  for (let i = 0; i < 6; i++) {
    await sleep(700);
    const v = await page.evaluate(() => {
      const e = document.getElementById('gev-perf-fps');
      return e ? (e.textContent || '').trim() : null;
    });
    if (v) vals.push(v);
  }
  report.fps = report.fps || {};
  report.fps[tag] = { samples: vals, median: vals.sort((a, b) => parseFloat(a) - parseFloat(b))[Math.floor(vals.length / 2)] || null };
};

await pin(); await sleep(600);
report.phases.dark = await phase('dark');
await simOn(); await sleep(300);
report.phases['dark-before'] = await phase('dark-before');
await simOff(); await sleep(250);

/* Figma「Light」变体（白 .70 / #DBDBDB 描边）—— 显式 html[data-gev-mat="light"] 才开 */
await page.evaluate(() => document.documentElement.setAttribute('data-gev-mat', 'light'));
report.phases.light = await phase('light');
await page.evaluate(() => document.documentElement.removeAttribute('data-gev-mat'));
await sleep(200);



/* 亮场景：乌尤尼盐湖（真实高反照底图） */
await page.evaluate(() => {
  try {
    const C = window.__CESIUM__ || window.Cesium;
    window.__gevViewer.useDefaultRenderLoop = true;
    window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-67.5, -20.13, 12000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
  } catch (e) {}
});
await sleep(16000);
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
report.phases.bright = await phase('bright');
await simOn(); await sleep(300);
report.phases['bright-before'] = await phase('bright-before');
await simOff(); await sleep(250);

/* 探针触发后的兜底档：显式 html[data-gev-glass-lum="bright"]（雪地/盐湖真运行时由 8×8
   亮度探针自动设置；这里冻结了渲染循环，探针读不到新画面，所以手动锁死 attribute，
   并用 MutationObserver 阻止探针每 2s 把它改回 dark —— 等价于「探针判定为亮底」）。 */
const forceBright = (on) => page.evaluate((on) => {
  const h = document.documentElement;
  if (on) {
    h.setAttribute('data-gev-glass-lum', 'bright');
    if (!window.__qaBrightObs) {
      window.__qaBrightObs = new MutationObserver(() => {
        if (h.getAttribute('data-gev-glass-lum') !== 'bright') h.setAttribute('data-gev-glass-lum', 'bright');
      });
      window.__qaBrightObs.observe(h, { attributes: true, attributeFilter: ['data-gev-glass-lum'] });
    }
  } else {
    if (window.__qaBrightObs) { window.__qaBrightObs.disconnect(); window.__qaBrightObs = null; }
    h.removeAttribute('data-gev-glass-lum');
  }
}, on);
await forceBright(true);
await sleep(400);
report.phases['bright-probe'] = await phase('bright-probe');
await forceBright(false);
await sleep(250);

/* 亮场景 · 纯白最坏情况：直接把卡片底下的画布换成白（CSS 背景），
   验证「没有亮度探针兜底时」.62 填充在纯白底上的对比度 */
await page.evaluate(() => {
  const st = document.createElement('style');
  st.id = 'qa-white-bg';
  st.textContent = '#cesiumContainer, .cesium-widget, .cesium-widget canvas { visibility: hidden !important; } body { background: #ffffff !important; }';
  document.head.appendChild(st);
});
await sleep(600);
report.phases.white = await phase('white');
await simOn(); await sleep(300);
report.phases['white-before'] = await phase('white-before');
await simOff(); await sleep(250);
/* 纯白 + 探针 bright 兜底（真运行时亮底会切到 bright） */
await forceBright(true);
await sleep(400);
report.phases['white-probe'] = await phase('white-probe');
await forceBright(false);
await sleep(250);
await page.evaluate(() => { const e = document.getElementById('qa-white-bg'); if (e) e.remove(); });
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = true; } catch (e) {} });
await sleep(800);

/* 托盘（App 展开 → .dock-popover-content 可见） */
const openDock = async (id) => {
  const p = await page.evaluate((id) => {
    const b = document.getElementById(id + '-toggle');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.left + 18), y: Math.round(r.top + r.height / 2) };
  }, id);
  if (!p) return false;
  await page.mouse.click(p.x, p.y);
  await sleep(900);
  return page.evaluate((id) => !document.getElementById(id).classList.contains('collapsed'), id);
};
report.phases.tray = {};
const trayStats = (data, raw, id) => {
  const rows = textRows((data.trayTexts || []).filter((t) => t.tray === id), raw);
  const vals = rows.map((r) => r.declared);
  return { worst: vals.length ? +Math.min(...vals).toFixed(2) : null, pass: vals.filter((v) => v >= 4.5).length + '/' + vals.length, below: rows.filter((r) => r.declared < 4.5).slice(0, 8), rows: rows.length };
};
for (const id of ['control-panel', 'location-bar']) {
  const opened = await openDock(id);
  const data = await collect();
  const buf = await page.screenshot();
  fs.writeFileSync(path.join(OUT, `${TAG}-tray-${id}-full.png`), buf);
  const raw = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const t = data.trays[id];
  if (t && t.rect[2] > 10) {
    const left = Math.max(0, Math.round((t.rect[0] - 20) * DSF)), top = Math.max(0, Math.round((t.rect[1] - 24) * DSF));
    const width = Math.round((t.rect[2] + 40) * DSF);
    const height = Math.min(Math.round((t.rect[3] + 44) * DSF), 1460 - top);
    try { await sharp(buf).extract({ left, top, width, height }).toFile(path.join(OUT, `${TAG}-tray-${id}.png`)); } catch (e) {}
  }
  report.phases.tray[id] = { opened, lum: data.lum, styles: data.styles, trays: data.trays, text: trayStats(data, raw, id) };
  if (opened && t && t.rect[2] > 10) {
    const before = path.join(OUT, `${TAG}-tray-${id}.png`);
    if (fs.existsSync(before)) fs.copyFileSync(before, path.join(OUT, `${TAG}-tray-${id}-after.png`));
    await simOn(); await sleep(300);
    const d2 = await collect();
    const buf2 = await page.screenshot();
    const raw2 = await sharp(buf2).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const t2 = d2.trays[id];
    if (t2 && t2.rect[2] > 10) {
      const left = Math.max(0, Math.round((t2.rect[0] - 20) * DSF)), top = Math.max(0, Math.round((t2.rect[1] - 24) * DSF));
      const width = Math.round((t2.rect[2] + 40) * DSF), height = Math.min(Math.round((t2.rect[3] + 44) * DSF), 1460 - top);
      try { await sharp(buf2).extract({ left, top, width, height }).toFile(path.join(OUT, `${TAG}-tray-${id}-before.png`)); } catch (e) {}
    }
    report.phases.tray[id].textBefore = trayStats(d2, raw2, id);
    await simOff(); await sleep(200);
  }
  if (opened) { await openDock(id); await sleep(600); }
}

report.errors = errs.slice(0, 12);
report.errorCount = errs.length;
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const brief = {};
for (const k of Object.keys(report.phases)) {
  if (!report.phases[k] || !report.phases[k].contrast) continue;
  const p = report.phases[k];
  const cv = (p.chips || []).map((c) => c.declared);
  brief[k] = { lum: p.lum, mat: p.mat, worst: p.contrast.worst, pass: p.contrast.pass, chipsWorst: cv.length ? +Math.min(...cv).toFixed(2) : null, chipPass: cv.filter((v) => v >= 4.5).length + '/' + cv.length, cards: p.cards };
}
console.log(JSON.stringify({ out: OUT, phases: brief, fps: report.fps, trays: { c: report.phases.tray['control-panel'].opened, l: report.phases.tray['location-bar'].opened }, errors: report.errors }, null, 1));
await browser.close();
