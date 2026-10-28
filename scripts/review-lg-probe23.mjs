#!/usr/bin/env node
/* review-lg-probe23.mjs —— 复核 clear 芯片真实对比度：芯片外壳 strip（纯背景）vs 文字像素 p99.5 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r4';
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 14000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 2000));

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lumOf = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2);
const sorted = (L) => L.slice().sort((a, b) => a - b);
const q = (S, p) => S[Math.min(S.length - 1, Math.max(0, Math.floor(p * (S.length - 1))))];

const info = async (sel) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = (e) => { const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; };
  const chain = [];
  for (let n = el; n && n !== document.body; n = n.parentElement) { const cs = getComputedStyle(n); chain.push({ cls: String(n.className).slice(0, 30), id: n.id || null, rect: r(n), bg: cs.backgroundColor, bd: cs.backdropFilter === 'none' ? 'none' : cs.backdropFilter, color: cs.color }); }
  return { sel, chain };
}, sel);

const shot = async (clip) => {
  const buf = await page.screenshot({ clip });
  const { data, info: im } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = [];
  for (let i = 0; i < data.length; i += im.channels) px.push([data[i], data[i + 1], data[i + 2], lumOf(data[i], data[i + 1], data[i + 2])]);
  return px;
};

const scenes = [
  { name: 'dark-福州', lon: 119.2965, lat: 26.0745, h: 8000 },
  { name: 'bright-盐湖', lon: 99.0833, lat: 36.6833, h: 12000 },
];
const out = { probe: 'review-lg-probe23', scenes: {} };
for (const s of scenes) {
  await page.evaluate((s) => { const v = window.__gevViewer, C = window.__CESIUM__ || window.Cesium; if (v && C) v.camera.setView({ destination: C.Cartesian3.fromDegrees(s.lon, s.lat, s.h) }); }, s);
  await new Promise((r) => setTimeout(r, 7000));
  const rows = [];
  for (const sel of ['.gev-locate-text', '#gev-perf-fps', '.gev-zh-on', '#gev-perf-btn']) {
    const inf = await info(sel);
    if (!inf) { rows.push({ sel, missing: true }); continue; }
    /* 芯片外壳 = 链上第一个带背景色或 class 含 locate-btn/zh-toggle 的祖先 */
    let shell = inf.chain.find((c) => c.bg && !/rgba\(0, 0, 0, 0\)/.test(c.bg)) || inf.chain.find((c) => /btn|chip|toggle|indicator/i.test(String(c.cls) + c.id)) || inf.chain[1];
    const t = inf.chain[0];
    const textPx = await shot({ x: t.rect.x, y: t.rect.y, width: Math.max(2, t.rect.w), height: Math.max(2, t.rect.h) });
    const fg = q(sorted(textPx.map((p) => p[3])), 0.995);
    /* 外壳 strip：外壳内顶部 3px（无笔画） */
    const strip = { x: shell.rect.x + 6, y: shell.rect.y + 3, width: Math.max(4, shell.rect.w - 12), height: 3 };
    const bgPx = await shot(strip);
    const bg = q(sorted(bgPx.map((p) => p[3])), 0.5);
    const bgRGB = bgPx[Math.floor(bgPx.length / 2)].slice(0, 3);
    rows.push({ sel, shellCls: shell.cls, shellBg: shell.bg, bd: shell.bd, textRect: t.rect, shellRect: shell.rect, textColor: t.color, fg: +fg.toFixed(3), bg: +bg.toFixed(3), bgRGB, contrast: ratio(fg, bg) });
  }
  out.scenes[s.name] = rows;
  await page.screenshot({ path: path.join(OUT, 'p23-' + s.name + '-top.png'), clip: { x: 820, y: 25, width: 620, height: 120 } });
}
out.errors = errs;
fs.writeFileSync(path.join(OUT, 'p23.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
