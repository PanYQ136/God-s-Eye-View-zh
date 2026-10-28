#!/usr/bin/env node
/* review-lg-probe25.mjs —— 第四轮复核最终：clear 芯片标签（定位/中/EN）在三场景的对比度（bg=芯片内 strip/环带中位数，fg=文字像素 p99.5） */
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
await new Promise((r) => setTimeout(r, 13000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 2000));

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lumOf = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2);
const sorted = (L) => L.slice().sort((a, b) => a - b);
const q = (S, p) => S[Math.min(S.length - 1, Math.max(0, Math.floor(p * (S.length - 1))))];
const lum = async (clip) => {
  const buf = await page.screenshot({ clip });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = [];
  for (let i = 0; i < data.length; i += info.channels) L.push(lumOf(data[i], data[i + 1], data[i + 2]));
  return L;
};

const SEL = [
  ['定位', '.gev-locate-text', '#gev-locate-btn'],
  ['中', '.gev-zh-on', '#gev-lang-toggle'],
  ['EN', '#gev-lang-toggle span:nth-child(3)', '#gev-lang-toggle'],
];
const scenes = [
  { name: 'dark-福州', lon: 119.2965, lat: 26.0745, h: 8000 },
  { name: 'bright-盐湖', lon: 99.0833, lat: 36.6833, h: 12000 },
  { name: 'bright-沙漠', lon: 82.9, lat: 39.0, h: 15000 },
];
const out = { probe: 'review-lg-probe25', scenes: {} };
for (const s of scenes) {
  await page.evaluate((s) => { const v = window.__gevViewer, C = window.__CESIUM__ || window.Cesium; if (v && C) v.camera.setView({ destination: C.Cartesian3.fromDegrees(s.lon, s.lat, s.h) }); }, s);
  await new Promise((r) => setTimeout(r, 7000));
  const rows = [];
  for (const [label, textSel, chipSel] of SEL) {
    const t = await page.evaluate((textSel) => { const e = document.querySelector(textSel); if (!e || !e.offsetParent) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, color: getComputedStyle(e).color }; }, textSel);
    const c = await page.evaluate((chipSel) => { const e = document.querySelector(chipSel); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, bg: getComputedStyle(e).backgroundColor }; }, chipSel);
    if (!t || !c) { rows.push({ label, missing: true }); continue; }
    const tL = await lum({ x: t.x, y: t.y, width: Math.max(2, t.w), height: Math.max(2, t.h) });
    const fg = q(sorted(tL), 0.995);
    /* 芯片内两侧留白（左右内边距），避开文字与顶部 rim */
    const padL = await lum({ x: c.x + 2, y: c.y + c.h * 0.45, width: Math.max(2, (t.x - c.x) - 4), height: Math.max(2, c.h * 0.35) });
    const bg = q(sorted(padL), 0.5);
    rows.push({ label, textColor: t.color, chipBg: c.bg, fg: +fg.toFixed(3), bg: +bg.toFixed(3), contrast: ratio(fg, bg) });
  }
  out.scenes[s.name] = rows;
}
out.errors = errs;
fs.writeFileSync(path.join(OUT, 'p25.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
