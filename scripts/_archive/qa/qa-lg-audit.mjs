#!/usr/bin/env node
/**
 * qa-lg-audit.mjs —— 规范 §5 视觉/回归硬指标审计（自动判定 PASS/FAIL）
 *  · 双描边 / 内层玻璃(backdrop-filter) / 滚动条 / 黑字 / 内层卡片 / 同屏玻璃数 / 卡内透明
 *  · 文字对比度（从真实截图像素算 WCAG 比值）
 *  · 展开时兄弟卡是 collapse 而不是 display:none
 * 用法: node scripts/qa-lg-audit.mjs <url> <label> [lon] [lat] [hgt] [dsf]
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const url = process.argv[2] || 'http://localhost:5183/';
const label = process.argv[3] || 'audit';
const lon = Number(process.argv[4] || 11.4), lat = Number(process.argv[5] || 46.5), hgt = Number(process.argv[6] || 9000);
const dsf = Number(process.argv[7] || 2);
const outDir = 'evidence/lg-glass-shots/p0';

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: dsf });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('c:' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 9000));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => { const w = document.querySelector('.welcome-modal, #welcome-modal'); if (w) { const c = w.querySelector('input'); if (c) c.click(); const b = w.querySelector('button'); if (b) b.click(); } });
await page.evaluate((lon, lat, hgt) => { try { window.__gevViewer.camera.setView({ destination: window.__CESIUM__.Cartesian3.fromDegrees(lon, lat, hgt), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }); } catch (e) {} }, lon, lat, hgt);
await new Promise((r) => setTimeout(r, 9000));
for (let i = 0; i < 15; i++) {
  const ok = await page.evaluate(() => !!(window.__gevGlStats && window.__gevGlStats().count >= 9));
  if (ok) break;
  await new Promise((r) => setTimeout(r, 1200));
}
await new Promise((r) => setTimeout(r, 3000));

const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];

const audit = await page.evaluate((IDS) => {
  const res = { cards: [], issues: [] };
  const push = (k, v) => { res.issues.push({ kind: k, detail: v }); };
  IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) { push('missing-card', id); return; }
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const inner = el.querySelector('[class$="-inner"], .pp-panel-body');
    const ics = inner ? getComputedStyle(inner) : null;
    const row = {
      id, lc: el.classList.contains('gev-lc'), collapsed: el.classList.contains('collapsed'),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      cardBg: cs.backgroundColor, cardBorder: cs.borderTopWidth, cardShadow: cs.boxShadow, cardBackdrop: cs.backdropFilter || cs.webkitBackdropFilter,
      innerBg: ics ? ics.backgroundColor : null, innerShadow: ics ? ics.boxShadow : null, innerBorder: ics ? ics.borderTopWidth : null,
      innerBackdrop: ics ? (ics.backdropFilter || ics.webkitBackdropFilter) : null,
      radius: cs.borderRadius,
      scrollW: el.scrollWidth - el.clientWidth, scrollH: el.scrollHeight - el.clientHeight,
      surgeGlassCount: 0, children: el.querySelectorAll('*').length,
    };
    // 内层玻璃/双描边检测
    if (row.cardBorder !== '0px') push('card-border', id + ' = ' + cs.borderTopWidth + ' ' + cs.borderTopColor);
    if (row.cardShadow !== 'none') push('card-shadow', id + ' = ' + cs.boxShadow);
    if (row.cardBackdrop && row.cardBackdrop !== 'none') push('card-backdrop(2nd glass)', id + ' = ' + row.cardBackdrop);
    if (row.innerBackdrop && row.innerBackdrop !== 'none') push('inner-backdrop(2nd glass)', id + ' = ' + row.innerBackdrop);
    if (row.innerShadow && row.innerShadow !== 'none') push('inner-shadow(2nd ring)', id + ' = ' + row.innerShadow);
    if (row.innerBorder !== null && row.innerBorder !== '0px') push('inner-border(2nd ring)', id + ' = ' + row.innerBorder);
    // 卡内任意元素带 backdrop / 第二圈 inset
    el.querySelectorAll('*').forEach((e) => {
      const c = getComputedStyle(e);
      const bf = c.backdropFilter || c.webkitBackdropFilter;
      if (bf && bf !== 'none' && e.getBoundingClientRect().width > 4) push('descendant-backdrop', id + ' > ' + (e.id || e.className) + ' = ' + bf);
    });
    // 滚动条/溢出：用 offsetWidth-clientWidth 判「真实可见滚动条」（全局已隐藏 scrollbar）
    if (row.scrollW > 2) {
      const barW = el.offsetWidth - el.clientWidth;
      if (barW > 1) push('visible-scrollbar', id + ' barW=' + barW + ' scrollW+' + row.scrollW);
    }
    // 黑字
    el.querySelectorAll('*').forEach((e) => {
      if (e.children.length || !e.textContent || !e.textContent.trim()) return;
      const c = getComputedStyle(e).color;
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m && +m[1] < 60 && +m[2] < 60 && +m[3] < 60) push('black-text', id + ' ' + (e.className || e.tagName) + ' ' + c);
    });
    res.cards.push(row);
  });
  // 滚动条可见性
  const anyScroller = [...document.querySelectorAll('*')].filter((e) => {
    const c = getComputedStyle(e);
    return e.scrollHeight > e.clientHeight + 4 && c.overflowY !== 'visible' && c.overflowY !== 'hidden';
  }).map((e) => (e.id || e.className || e.tagName).toString().slice(0, 40));
  res.visibleScrollContainers = anyScroller.slice(0, 20);
  const g = window.__gevGlStats ? window.__gevGlStats() : null;
  res.glass = g ? { count: g.count, fps: g.fps, scale: g.scale, surfaces: g.surfaces } : null;
  res.html = {
    scrollbarWidthRule: getComputedStyle(document.documentElement).scrollbarWidth,
    lum: document.documentElement.dataset.gevGlassLum,
  };
  return res;
}, IDS);

/* ── 文字对比度：用真实截图像素算 WCAG ───────────────────────────────── */
const shotBuf = await page.screenshot();
const b64 = shotBuf.toString('base64');
const bboxes = await page.evaluate((IDS) => {
  const out = [];
  const sel = [
    ['#data-panel .panel-title', 'data-panel/title'],
    ['#pp-toggles .pp-header-label', 'pp-toggles/header'],
    ['#cctv-panel .panel-title', 'cctv/title'],
    ['#location-bar .dock-tray-toggle span', 'location/label'],
    ['#global-context-panel .panel-title', 'context/title'],
    ['#scene-panel .panel-title', 'scene/title'],
  ];
  sel.forEach(([s, name]) => {
    const e = document.querySelector(s);
    if (!e) return;
    const r = e.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return;
    out.push({ name, x: r.left, y: r.top, w: r.width, h: r.height });
  });
  // 卡片局部底色（取卡片内空白区 8x8）
  IDS.forEach((id) => {
    const e = document.getElementById(id);
    if (!e) return;
    const r = e.getBoundingClientRect();
    if (r.width < 20) return;
    out.push({ name: 'bg:' + id, x: r.left + r.width - 26, y: r.top + r.height / 2 - 4, w: 8, h: 8 });
  });
  return out;
}, IDS);

