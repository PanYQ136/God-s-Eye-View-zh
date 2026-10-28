#!/usr/bin/env node
/**
 * review-lg-probe34.mjs —— 第六轮复核 · Contract lens（reviewer 专用、只读）
 *  A) 结构合同：9 卡 / 玻璃面数 / scale=dpr / 一圈边（box-shadow 仅 1 条 inset 或 1 条 border）/ 无内层 backdrop / 无黑字 / 无滚动条
 *  B) 真实指针（CDP Input，非 .click()）展开：data-panel 高度↑、兄弟卡 display:block 且 h≈41（不是 display:none）、
 *     展开期间逐帧采样（透镜带 uAnim 由 bezel 变化表达 → 用 Surface 读数 bezel 前后对比）
 *  C) 快速开合 10 次：卡壳矩形 0 跳位
 *  D) 帧率：静止（玻璃开/关）、展开动画期间 —— rAF 采样 p50/p95
 *  E) clear 35% dim：fab 整卡内部均值（玻璃开/关），亮底 盐湖 + 暗底 福州
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r6rev';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CARD_IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'gev-gfx-fab', 'control-panel', 'gev-voice-control'];
const out = { probe: 'review-lg-probe34', errors: [] };

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => out.errors.push('pageerror: ' + String(e.message).slice(0, 150)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text().slice(0, 150)); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await sleep(14000);
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (b) b.click(); });
await sleep(2600);

/* ---------- A) 结构 ---------- */
out.struct = await page.evaluate((CARD_IDS) => {
  const cards = CARD_IDS.map((id) => {
    const root = document.getElementById(id); if (!root) return { id, missing: true };
    const shell = root.closest('.gev-lc') || root;
    const cs = getComputedStyle(shell);
    const inner = shell.querySelector('.panel-inner');
    const scrollers = [...shell.querySelectorAll('*')].filter((e) => {
      const s = getComputedStyle(e);
      const scrollable = e.scrollHeight > e.clientHeight + 2 || e.scrollWidth > e.clientWidth + 2;
      return scrollable && (s.overflowY !== 'visible' || s.overflowX !== 'visible') && !e.matches('input,textarea');
    }).length;
    const black = [...shell.querySelectorAll('*')].filter((e) => {
      const c = getComputedStyle(e).color; const m = c.match(/rgba?\((\d+), (\d+), (\d+)/);
      return m && +m[1] < 40 && +m[2] < 40 && +m[3] < 40;
    }).length;
    return { id, isGevLc: !!root.closest('.gev-lc'), bg: cs.backgroundColor, backdrop: cs.backdropFilter, border: cs.borderTopWidth + ' ' + cs.borderTopColor, shadow: cs.boxShadow, innerBg: inner ? getComputedStyle(inner).backgroundColor : null, innerBackdrop: inner ? getComputedStyle(inner).backdropFilter : null, scrollers, black };
  });
  const st = window.__gevGlStats();
  const cv = document.getElementById('gev-gl-glass');
  return {
    cards, surfaces: st.surfaces.length, surfaceIds: st.surfaces.map((s) => s.id + ':' + s.variant + ':u' + s.interior + ':b' + s.bezel),
    scale: st.scale, canvas: [cv.width, cv.height], dpr: st.dpr,
    cfg: st.config
  };
}, CARD_IDS);

/* ---------- B) 真实指针展开 ---------- */
const headRect = await page.evaluate(() => {
  const p = document.getElementById('data-panel');
  const shell = p.closest('.gev-lc') || p;
  const h = shell.querySelector('header, .panel-header, .gev-lc-head') || shell;
  const b = h.getBoundingClientRect();
  return { x: b.left + 24, y: b.top + b.height / 2, w: b.width, h: b.height };
});
const beforeRect = await page.evaluate(() => {
  const g = (id) => { const e = document.getElementById(id); const s = e.closest('.gev-lc') || e; const b = s.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const sp = document.getElementById('scene-panel'); const ss = sp.closest('.gev-lc') || sp;
  return { data: g('data-panel'), scene: g('scene-panel'), sceneDisplay: getComputedStyle(ss).display, sceneCollapsed: ss.getAttribute('data-collapsed') };
});
const bezelBefore = await page.evaluate(() => { const s = window.__gevGlStats().surfaces.find((x) => x.id === 'data-panel'); return s ? s.bezel : null; });

await page.mouse.move(headRect.x, headRect.y);
await page.mouse.down();
await sleep(60);
await page.mouse.up();
const timeline = [];
for (let i = 0; i < 10; i++) {
  await sleep(45);
  timeline.push(await page.evaluate(() => {
    const g = (id) => { const e = document.getElementById(id); const s = e.closest('.gev-lc') || e; const b = s.getBoundingClientRect(); return Math.round(b.height); };
    return { t: Math.round(performance.now()), dataH: g('data-panel'), sceneH: g('scene-panel') };
  }));
}
await sleep(900);
const afterRect = await page.evaluate(() => {
  const g = (id) => { const e = document.getElementById(id); const s = e.closest('.gev-lc') || e; const b = s.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const sp = document.getElementById('scene-panel'); const ss = sp.closest('.gev-lc') || sp;
  return { data: g('data-panel'), scene: g('scene-panel'), sceneDisplay: getComputedStyle(ss).display, sceneCollapsed: ss.getAttribute('data-collapsed'), sceneOpacity: getComputedStyle(ss).opacity };
});
const bezelAfter = await page.evaluate(() => { const s = window.__gevGlStats().surfaces.find((x) => x.id === 'data-panel'); return s ? s.bezel : null; });
out.expand = { headRect, beforeRect, afterRect, bezelBefore, bezelAfter, timeline };
await page.screenshot({ path: path.join(OUT, 'p34-expanded.png') });

/* ---------- C) 快速开合 10 次 ---------- */
const jumps = [];
for (let i = 0; i < 10; i++) {
  const r0 = await page.evaluate(() => { const e = document.getElementById('data-panel'); const s = e.closest('.gev-lc') || e; const b = s.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y) }; });
  await page.mouse.click(headRect.x, headRect.y);
  await sleep(430);
  const r1 = await page.evaluate(() => { const e = document.getElementById('data-panel'); const s = e.closest('.gev-lc') || e; const b = s.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y) }; });
  if (r0.x !== r1.x || r0.y !== r1.y) jumps.push({ i, r0, r1 });
}
await sleep(600);
out.rapidToggleJumps = jumps;

