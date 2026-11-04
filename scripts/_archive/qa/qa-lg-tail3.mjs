#!/usr/bin/env node
/**
 * qa-lg-tail3.mjs —— 收尾三项（t_b8251f33）实测脚本
 *  1) 折叠态内外层重复 .22 暗底：读 collapsed inner / 外层 .gev-lc 的 computed backgroundColor
 *  2) location-inner 502px 隐藏溢出：读 collapsed inner 的 scrollWidth / clientWidth（9 卡全测）
 *  3) shader 注释：纯文档（运行时只核对 dispN）
 *  另：展开托盘可用性 + 托盘动画（opacity 时间序列 / CSSTransition）+ 暗/亮对比度像素法 + 1536×730 截图
 * 输出：evidence/lg-glass-shots/p0/tail3/*.png + scratch/tail3.json（并打印 JSON）
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const DIR = 'evidence/lg-glass-shots/p0/tail3';
const SCR = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(DIR, { recursive: true });
fs.mkdirSync(SCR, { recursive: true });
const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const out = { url, errors: [], chrome: '' };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
out.chrome = await browser.version();
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => out.errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
await page.keyboard.press('Escape');
await page.evaluate(() => { const w = document.querySelector('.welcome-modal, #welcome-modal'); if (w) { const b = w.querySelector('button'); if (b) b.click(); } });

const flyTo = async (lon, lat, h) => {
  await page.evaluate(([lon, lat, h]) => {
    try {
      const C = window.Cesium || window.__CESIUM__;
      window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(lon, lat, h), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
    } catch (e) {}
  }, [lon, lat, h]);
  await new Promise((r) => setTimeout(r, 14000));
};

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };

/* 结构读数：折叠/展开、内外层背景、scrollWidth */
const structure = () => page.evaluate((IDS) => {
  const cards = IDS.map((id) => {
    const el = document.getElementById(id);
    if (!el) return { id, present: false };
    const cs = getComputedStyle(el);
    const inner = el.querySelector('[class$="-inner"], .panel-inner, .location-inner, .pp-panel-body');
    const ics = inner ? getComputedStyle(inner) : null;
    const tray = el.querySelector('.dock-popover-content');
    const tcs = tray ? getComputedStyle(tray) : null;
    return {
      id, present: true,
      isGl: el.classList.contains('gev-lc'),
      collapsed: el.classList.contains('collapsed'),
      lcBg: cs.backgroundColor,
      lcLum: el.dataset.gevLum || null,
      innerClass: inner ? inner.className : null,
      innerBg: ics ? ics.backgroundColor : null,
      innerBgImage: ics ? ics.backgroundImage : null,
      innerBackdrop: ics ? (ics.backdropFilter || ics.webkitBackdropFilter) : null,
      innerOverflow: ics ? ics.overflowX : null,
      sw: inner ? inner.scrollWidth : null,
      cw: inner ? inner.clientWidth : null,
      swDelta: inner ? inner.scrollWidth - inner.clientWidth : null,
      tray: tcs ? { display: tcs.display, visibility: tcs.visibility, opacity: tcs.opacity, w: Math.round(tray.getBoundingClientRect().width), h: Math.round(tray.getBoundingClientRect().height) } : null,
    };
  });
  return { htmlLum: document.documentElement.dataset.dataset, glassLum: document.documentElement.dataset.gevGlassLum, glassOn: document.documentElement.classList.contains('gev-gl-on'), cards };
}, IDS);

/* 像素法对比度：每卡标题行 6..28px 条带，p50=底 p97=字 */
const contrast = async (label) => {
  const boxes = await page.evaluate((IDS) => IDS.map((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { id, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }), IDS);
  const rows = [];
  for (const b of boxes) {
    if (!b || b.w < 12 || b.h < 8) { rows.push({ id: b?.id, skip: true }); continue; }
    const clip = { x: b.x + 6, y: b.y + 6, width: Math.max(10, b.w - 12), height: Math.min(22, Math.max(8, b.h - 12)) };
    const buf = await page.screenshot({ clip });
    fs.writeFileSync(`${SCR}/tail3-ct-${label}-${b.id}.png`, buf);
    const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const L = [];
    for (let i = 0; i < data.length; i += info.channels) L.push(0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]));
    L.sort((a, b2) => a - b2);
    const q = (p) => L[Math.min(L.length - 1, Math.floor(p * L.length))];
    const bg = q(0.5), fg = q(0.97);
    rows.push({ id: b.id, ratio: +(((fg + 0.05) / (bg + 0.05))).toFixed(2), bg: +bg.toFixed(3), fg: +fg.toFixed(3) });
  }
  return rows;
};