const contrast = await page.evaluate(async (b64, bboxes, dsf) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = 'data:image/png;base64,' + b64; });
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
  const lum = (r, g, b) => {
    const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const measure = (bb) => {
    const x = Math.max(0, Math.round(bb.x * dsf)), y = Math.max(0, Math.round(bb.y * dsf));
    const w = Math.max(2, Math.round(bb.w * dsf)), h = Math.max(2, Math.round(bb.h * dsf));
    const d = cx.getImageData(x, y, w, h).data;
    const ls = [];
    for (let i = 0; i < d.length; i += 4) ls.push(lum(d[i], d[i + 1], d[i + 2]));
    ls.sort((a, b) => a - b);
    return { max: ls[ls.length - 1], p90: ls[Math.floor(ls.length * 0.9)], median: ls[Math.floor(ls.length * 0.5)], min: ls[0] };
  };
  const res = {};
  bboxes.forEach((bb) => { res[bb.name] = measure(bb); });
  return res;
}, b64, bboxes, dsf);

const pairs = [];
Object.keys(contrast).filter((k) => k.startsWith('bg:')).forEach((bgKey) => {
  const id = bgKey.slice(3);
  const bgL = contrast[bgKey].median;
  Object.keys(contrast).filter((k) => k.endsWith('/' + (id === 'data-panel' ? 'title' : id === 'pp-toggles' ? 'header' : id === 'cctv-panel' ? 'title' : id))).forEach(() => {});
});
// 对比度按名字配对（text name 前缀 = card id 片段）
const textKeys = Object.keys(contrast).filter((k) => !k.startsWith('bg:'));
const bgFor = { 'data-panel': 'bg:data-panel', 'pp-toggles': 'bg:pp-toggles', 'cctv-panel': 'bg:cctv-panel', 'location-bar': 'bg:location-bar', 'global-context-panel': 'bg:global-context-panel', 'scene-panel': 'bg:scene-panel' };
textKeys.forEach((k) => {
  const card = Object.keys(bgFor).find((c) => k.startsWith(c + '/'));
  if (!card || !contrast[bgFor[card]]) return;
  const bg = contrast[bgFor[card]].median;
  const txt = contrast[k].p90;   // 取亮部（文字像素）
  const ratio = +(((Math.max(txt, bg) + 0.05) / (Math.min(txt, bg) + 0.05))).toFixed(2);
  pairs.push({ text: k, textLum: +txt.toFixed(3), bgLum: +bg.toFixed(3), ratio, pass: ratio >= 4.5 });
});

