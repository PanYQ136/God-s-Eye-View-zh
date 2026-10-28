#!/usr/bin/env node
/**
 * review-lg-probe18.mjs —— 第三轮复核 · 合同审计（多场景暗底对比 / 帧率 / 减少透明度回退 / 快速开合）
 * reviewer 专用、只读。
 *   1) 暗底多场景（4 个相机位置）测语音卡两个小标签的**局部环带**对比度（pad 2 与 5）。
 *   2) 静止 / 展开动画帧时分布（rAF 采样，p50/p95，fps=1000/p50）。
 *   3) prefers-reduced-transparency: reduce 回退（玻璃 canvas 隐藏 + 卡壳实色 #0b1118）。
 *   4) 快速开合 10 次：卡壳矩形跳位检查。
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r3';
fs.mkdirSync(OUT, { recursive: true });
const out = { probe: 'review-lg-probe18', url, errors: [] };

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => out.errors.push('pageerror: ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text().slice(0, 160)); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 14000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => {
  const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent);
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 2500));

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lumOf = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2);
const q = (S, p) => S[Math.min(S.length - 1, Math.max(0, Math.floor(p * (S.length - 1))))];
const sorted = (L) => L.slice().sort((a, b) => a - b);

const ringContrast = async (rect, pad) => {
  const clip = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), width: rect.w + pad * 2, height: rect.h + pad * 2 };
  if (clip.x + clip.width > 1536) clip.width = 1536 - clip.x;
  if (clip.y + clip.height > 730) clip.height = 730 - clip.y;
  const buf = await page.screenshot({ clip });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const sx = info.width / clip.width, sy = info.height / clip.height;
  const ring = [], core = [];
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * info.channels;
    const L = lumOf(data[i], data[i + 1], data[i + 2]);
    const inCore = x >= pad * sx && x < (pad + rect.w) * sx && y >= pad * sy && y < (pad + rect.h) * sy;
    if (inCore) core.push(L); else ring.push(L);
  }
  const Sr = sorted(ring), Sc = sorted(core);
  if (!Sc.length || !Sr.length) return null;
  const bg = q(Sr, 0.5), fg = q(Sc, 0.995);
  return { bg: +bg.toFixed(3), fg: +fg.toFixed(3), contrast: ratio(fg, bg) };
};

/* ---------- 1) 多场景暗底 ---------- */
const labels = await page.evaluate(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none') return 0; o *= parseFloat(cs.opacity || '1'); if (o < 0.02) return 0; } return o; };
  const v = document.getElementById('gev-voice-control');
  return [...v.querySelectorAll('*')].filter((e) => !e.children.length && (e.textContent || '').trim() && e.offsetParent && eff(e) > 0.15 && e.getBoundingClientRect().width > 4).map((e) => ({ text: (e.textContent || '').trim().slice(0, 10), rect: r(e), color: getComputedStyle(e).color }));
});
const positions = [
  { name: 'P1 福州城区', lon: 119.2965, lat: 26.0745, h: 8000 },
  { name: 'P2 青海盐湖（亮地形）', lon: 99.0833, lat: 36.6833, h: 12000 },
  { name: 'P3 夜间海面（深色）', lon: 122.5, lat: 25.0, h: 20000 },
  { name: 'P4 沙漠（高反照）', lon: 82.9, lat: 39.0, h: 15000 },
];
out.scenes = [];
for (const p of positions) {
  const moved = await page.evaluate((p) => {
    const v = window.__gevViewer; const C = window.__CESIUM__ || window.Cesium;
    if (!v || !C) return { ok: false, why: 'no viewer/cesium' };
    try { v.camera.setView({ destination: C.Cartesian3.fromDegrees(p.lon, p.lat, p.h) }); return { ok: true }; } catch (e) { return { ok: false, why: String(e.message) }; }
  }, p);
  await new Promise((r) => setTimeout(r, 6000));
  const rec = { pos: p.name, moved, rows: [] };
  for (const l of labels) {
    const c2 = await ringContrast(l.rect, 2), c5 = await ringContrast(l.rect, 5);
    rec.rows.push({ text: l.text, color: l.color, pad2: c2, pad5: c5 });
  }
  rec.cardLum = await page.evaluate(() => { const s = document.getElementById('gev-voice-control').closest('.gev-lc'); return s.getAttribute('data-gev-lum'); });
  out.scenes.push(rec);
}