/* ── 折叠态「内层 .22」去掉前后的卡片平均亮度 A/B（暗场景） ─────────── */
const BEFORECSS = `
html.gev-gl-on .gev-lc.collapsed > .panel-inner,
html.gev-gl-on .gev-lc.collapsed > .data-panel-inner,
html.gev-gl-on .gev-lc.collapsed > .scene-panel-inner,
html.gev-gl-on .gev-lc.collapsed > .cctv-panel-inner,
html.gev-gl-on .gev-lc.collapsed > .global-context-panel-inner,
html.gev-gl-on .gev-lc.collapsed > .location-inner,
html.gev-gl-on .gev-lc.collapsed > .pp-panel-body { background: var(--gev-std-bg) !important; }
html.gev-gl-on[data-gev-glass-lum="bright"] .gev-lc.collapsed > .panel-inner,
html.gev-gl-on[data-gev-glass-lum="bright"] .gev-lc.collapsed > .data-panel-inner,
html.gev-gl-on[data-gev-glass-lum="bright"] .gev-lc.collapsed > .scene-panel-inner,
html.gev-gl-on[data-gev-glass-lum="bright"] .gev-lc.collapsed > .cctv-panel-inner,
html.gev-gl-on[data-gev-glass-lum="bright"] .gev-lc.collapsed > .global-context-panel-inner,
html.gev-gl-on[data-gev-glass-lum="bright"] .gev-lc.collapsed > .location-inner,
html.gev-gl-on[data-gev-glass-lum="bright"] .gev-lc.collapsed > .pp-panel-body { background: var(--gev-std-bg-bright) !important; }
`;
const setBefore = (on) => page.evaluate((on, css) => {
  let el = document.getElementById('__ab_before');
  if (on) { if (!el) { el = document.createElement('style'); el.id = '__ab_before'; el.textContent = css; document.head.appendChild(el); } }
  else if (el) el.remove();
}, on, BEFORECSS);
const cardLuma = () => page.evaluate((IDS) => IDS.map((id) => {
  const el = document.getElementById(id);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { id, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
}), IDS);
out.lumaAB = { dark: { after: [], before: [] }, bright: { after: [], before: [] } };
const collectLuma = async (sceneKey) => {
  for (const state of ['after', 'before']) {
    await setBefore(state === 'before');
    await new Promise((r) => setTimeout(r, 900));
    const boxes = await cardLuma();
    for (const b of boxes) {
      if (!b || b.w < 12 || b.h < 8) continue;
      const clip = { x: b.x + 3, y: b.y + 3, width: b.w - 6, height: b.h - 6 };
      const buf = await page.screenshot({ clip });
      const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let s = 0, n = 0;
      for (let i = 0; i < data.length; i += info.channels) { s += 0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]); n++; }
      out.lumaAB[sceneKey][state].push({ id: b.id, meanLum: +(s / n).toFixed(4) });
    }
  }
  await setBefore(false);
  await new Promise((r) => setTimeout(r, 600));
};

/* ── 折叠态（默认）：暗场景 ──────────────────────────────────────── */
await flyTo(-73.9857, 40.7484, 2200);
await page.evaluate(() => {
  /* 显式把所有卡片收成折叠态（若有 __gevLc API），保证测的是折叠态 */
  try {
    const api = window.__gevLc;
    if (api && api.close) ['data-panel', 'scene-panel', 'cctv-panel', 'global-context-panel'].forEach((id) => { try { api.close(id); } catch (e) {} });
  } catch (e) {}
});
await new Promise((r) => setTimeout(r, 900));
out.darkCollapsed = await structure();
await collectLuma('dark');
out.darkContrast = await contrast('dark');
await page.screenshot({ path: `${DIR}/dark-1536x730.png` });
await page.screenshot({ path: `${SCR}/tail3-dark-full.png` });