/* ---------- D) 帧率 ---------- */
const fpsSample = async (ms) => page.evaluate(async (ms) => {
  const arr = []; let last = performance.now(); const t0 = last;
  await new Promise((res) => { const f = (t) => { arr.push(t - last); last = t; if (t - t0 < ms) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  const s = arr.slice(2).sort((a, b) => a - b);
  return { n: s.length, p50: +s[Math.floor(s.length * 0.5)].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), max: +s[s.length - 1].toFixed(1), fps: Math.round(1000 / s[Math.floor(s.length * 0.5)]) };
}, ms);
out.fpsIdleOn = await fpsSample(2200);
// 展开动画期间采样：先按一次展开，同时采样
const animFps = await page.evaluate(async () => {
  const h = (() => { const p = document.getElementById('data-panel'); const s = p.closest('.gev-lc') || p; const hh = s.querySelector('header, .panel-header, .gev-lc-head') || s; const b = hh.getBoundingClientRect(); return { x: b.left + 24, y: b.top + b.height / 2 }; })();
  const arr = []; let last = performance.now(); const t0 = last; let fired = false;
  await new Promise((res) => { const f = (t) => { arr.push(t - last); last = t;
      if (!fired && t - t0 > 120) { fired = true; window.dispatchEvent(new Event('noop')); }
      if (t - t0 < 2200) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  const s = arr.slice(2).sort((a, b) => a - b);
  return { n: s.length, p50: +s[Math.floor(s.length * 0.5)].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), max: +s[s.length - 1].toFixed(1), fps: Math.round(1000 / s[Math.floor(s.length * 0.5)]) };
});
// 真实展开动画 + 同时采样
const animPromise = page.evaluate(async () => {
  const arr = []; let last = performance.now(); const t0 = last;
  await new Promise((res) => { const f = (t) => { arr.push(t - last); last = t; if (t - t0 < 900) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  const s = arr.slice(2).sort((a, b) => a - b);
  return { n: s.length, p50: +s[Math.floor(s.length * 0.5)].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), max: +s[s.length - 1].toFixed(1), fps: Math.round(1000 / s[Math.floor(s.length * 0.5)]) };
});
await page.mouse.click(headRect.x, headRect.y);
out.fpsExpandAnim = await animPromise;
await sleep(700);
// 玻璃关
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = 'none'; });
await sleep(400);
out.fpsIdleOff = await fpsSample(2200);
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = ''; });
await sleep(400);

/* ---------- E) clear 35% dim（fab 整卡内部） ---------- */
const meanLum = async (rect) => {
  const buf = await page.screenshot({ clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h } });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  let s = 0, n = 0;
  for (let i = 0; i < data.length; i += info.channels) { s += 0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]); n++; }
  return +(s / n).toFixed(4);
};
const dimRes = {};
for (const sc of [{ name: 'bright-盐湖', lon: 99.0833, lat: 36.6833, h: 12000 }, { name: 'dark-福州', lon: 119.2965, lat: 26.0745, h: 8000 }]) {
  await page.evaluate((s) => { const v = window.__gevViewer, C = window.__CESIUM__ || window.Cesium; if (v && C) v.camera.setView({ destination: C.Cartesian3.fromDegrees(s.lon, s.lat, s.h) }); }, sc);
  await sleep(8000);
  const r = await page.evaluate(() => { const s = window.__gevGlStats().surfaces.find((x) => x.id === 'gev-gfx-fab'); return { rect: { x: Math.round(s.rect[0] + 6), y: Math.round(s.rect[1] + 6), w: Math.round(s.rect[2] - 12), h: Math.round(s.rect[3] - 12) }, lum: s.lum, dim: s.dim, variant: s.variant }; });
  const on = await meanLum(r.rect);
  await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = 'none'; });
  await sleep(400);
  const off = await meanLum(r.rect);
  await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = ''; });
  await sleep(300);
  dimRes[sc.name] = { surfaceLum: r.lum, dimUniform: r.dim, glassOn: on, glassOff: off, dimPct: off > 0.01 ? +(((off - on) / off) * 100).toFixed(1) : null };
}
out.clearDim = dimRes;

fs.writeFileSync(path.join(OUT, 'probe34-struct.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({
  struct: { surfaces: out.struct.surfaces, scale: out.struct.scale, canvas: out.struct.canvas, dpr: out.struct.dpr,
    cardCount: out.struct.cards.length, innerBackdrop: out.struct.cards.filter((c) => c.innerBackdrop && c.innerBackdrop !== 'none').map((c) => c.id),
    scrollers: out.struct.cards.filter((c) => c.scrollers).map((c) => c.id + ':' + c.scrollers),
    black: out.struct.cards.filter((c) => c.black).map((c) => c.id + ':' + c.black),
    backdrops: out.struct.cards.filter((c) => c.backdrop && c.backdrop !== 'none').map((c) => c.id), surfaceIds: out.struct.surfaceIds },
  expand: { before: out.expand.beforeRect, after: out.expand.afterRect, bezel: [out.expand.bezelBefore, out.expand.bezelAfter] },
  jumps: out.rapidToggleJumps,
  fps: { idleOn: out.fpsIdleOn, expandAnim: out.fpsExpandAnim, idleOff: out.fpsIdleOff },
  clearDim: out.clearDim, errors: out.errors.slice(0, 6)
}, null, 1));
await browser.close();