/* ── 展开：兄弟卡必须 collapse，不是 display:none ─────────────────────── */
await page.evaluate(() => window.__gevLc.open('data-panel'));
await new Promise((r) => setTimeout(r, 800));
const sib = await page.evaluate(() => {
  const s = document.getElementById('scene-panel');
  const cs = getComputedStyle(s);
  return { display: cs.display, visibility: cs.visibility, opacity: cs.opacity, collapsed: s.classList.contains('collapsed'), h: Math.round(s.getBoundingClientRect().height), visible: s.getBoundingClientRect().height > 10 };
});
await page.screenshot({ path: `${outDir}/${label}-expanded.png` });
await page.screenshot({ path: `${outDir}/${label}-expanded-zoom.png`, clip: { x: 30, y: 80, width: 380, height: 400 } });
await page.evaluate(() => window.__gevLc.close('data-panel'));
await new Promise((r) => setTimeout(r, 700));

/* ── 玻璃边缘 2x 特写（验证 10–16px 透镜带/rim/色散） ─────────────────── */
await page.screenshot({ path: `${outDir}/${label}-edge-rail.png`, clip: { x: 1296, y: 84, width: 200, height: 60 } });
await page.screenshot({ path: `${outDir}/${label}-edge-fab.png`, clip: { x: 1460, y: 575, width: 80, height: 80 } });
await page.screenshot({ path: `${outDir}/${label}-full.png` });

const summary = {
  label, viewport: [1536, 730], dsf, scene: { lon, lat, hgt },
  errors: errs,
  pass: {
    cards_glass: audit.cards.filter((c) => c.lc).length + '/9',
    glass_surfaces: audit.glass ? audit.glass.count : 0,
    glass_fps: audit.glass ? audit.glass.fps : 0,
    issueCount: audit.issues.length,
  },
  issues: audit.issues,
  cards: audit.cards,
  contrast: pairs,
  scrollContainers: audit.visibleScrollContainers,
  siblingOnExpand: sib,
  glassSurfaces: audit.glass ? audit.glass.surfaces : null,
  lum: audit.html.lum,
  state: await page.evaluate(() => ({
    htmlClass: document.documentElement.className,
    voiceShadow: getComputedStyle(document.getElementById('gev-voice-control')).boxShadow,
    ppLabel: (() => { const e = document.querySelector('#pp-toggles .pp-label'); return e ? getComputedStyle(e).color : null; })(),
    bodyBgCards: [...document.querySelectorAll('.gev-lc')].map((e) => e.id + ':' + getComputedStyle(e).backgroundColor),
  })),
};
fs.writeFileSync(`${outDir}/${label}-audit.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ pass: summary.pass, issues: audit.issues.slice(0, 25), contrast: pairs, siblingOnExpand: sib, errors: errs.slice(0, 5) }, null, 1));
await browser.close();
