#!/usr/bin/env node
/* qa-lg-chip-capsule.mjs —— 第五轮：clear 芯片（定位/中·EN）标签胶囊整改证据
 *  输出：三场景全屏 + 芯片区 4x 放大（整改后），以及沙漠场景「整改前」对照（CDP 注入还原样式）
 *  目录：evidence/lg-glass-shots/p0/final/r5/
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = path.resolve('evidence/lg-glass-shots/p0/final/r5');
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 14000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 2500));

const CHIP_CLIP = { x: 880, y: 20, width: 400, height: 56 };

const shotFull = async (tag) => {
  const buf = await page.screenshot();
  fs.writeFileSync(path.join(OUT, tag + '.png'), buf);
  return buf;
};
const shotChips = async (tag, zoom = 4) => {
  const buf = await page.screenshot({ clip: CHIP_CLIP });
  fs.writeFileSync(path.join(OUT, tag + '-x4.png'), buf);
  const meta = await sharp(buf).metadata();
  await sharp(buf).resize({ width: meta.width * zoom, kernel: 'nearest' }).png().toFile(path.join(OUT, tag + '-x' + (zoom * 2) + '.png'));
};

const scenes = [
  { name: 'dark-福州', lon: 119.2965, lat: 26.0745, h: 8000 },
  { name: 'bright-盐湖', lon: 99.0833, lat: 36.6833, h: 12000 },
  { name: 'bright-沙漠', lon: 82.9, lat: 39.0, h: 15000 },
];

const rows = [];
for (const s of scenes) {
  await page.evaluate((s) => {
    const v = window.__gevViewer;
    const C = window.__CESIUM__ || window.Cesium;
    if (v && C) v.camera.setView({ destination: C.Cartesian3.fromDegrees(s.lon, s.lat, s.h) });
  }, s);
  await new Promise((r) => setTimeout(r, 7000));
  await shotFull('chips-' + s.name + '-full');
  await shotChips('chips-' + s.name);
  const info = await page.evaluate(() => {
    const g = (id) => { const e = document.getElementById(id); if (!e) return null; const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: +b.left.toFixed(1), y: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), bg: cs.backgroundColor, border: cs.borderTopColor, bw: cs.borderTopWidth, color: cs.color, backdrop: cs.backdropFilter }; };
    return { locate: g('gev-locate-btn'), lang: g('gev-lang-toggle'), perf: g('gev-perf-fps'), glass: window.__gevGlStats ? window.__gevGlStats() : null };
  });
  rows.push({ scene: s.name, ...info });
}

/* 整改前对照（沙漠场景）：注入还原样式（透明 + 原 accent 青） */
await page.evaluate(() => {
  const st = document.createElement('style');
  st.id = 'qa-revert-chip';
  st.textContent = `html.gev-gl-on #gev-locate-btn,html.gev-gl-on #gev-lang-toggle{background:transparent!important;border:0!important;color:#00d4ff!important;}
  html.gev-gl-on #gev-locate-btn *,html.gev-gl-on #gev-lang-toggle span{color:#00d4ff!important;}
  html.gev-gl-on #gev-lang-toggle .gev-zh-on{color:#ffffff!important;}`;
  document.head.appendChild(st);
});
await new Promise((r) => setTimeout(r, 1200));
await shotChips('chips-bright-沙漠-BEFORE');
await page.evaluate(() => { const st = document.getElementById('qa-revert-chip'); if (st) st.remove(); });
await new Promise((r) => setTimeout(r, 800));
await shotChips('chips-bright-沙漠-AFTER');

const out = { probe: 'qa-lg-chip-capsule', url, rows, errors: errs };
fs.writeFileSync(path.join(OUT, 'chip-capsule.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
