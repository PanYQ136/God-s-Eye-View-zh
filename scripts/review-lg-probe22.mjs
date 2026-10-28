#!/usr/bin/env node
/* review-lg-probe22.mjs —— 第四轮复核：clear 芯片外壳（定位/中EN）真实对比度（bg=芯片内 p25，fg=芯片内 p99.5） */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r4';
fs.mkdirSync(OUT, { recursive: true });
const out = { probe: 'review-lg-probe22', errors: [] };
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

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lumOf = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2);
const sorted = (L) => L.slice().sort((a, b) => a - b);
const q = (S, p) => S[Math.min(S.length - 1, Math.max(0, Math.floor(p * (S.length - 1))))];

const shellOf = async (text) => page.evaluate((text) => {
  const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none') return 0; o *= parseFloat(cs.opacity || '1'); } return o; };
  const cands = [...document.querySelectorAll('body *')].filter((e) => (e.textContent || '').trim() === text && e.offsetParent && eff(e) > 0.5);
  if (!cands.length) return null;
  const el = cands[0];
  const shell = el;
  const b = shell.getBoundingClientRect();
  const cs = getComputedStyle(shell);
  const anc = [];
  for (let n = el.parentElement; n && n !== document.body && anc.length < 4; n = n.parentElement) { const s = getComputedStyle(n); anc.push({ cls: String(n.className).slice(0, 26), bg: s.backgroundColor, bd: s.backdropFilter }); }
  return { text, textColor: getComputedStyle(el).color, shellCls: String(shell.className).slice(0, 46), shellId: shell.id || null, shellBg: cs.backgroundColor, shellBd: cs.backdropFilter, anc, rect: { x: Math.round(b.left) - 4, y: Math.round(b.top) - 4, w: Math.round(b.width) + 8, h: Math.round(b.height) + 8 } };
}, text);

const measure = async (info) => {
  if (!info) return null;
  const r = info.rect;
  const buf = await page.screenshot({ clip: { x: r.x, y: r.y, width: r.w, height: r.h } });
  const { data, info: im } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = [];
  for (let i = 0; i < data.length; i += im.channels) L.push(lumOf(data[i], data[i + 1], data[i + 2]));
  const S = sorted(L);
  const bg = q(S, 0.25), fg = q(S, 0.995), mid = q(S, 0.5);
  return { ...info, bgP25: +bg.toFixed(3), bgP50: +mid.toFixed(3), fgP995: +fg.toFixed(3), contrast: ratio(fg, bg) };
};

const scenes = [
  { name: '福州（暗底）', lon: 119.2965, lat: 26.0745, h: 8000 },
  { name: '盐湖（亮底）', lon: 99.0833, lat: 36.6833, h: 12000 },
];
out.res = {};
for (const s of scenes) {
  await page.evaluate((s) => {
    const v = window.__gevViewer, C = window.__CESIUM__ || window.Cesium;
    if (v && C) v.camera.setView({ destination: C.Cartesian3.fromDegrees(s.lon, s.lat, s.h) });
  }, s);
  await new Promise((r) => setTimeout(r, 7000));
  const row = {};
  for (const t of ['定位', '中', 'EN', 'FPS']) {
    const shell = await shellOf(t);
    row[t] = await measure(shell);
  }
  out.res[s.name] = row;
  await page.screenshot({ path: path.join(OUT, 'p22-top-' + (s.name.includes('亮') ? 'bright' : 'dark') + '.png'), clip: { x: 820, y: 25, width: 620, height: 120 } });
}
fs.writeFileSync(path.join(OUT, 'p22.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
