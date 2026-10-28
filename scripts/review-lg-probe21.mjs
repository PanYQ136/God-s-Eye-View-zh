#!/usr/bin/env node
/* review-lg-probe21.mjs —— 第四轮复核：clear 变体芯片（定位/FPS/性能/中EN）在亮地形上的 dim 与文字对比度 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r4';
fs.mkdirSync(OUT, { recursive: true });
const out = { probe: 'review-lg-probe21', errors: [] };
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => out.errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push(m.text().slice(0, 160)); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 14000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 2000));

/* 飞到青海盐湖（亮地形） */
out.moved = await page.evaluate(() => {
  const v = window.__gevViewer, C = window.__CESIUM__ || window.Cesium;
  if (!v || !C) return { ok: false, why: 'no cesium' };
  try { v.camera.setView({ destination: C.Cartesian3.fromDegrees(99.0833, 36.6833, 12000) }); return { ok: true }; } catch (e) { return { ok: false, why: String(e.message) }; }
});
await new Promise((r) => setTimeout(r, 8000));

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lumOf = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2);
const sorted = (L) => L.slice().sort((a, b) => a - b);
const q = (S, p) => S[Math.min(S.length - 1, Math.max(0, Math.floor(p * (S.length - 1))))];

const grab = async (clip) => {
  const buf = await page.screenshot({ clip });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = new Float64Array(info.width * info.height);
  for (let i = 0, j = 0; i < data.length; i += info.channels, j++) L[j] = lumOf(data[i], data[i + 1], data[i + 2]);
  return { L, w: info.width, h: info.height };
};
const p50 = async (clip) => { const g = await grab(clip); return +q(sorted([...g.L]), 0.5).toFixed(3); };

/* 芯片清单（按文本找） */
const chips = await page.evaluate(() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const wanted = ['定位', 'FPS', '性能', '中', 'EN'];
  const res = [];
  const seen = new Set();
  for (const e of document.querySelectorAll('body *')) {
    const txt = (e.textContent || '').trim();
    if (!txt || txt.length > 12) continue;
    if (!wanted.some((w) => txt.includes(w))) continue;
    if (!e.offsetParent) continue;
    const b = e.getBoundingClientRect();
    if (b.top > 130 || b.width < 20 || b.height < 12) continue;
    const key = Math.round(b.left) + ':' + Math.round(b.top);
    if (seen.has(key)) continue;
    seen.add(key);
    const cs = getComputedStyle(e);
    res.push({ text: txt.slice(0, 12), tag: e.tagName, id: e.id || null, cls: String(e.className).slice(0, 40), rect: r(e), color: cs.color, bg: cs.backgroundColor, bd: cs.backdropFilter });
  }
  return res;
});
out.chips = chips;

const rows = [];
for (const c of chips) {
  if (c.rect.w < 24 || c.rect.h < 12) continue;
  const pad = 5;
  const clip = { x: Math.max(0, c.rect.x - pad), y: Math.max(0, c.rect.y - pad), width: c.rect.w + pad * 2, height: c.rect.h + pad * 2 };
  const g = await grab(clip);
  const sx = g.w / clip.width, sy = g.h / clip.height;
  const ring = [], core = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const inCore = x >= pad * sx && x < (pad + c.rect.w) * sx && y >= pad * sy && y < (pad + c.rect.h) * sy;
    (inCore ? core : ring).push(g.L[y * g.w + x]);
  }
  const bg = q(sorted(ring), 0.5), fg = q(sorted(core), 0.995), mid = q(sorted(core), 0.5);
  /* dim 估计：芯片内部 p50 vs 卡外相邻地图 p50（同一行左右各 40px） */
  const outsideL = await p50({ x: Math.max(0, c.rect.x - 60), y: c.rect.y, width: 40, height: c.rect.h });
  const outsideR = await p50({ x: Math.min(1500, c.rect.x + c.rect.w + 20), y: c.rect.y, width: 40, height: c.rect.h });
  rows.push({ text: c.text, id: c.id, color: c.color, chipBg: c.bg, bd: c.bd, ringBg: +bg.toFixed(3), coreP50: +mid.toFixed(3), fgP99: +fg.toFixed(3), contrast: ratio(fg, bg), outside: [outsideL, outsideR], dimEst: +(1 - mid / Math.max(0.02, (outsideL + outsideR) / 2)).toFixed(3) });
}
out.rows = rows;
await page.screenshot({ path: path.join(OUT, 'p21-saltlake-top.png'), clip: { x: 800, y: 20, width: 640, height: 140 } });
await page.screenshot({ path: path.join(OUT, 'p21-saltlake-full.png') });
fs.writeFileSync(path.join(OUT, 'p21.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ moved: out.moved, rows, errors: out.errors }, null, 1));
await browser.close();