/* ── 展开托盘：真实点击 disclosure，采样动画 ─────────────────────── */
out.tray = await page.evaluate(async () => {
  const panel = document.getElementById('location-bar');
  const tray = panel.querySelector('.dock-popover-content');
  const disclosure = panel.querySelector('.dock-tray-toggle, [class*="disclosure"], button[aria-expanded]');
  const before = { display: getComputedStyle(tray).display, opacity: getComputedStyle(tray).opacity };
  const samples = [];
  const read = (t) => {
    const cs = getComputedStyle(tray);
    samples.push({ t: Math.round(t), display: cs.display, visibility: cs.visibility, opacity: +Number(cs.opacity).toFixed(3), anims: tray.getAnimations().map((a) => `${a.transitionProperty || a.animationName}:${a.playState}`) });
  };
  const t0 = performance.now();
  read(0);
  disclosure.dispatchEvent(new PointerEvent('click', { bubbles: true, detail: 1 }));
  for (const d of [16, 40, 80, 130, 200, 320]) {
    await new Promise((r) => setTimeout(r, d - (performance.now() - t0)));
    read(performance.now() - t0);
  }
  const rect = tray.getBoundingClientRect();
  const inner = panel.querySelector('.location-inner');
  return {
    disclosureFound: !!disclosure, before, samples,
    after: { display: getComputedStyle(tray).display, visibility: getComputedStyle(tray).visibility, opacity: getComputedStyle(tray).opacity },
    collapsed: panel.classList.contains('collapsed'),
    trayRect: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
    innerScroll: { sw: inner.scrollWidth, cw: inner.clientWidth },
  };
});
await new Promise((r) => setTimeout(r, 600));
out.expandedStructure = await structure();
await page.screenshot({ path: `${DIR}/dark-expanded-tray.png` });
await page.screenshot({ path: `${SCR}/tail3-expanded-tray.png` });

/* ── 收起回折叠态（走同一 disclosure 反向点击） ──────────────────── */
out.trayClose = await page.evaluate(async () => {
  const panel = document.getElementById('location-bar');
  const tray = panel.querySelector('.dock-popover-content');
  const disclosure = panel.querySelector('.dock-tray-toggle, [class*="disclosure"], button[aria-expanded]');
  disclosure.dispatchEvent(new PointerEvent('click', { bubbles: true, detail: 1 }));
  const samples = [];
  const t0 = performance.now();
  for (const d of [16, 80, 200, 400]) {
    await new Promise((r) => setTimeout(r, d - (performance.now() - t0)));
    const cs = getComputedStyle(tray);
    samples.push({ t: Math.round(performance.now() - t0), display: cs.display, visibility: cs.visibility, opacity: +Number(cs.opacity).toFixed(3) });
  }
  const inner = panel.querySelector('.location-inner');
  return { samples, collapsed: panel.classList.contains('collapsed'), innerScroll: { sw: inner.scrollWidth, cw: inner.clientWidth } };
});
await new Promise((r) => setTimeout(r, 400));
out.darkCollapsedAfter = await structure();

/* ── 亮场景（盐湖）：折叠态 ─────────────────────────────────────── */
await flyTo(-67.5, -20.13, 12000);
out.brightCollapsed = await structure();
await collectLuma('bright');
out.brightContrast = await contrast('bright');
await page.screenshot({ path: `${DIR}/bright-1536x730.png` });
await page.screenshot({ path: `${SCR}/tail3-bright-full.png` });

/* ── shader 运行时自证：dispN ───────────────────────────────────── */
out.glStats = await page.evaluate(() => {
  try { const s = window.__gevGlStats(); return { dispN: s.dispN, dispPx: s.dispPx, etaLo: s.etaLo, etaHi: s.etaHi, surfaces: s.surfaces.length, quads: s.quads }; } catch (e) { return { error: String(e) }; }
});

fs.writeFileSync(`${SCR}/tail3.json`, JSON.stringify(out, null, 1));
fs.writeFileSync(`${DIR}/tail3.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