/* 回到第一个场景做帧率 */
await page.evaluate(() => { const v = window.__gevViewer; const C = window.__CESIUM__ || window.Cesium; if (v && C) v.camera.setView({ destination: C.Cartesian3.fromDegrees(119.2965, 26.0745, 8000) }); });
await new Promise((r) => setTimeout(r, 5000));

/* ---------- 2) 帧率 ---------- */
const frameStats = async (ms) => page.evaluate((ms) => new Promise((res) => {
  const t = []; let last = 0; const t0 = performance.now();
  function f(ts) { if (last) t.push(ts - last); last = ts; if (performance.now() - t0 < ms) requestAnimationFrame(f); else { const s = t.slice().sort((a, b) => a - b); res({ n: t.length, p50: +s[Math.floor(s.length / 2)].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2), max: +s[s.length - 1].toFixed(2), fpsP50: Math.round(1000 / s[Math.floor(s.length / 2)]) }); } }
  requestAnimationFrame(f);
}), ms);
out.perf = {};
out.perf.idle = await frameStats(2500);
/* 展开动画：点开数据卡，同时采样 */
const animPromise = frameStats(1400);
await page.evaluate(() => { const b = document.querySelector('#data-panel .panel-header, #data-panel .data-toggle-btn'); if (b) b.click(); });
out.perf.expand = await animPromise;
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => { const b = document.querySelector('#data-panel .panel-header, #data-panel .data-toggle-btn'); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 700));
out.perf.glassStats = await page.evaluate(() => (window.__gevGlStats ? { fps: window.__gevGlStats().fps, scale: window.__gevGlStats().scale, quads: window.__gevGlStats().quads } : null));

/* ---------- 3) 快速开合 10 次 ---------- */
out.rapid = await page.evaluate(async () => {
  const btn = () => document.querySelector('#data-panel .panel-header, #data-panel .data-toggle-btn');
  const shell = () => document.querySelector('#data-panel').closest('.gev-lc') || document.getElementById('data-panel');
  const seen = [];
  for (let i = 0; i < 10; i++) {
    btn()?.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const b = shell().getBoundingClientRect();
    seen.push([Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]);
    await new Promise((r) => setTimeout(r, 120));
  }
  const jumps = [];
  for (let i = 1; i < seen.length; i++) {
    const d = Math.abs(seen[i][0] - seen[i - 1][0]) + Math.abs(seen[i][1] - seen[i - 1][1]);
    if (d > 4) jumps.push([i, seen[i - 1], seen[i], d]);
  }
  return { samples: seen, jumps, consoleErrors: 0 };
});

/* ---------- 4) reduced-transparency 回退 ---------- */
await page.evaluate(() => { const b = document.querySelector('#data-panel .panel-header, #data-panel .data-toggle-btn'); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 500));
const cdp = await page.createCDPSession();
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
await new Promise((r) => setTimeout(r, 900));
out.reducedTransparency = await page.evaluate(() => {
  const glc = document.getElementById('gev-gl-glass');
  const shell = document.getElementById('data-panel').closest('.gev-lc');
  const cs = getComputedStyle(shell);
  return { glassDisplay: glc ? getComputedStyle(glc).display : 'missing', shellBg: cs.backgroundColor, shellBackdrop: cs.backdropFilter, shellShadow: cs.boxShadow, matches: matchMedia('(prefers-reduced-transparency: reduce)').matches };
});
await page.screenshot({ path: path.join(OUT, 'p18-reduced-transparency.png') });
await cdp.send('Emulation.setEmulatedMedia', { features: [] });

fs.writeFileSync(path.join(OUT, 'p18.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({
  scenes: out.scenes.map((s) => ({ pos: s.pos, cardLum: s.cardLum, rows: s.rows.map((r) => [r.text, r.pad2 && r.pad2.contrast, r.pad5 && r.pad5.contrast, r.pad5 && r.pad5.bg]) })),
  perf: out.perf, rapid: { jumps: out.rapid.jumps.length, samples: out.rapid.samples.slice(0, 4) }, reducedTransparency: out.reducedTransparency, errors: out.errors.slice(0, 5),
}, null, 1));
await browser.close();
