#!/usr/bin/env node
/* qa-lg-r5-reduced.mjs —— 第五轮回归：prefers-reduced-transparency:reduce 下（含新胶囊芯片）实色回退截图 + 关键计算样式
 */
import puppeteer from 'puppeteer';
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
await new Promise((r) => setTimeout(r, 13000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 2500));
/* 盐湖亮底更有说服力 */
await page.evaluate(() => { const v = window.__gevViewer; const C = window.__CESIUM__ || window.Cesium; if (v && C) v.camera.setView({ destination: C.Cartesian3.fromDegrees(99.0833, 36.6833, 12000) }); });
await new Promise((r) => setTimeout(r, 7000));

const cdp = await page.target().createCDPSession();
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
await new Promise((r) => setTimeout(r, 1800));
const out = { probe: 'qa-lg-r5-reduced', matches: null, cards: [], chips: [], glassCanvas: null, errors: errs };
out.matches = await page.evaluate(() => matchMedia('(prefers-reduced-transparency: reduce)').matches);
out.glassCanvas = await page.evaluate(() => { const g = document.getElementById('gev-gl-glass'); return g ? getComputedStyle(g).display : null; });
out.cards = await page.evaluate(() => ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'gev-gfx-fab', 'control-panel', 'gev-voice-control'].map((id) => {
  const e = document.getElementById(id); if (!e) return { id, missing: true };
  const cs = getComputedStyle(e);
  return { id, bg: cs.backgroundColor, backdrop: cs.backdropFilter, ring: cs.boxShadow, solid: cs.backgroundColor.includes('rgb(') && !/rgba\([^)]*,\s*0?\.\d+\)/.test(cs.backgroundColor) };
}));
out.chips = await page.evaluate(() => ['gev-locate-btn', 'gev-perf-wrap', 'gev-lang-toggle', 'gev-perf-fps'].map((id) => {
  const e = document.getElementById(id); if (!e) return { id, missing: true };
  const cs = getComputedStyle(e);
  return { id, bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor + ' ' + cs.borderTopWidth, backdrop: cs.backdropFilter };
}));
await page.screenshot({ clip: { x: 860, y: 18, width: 430, height: 60 } }).then((b) => fs.writeFileSync(path.join(OUT, 'reduced-chips-x2.png'), b));
await page.screenshot({ clip: { x: 0, y: 90, width: 400, height: 620 } }).then((b) => fs.writeFileSync(path.join(OUT, 'reduced-left-cards.png'), b));
await page.screenshot().then((b) => fs.writeFileSync(path.join(OUT, 'reduced-full.png'), b));
fs.writeFileSync(path.join(OUT, 'reduced.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
