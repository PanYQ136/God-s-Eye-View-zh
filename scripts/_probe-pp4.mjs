#!/usr/bin/env node
/** _probe-pp4.mjs — 材质/布局探针：pp 展开后导出关键选择器的 paint 与几何 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('.gev-logs/final/ppdiag');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(6000);
await page.keyboard.press('Escape');
await sleep(500);
const settle = async () => { for (let i = 0; i < 60; i++) { const n = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length); if (!n) return; await sleep(40); } };
const hdr = await page.evaluate(() => { const r = document.querySelector('#pp-toggles .pp-header-row').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await page.mouse.click(hdr.x, hdr.y);
await settle(); await sleep(600);

const SELS = [
  '#pp-toggles', '.pp-header-row', '#hud-toggle', '#hud-toggle .pp-label',
  '#detection-toggle', '#detection-toggle .pp-label', '#detection-toggle .pp-icon',
  '#detection-slider-row', '#detection-slider-row .pp-slider-mini-label',
  '#detection-allocation-row', '.detection-allocation-seg',
  '#detection-allocation-elastic', '#detection-allocation-weighted',
  '#detection-fade-row', '#models3d-toggle', '#models3d-mode-proximity',
  '#scope-toggle', '#clean-view-toggle', '#bloom-toggle',
  '#detection-density-slider', '#detection-fade-slider',
];
const out = await page.evaluate((sels) => {
  const g = (el, p) => getComputedStyle(el)[p];
  const res = {};
  for (const s of sels) {
    const el = document.querySelector(s);
    if (!el) { res[s] = null; continue; }
    const r = el.getBoundingClientRect();
    res[s] = {
      rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      bg: g(el, 'backgroundColor'),
      bgi: (g(el, 'backgroundImage') || '').slice(0, 110),
      color: g(el, 'color'),
      shadow: (g(el, 'boxShadow') || '').slice(0, 120),
      blur: g(el, 'backdropFilter'),
      radius: g(el, 'borderRadius'),
      border: g(el, 'borderTopWidth') + ' ' + g(el, 'borderTopColor'),
      op: g(el, 'opacity'),
    };
  }
  // 可见 ✕
  const xs = [];
  for (const el of document.querySelectorAll('*')) {
    const t = (el.textContent || '').trim();
    if (!/[✕×✖✗]/.test(t) || el.children.length) continue;
    const r = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    if (r.width < 1 || r.height < 1 || c.visibility === 'hidden' || +c.opacity < 0.05) continue;
    xs.push({ sel: el.tagName + '.' + String(el.className).slice(0, 40), txt: t.slice(0, 3), rect: [r.x, r.y, r.width, r.height] });
  }
  // 卡内深色文字（luma < .45）
  const dark = [];
  for (const el of document.querySelectorAll('#pp-toggles *')) {
    if (el.children.length) continue;
    const t = (el.textContent || '').trim();
    if (!t) continue;
    const m = getComputedStyle(el).color.match(/[\d.]+/g);
    if (!m) continue;
    const [r0, g0, b0] = m.map(Number);
    const L = (0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0) / 255;
    if (L < 0.45) {
      const rr = el.getBoundingClientRect();
      if (rr.width < 1) continue;
      dark.push({ txt: t.slice(0, 10), color: getComputedStyle(el).color, L: +L.toFixed(2), y: +rr.y.toFixed(0) });
    }
  }
  const root = document.getElementById('pp-toggles');
  const rows = [...root.querySelectorAll('.pp-toggle-group, .pp-slider-row')].map((el) => {
    const r = el.getBoundingClientRect();
    return { cls: String(el.className).slice(0, 50), y: +r.y.toFixed(1), h: +r.height.toFixed(1), disp: getComputedStyle(el).display, of: getComputedStyle(el).overflow };
  });
  return { res, xs, dark, rows, card: { sh: root.scrollHeight, ch: root.clientHeight, gap: getComputedStyle(root).rowGap, pad: getComputedStyle(root).padding } };
}, SELS);

fs.writeFileSync(path.join(OUT, 'probe4.json'), JSON.stringify(out, null, 1));
console.log('CARD', JSON.stringify(out.card));
for (const [k, v] of Object.entries(out.res)) console.log(k, JSON.stringify(v));
console.log('X', JSON.stringify(out.xs));
console.log('DARK', JSON.stringify(out.dark));
console.log('ROWS');
for (const r of out.rows) console.log(' ', JSON.stringify(r));
await browser.close();
