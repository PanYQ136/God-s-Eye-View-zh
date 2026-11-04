#!/usr/bin/env node
/**
 * qa-lg-p0.mjs —— Apple Liquid Glass P0 验收探针（全卡玻璃版）
 * 用法: node scripts/qa-lg-p0.mjs <url> <outDir> <label>
 * 产出: <outDir>/<label>.png + <label>.json + <label>.txt
 */
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const url = process.argv[2] || 'http://localhost:5183/';
const outDir = process.argv[3] || 'evidence/lg-glass-shots/p0';
const label = process.argv[4] || 'probe';
fs.mkdirSync(outDir, { recursive: true });

const W = Number(process.env.QW || 1536);
const H = Number(process.env.QH || 730);

const browser = await puppeteer.launch({
  headless: true,
  executablePath: process.env.QCHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', `--window-size=${W},${H}`],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: Number(process.env.QD || 1) });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.stack || e.message)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('requestfailed', (r) => { const u = r.url(); if (/^http:\/\/localhost/.test(u)) errors.push('reqfail: ' + u); });

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel'), { timeout: 120000 });
// 首次启动弹窗：ESC 关闭
await new Promise((r) => setTimeout(r, 9000));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 1500));
// 若 welcome 仍存在，点“不再显示”后关闭
await page.evaluate(() => {
  const w = document.getElementById('welcome-modal') || document.querySelector('.welcome-modal');
  if (w) { const c = w.querySelector('input[type=checkbox]'); if (c) c.click(); const b = w.querySelector('button'); if (b) b.click(); }
});
await new Promise((r) => setTimeout(r, 1500));
// 预热玻璃层（等 Cesium 可读 / pdb reload）
for (let i = 0; i < 20; i++) {
  const ok = await page.evaluate(() => !!(window.__gevGlStats && window.__gevGlStats().count >= 1));
  if (ok) break;
  await new Promise((r) => setTimeout(r, 1500));
}
await new Promise((r) => setTimeout(r, 3000));

const out = await page.evaluate(() => {
  const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
    'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
  const cards = IDS.map((id) => {
    const el = document.getElementById(id);
    if (!el) return { id, present: false };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const inner = el.querySelector('[class$="-inner"], .pp-panel-body');
    const ics = inner ? getComputedStyle(inner) : null;
    return {
      id, present: true, lc: el.classList.contains('gev-lc'),
      collapsed: el.classList.contains('collapsed'), floating: el.classList.contains('gev-lc-floating'),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      display: cs.display, opacity: cs.opacity,
      border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
      outline: cs.outlineWidth,
      boxShadow: cs.boxShadow,
      background: cs.backgroundColor + ' | ' + cs.backgroundImage.slice(0, 60),
      backdrop: cs.backdropFilter || cs.webkitBackdropFilter,
      radius: cs.borderRadius,
      scrollbars: { sw: el.scrollWidth - el.clientWidth, sh: el.scrollHeight - el.clientHeight, ox: cs.overflowX, oy: cs.overflowY },
      innerBg: ics ? ics.backgroundColor : null,
      innerShadow: ics ? ics.boxShadow : null,
      innerBackdrop: ics ? (ics.backdropFilter || ics.webkitBackdropFilter) : null,
      cssVarMarks: (el.className || '').toString(),
    };
  });
  const glassCv = document.getElementById('gev-gl-glass');
  const stats = window.__gevGlStats ? window.__gevGlStats() : null;
  const glStats = {
    present: !!glassCv,
    size: glassCv ? [glassCv.width, glassCv.height] : null,
    zIndex: glassCv ? getComputedStyle(glassCv).zIndex : null,
    on: document.documentElement.classList.contains('gev-gl-on'),
    lum: document.documentElement.dataset.gevGlassLum || null,
  };
  // 页面级滚动条
  const sb = { docScrollW: document.documentElement.scrollWidth, winW: innerWidth };
  // 黑字检测（玻璃卡内文字）
  const blackText = [];
  IDS.forEach((id) => {
    const root = document.getElementById(id); if (!root) return;
    root.querySelectorAll('*').forEach((e) => {
      if (!e.textContent || !e.textContent.trim() || e.children.length) return;
      const c = getComputedStyle(e).color;
      const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m && +m[1] < 40 && +m[2] < 40 && +m[3] < 40) blackText.push(id + ' ' + (e.id || e.className || e.tagName) + ' ' + c);
    });
  });
  return { cards, glass: glStats, stats, sb, blackText, dpr: devicePixelRatio, title: document.title };
});

const glPerf = await page.evaluate(async () => {
  const s0 = window.__gevGlStats ? window.__gevGlStats().frames : 0;
  const t0 = performance.now();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise((r) => setTimeout(r, 3000));
  const s1 = window.__gevGlStats ? window.__gevGlStats().frames : 0;
  const t1 = performance.now();
  return { frames: s1 - s0, ms: Math.round(t1 - t0), fps: s1 - s0 > 0 ? +(((s1 - s0) * 1000) / (t1 - t0)).toFixed(1) : 0, statsFps: window.__gevGlStats ? window.__gevGlStats().fps : 0 };
});

// 长任务/卡顿
const longTasks = await page.evaluate(() => new Promise((res) => {
  const list = [];
  try {
    const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => list.push(Math.round(e.duration))));
    po.observe({ entryTypes: ['longtask'] });
  } catch (e) { return res(['no-observer']); }
  setTimeout(() => res(list), 2500);
}));

await page.screenshot({ path: `${outDir}/${label}.png` });
const payload = { url, viewport: [W, H], errors, ...out, glPerf, longTasks, at: new Date().toISOString() };
fs.writeFileSync(`${outDir}/${label}.json`, JSON.stringify(payload, null, 2));

const lines = [];
lines.push(`# ${label} @ ${W}x${H}  ${new Date().toISOString()}`);
lines.push(`errors(${errors.length}): ${errors.slice(0, 8).join(' | ')}`);
lines.push(`glass: ${JSON.stringify(out.glass)}`);
lines.push(`glass fps: measured=${glPerf.fps} internal=${glPerf.statsFps} frames=${glPerf.frames}/${glPerf.ms}ms  longtasks=${JSON.stringify(longTasks.slice(0, 10))}`);
lines.push(`surfaces(${out.stats ? out.stats.count : '?'}/${out.stats ? out.stats.max : '?'}): ${out.stats ? out.stats.surfaces.map((s) => `${s.id}[${s.variant}] r=${s.radius} lum=${s.lum} fill=${s.fill} dim=${s.dim}`).join(' ; ') : 'NO STATS'}`);
out.cards.forEach((c) => {
  if (!c.present) return lines.push(`CARD ${c.id}: MISSING`);
  lines.push(`CARD ${c.id}: lc=${c.lc} collapsed=${c.collapsed} float=${c.floating} rect=${c.rect} border="${c.border}" shadow="${c.boxShadow}" bg="${c.background}" backdrop="${c.backdrop}" radius=${c.radius} scroll=${c.scrollbars.sw}/${c.scrollbars.sh} innerBg=${c.innerBg} innerShadow=${c.innerShadow} innerBd=${c.innerBackdrop}`);
});
lines.push(`blackText(${out.blackText.length}): ${out.blackText.slice(0, 10).join(' | ')}`);
lines.push(`pageScroll: docScrollW=${out.sb.docScrollW} winW=${out.sb.winW}`);
fs.writeFileSync(`${outDir}/${label}.txt`, lines.join('\n'));
console.log(lines.join('\n'));
await browser.close();
