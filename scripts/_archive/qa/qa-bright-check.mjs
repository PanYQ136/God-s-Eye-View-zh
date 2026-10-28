#!/usr/bin/env node
/**
 * qa-bright-check.mjs —— 只测「亮底（盐湖）+ bright 档」的卡片/chip 文字对比度，
 * 用来在 40s 内试 --lgm-* 亮底兜底值，避免每次跑全量审计。
 * 用法: node scripts/qa-bright-check.mjs [tokenOverrideCssFile]
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const CSS_FILE = process.argv[2] || '';
const OVERRIDE = CSS_FILE && fs.existsSync(CSS_FILE) ? fs.readFileSync(CSS_FILE, 'utf8') : '';
const VW = 1536, VH = 730, DSF = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lumOf = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const con = (a, b) => +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2);

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,820', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: VW, height: VH, deviceScaleFactor: DSF });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.removeItem('gev-liquid-cards:v2');
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
    localStorage.setItem('gev.gfx', JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'default' }));
  } catch (e) {}
});
await page.goto(process.env.GEV_URL || 'http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc && !!window.__gevViewer, { timeout: 180000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(1500);
if (OVERRIDE) await page.evaluate((css) => { const s = document.createElement('style'); s.id = 'qa-override'; s.textContent = css; document.head.appendChild(s); }, OVERRIDE);
await page.evaluate(() => {
  const C = window.__CESIUM__ || window.Cesium;
  const v = window.__gevViewer;
  v.camera.cancelFlight();
  v.camera.setView({ destination: C.Cartesian3.fromDegrees(-67.5, -20.13, 12000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
});
await sleep(15000);
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await page.evaluate(() => {
  const h = document.documentElement;
  h.setAttribute('data-gev-glass-lum', 'bright');
  window.__obs = new MutationObserver(() => { if (h.getAttribute('data-gev-glass-lum') !== 'bright') h.setAttribute('data-gev-glass-lum', 'bright'); });
  window.__obs.observe(h, { attributes: true, attributeFilter: ['data-gev-glass-lum'] });
});
await sleep(500);
const dom = await page.evaluate(() => {
  const out = { texts: [], styles: {} };
  for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab']) {
    const el = document.getElementById(id);
    if (!el) continue;
    out.styles[id] = getComputedStyle(el).backgroundColor;
    el.querySelectorAll('*').forEach((n) => {
      if (n.children.length) return;
      const t = (n.textContent || '').trim();
      if (!t || t.length > 10) return;
      const r = n.getBoundingClientRect();
      if (r.width < 8 || r.height < 7) return;
      const cs = getComputedStyle(n);
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.3) return;
      out.texts.push({ id, t, rect: [r.left, r.top, r.width, r.height], color: cs.color, fs: cs.fontSize });
    });
  }
  const chips = [];
  for (const sel of ['#gev-locate-btn', '#gev-perf-fps', '#gev-lang-toggle', '#key-setup-chip', '#gev-perf-btn']) {
    const el = document.querySelector(sel);
    if (!el) continue;
    el.querySelectorAll('*').forEach((n) => {
      if (n.children.length) return;
      const t = (n.textContent || '').trim();
      if (!t) return;
      const r = n.getBoundingClientRect();
      if (r.width < 4 || r.height < 6) return;
      chips.push({ id: sel, t, rect: [r.left, r.top, r.width, r.height], color: getComputedStyle(n).color, fs: getComputedStyle(n).fontSize });
    });
  }
  out.chips = chips;
  return out;
});
const buf = await page.screenshot();
const raw = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const { data: rgb, info } = raw;
const ch = info.channels, W = info.width;
const rows = [];
for (const tx of [...dom.texts, ...dom.chips]) {
  const x0 = Math.max(0, Math.floor(tx.rect[0]) - 1), y0 = Math.max(0, Math.floor(tx.rect[1]) - 1);
  const x1 = Math.min(VW, Math.ceil(tx.rect[0] + tx.rect[2]) + 1), y1 = Math.min(VH, Math.ceil(tx.rect[1] + tx.rect[3]) + 1);
  if (x1 - x0 < 4 || y1 - y0 < 4) continue;
  const L = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const xi = Math.round(x * DSF), yi = Math.round(y * DSF);
    if (xi < 0 || yi < 0 || xi >= W || yi >= info.height) continue;
    const i = (yi * W + xi) * ch;
    L.push(lumOf(rgb[i], rgb[i + 1], rgb[i + 2]));
  }
  if (!L.length) continue;
  L.sort((a, b) => a - b);
  const bg = L[Math.floor(L.length / 2)];
  const m = tx.color.match(/[\d.]+/g) || [255, 255, 255];
  rows.push({ id: tx.id, t: tx.t, color: tx.color, base: +bg.toFixed(3), c: con(lumOf(+m[0], +m[1], +m[2]), bg) });
}
rows.sort((a, b) => a.c - b.c);
console.log(JSON.stringify({ cardBg: dom.styles, worst: rows.slice(0, 8), pass: rows.filter((r) => r.c >= 4.5).length + '/' + rows.length }, null, 1));
await browser.close();
