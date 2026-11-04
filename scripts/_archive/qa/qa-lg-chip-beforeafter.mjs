#!/usr/bin/env node
/* qa-lg-chip-beforeafter.mjs —— 同一场景、同一度量下的「整改前 / 整改后」芯片标签对比度
 *  前：注入还原样式（transparent + accent 青 #00d4ff + 中 #fff），即第四轮实测状态
 *  后：当前实现（深色胶囊 rgba(8,20,30,.72) + #8fe3ff / 白）
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = path.resolve('evidence/lg-glass-shots/p0/final/r5');
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 14000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 2500));

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
const measure = async () => {
  const rows = [];
  for (const [label, textSel, chipSel] of SEL) {
    const t = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, color: getComputedStyle(e).color }; }, textSel);
    const c = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, bg: getComputedStyle(e).backgroundColor, bd: getComputedStyle(e).borderTopColor }; }, chipSel);
    if (!t || !c) { rows.push({ label, missing: true }); continue; }
    const tL = await lum({ x: t.x, y: t.y, width: Math.max(2, t.w), height: Math.max(2, t.h) });
    const fg = q(sorted(tL), 0.995);
    const padL = await lum({ x: c.x + 2, y: c.y + c.h * 0.45, width: Math.max(2, (t.x - c.x) - 4), height: Math.max(2, c.h * 0.35) });
    const bg = q(sorted(padL), 0.5);
    rows.push({ label, color: t.color, chipBg: c.bg, chipBorder: c.bd, fg: +fg.toFixed(3), bg: +bg.toFixed(3), contrast: ratio(fg, bg) });
  }
  return rows;
};

const out = { probe: 'qa-lg-chip-beforeafter', scenes: {} };
const scenes = [
  { name: 'dark-福州', lon: 119.2965, lat: 26.0745, h: 8000 },
  { name: 'bright-盐湖', lon: 99.0833, lat: 36.6833, h: 12000 },
  { name: 'bright-沙漠', lon: 82.9, lat: 39.0, h: 15000 },
];
for (const s of scenes) {
  await page.evaluate((s) => { const v = window.__gevViewer; const C = window.__CESIUM__ || window.Cesium; if (v && C) v.camera.setView({ destination: C.Cartesian3.fromDegrees(s.lon, s.lat, s.h) }); }, s);
  await new Promise((r) => setTimeout(r, 6500));
  /* AFTER（当前实现） */
  out.scenes[s.name] = { after: await measure() };
  /* BEFORE（还原第四轮状态） */
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.id = 'qa-revert-chip';
    st.textContent = `html.gev-gl-on #gev-locate-btn,html.gev-gl-on #gev-lang-toggle{background:transparent!important;border:0!important;color:#00d4ff!important;}
    html.gev-gl-on #gev-locate-btn *,html.gev-gl-on #gev-lang-toggle span{color:#00d4ff!important;}
    html.gev-gl-on #gev-lang-toggle .gev-zh-on{color:#ffffff!important;}`;
    document.head.appendChild(st);
  });
  await new Promise((r) => setTimeout(r, 1200));
  out.scenes[s.name].before = await measure();
  await page.evaluate(() => { const st = document.getElementById('qa-revert-chip'); if (st) st.remove(); });
  await new Promise((r) => setTimeout(r, 900));
}
out.errors = errs;
fs.writeFileSync(path.join(OUT, 'chip-beforeafter.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
