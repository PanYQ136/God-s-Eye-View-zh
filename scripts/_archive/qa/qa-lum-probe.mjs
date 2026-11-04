#!/usr/bin/env node
/**
 * qa-lum-probe.mjs —— 验证「亮底自适应」在真实运行时（不冻结渲染循环）确实生效：
 *   飞到乌尤尼盐湖 → 每 500ms 读 html[data-gev-glass-lum] 与卡片 computed 背景，
 *   再飞回暗场城市 → 确认回落到 dark。同时截 bright/dark 两张实况图。
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'evidence/_collab/t_fdd76e7a/probe-runtime';
const URL = process.env.GEV_URL || 'http://127.0.0.1:4173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,820', '--hide-scrollbars'],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.removeItem('gev-liquid-cards:v2');
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
    localStorage.setItem('gev.gfx', JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'default' }));
  } catch (e) {}
});
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc && !!window.__gevViewer, { timeout: 180000 });
await sleep(12000);
await page.keyboard.press('Escape');
await sleep(2000);

const readState = () => page.evaluate(() => {
  const cs = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).backgroundColor : null; };
  const lumEl = document.querySelector('#gev-perf-fps');
  return {
    lum: document.documentElement.dataset.gevGlassLum || null,
    card: cs('#data-panel'),
    tray: cs('#command-dock .dock-popover-content'),
    chip: cs('#gev-locate-btn'),
    perfMode: document.documentElement.dataset.gevPerf || null,
    fpsChip: lumEl ? lumEl.textContent.trim() : null,
  };
});

async function fly(lon, lat, h, tag, samples = 20) {
  await page.evaluate((lon, lat, h) => {
    const C = window.__CESIUM__ || window.Cesium;
    window.__gevViewer.camera.cancelFlight();
    window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(lon, lat, h), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
  }, lon, lat, h);
  const series = [];
  for (let i = 0; i < samples; i++) {
    await sleep(700);
    const s = await readState();
    series.push({ t: +((i + 1) * 0.7).toFixed(1), ...s });
    if (s.lum === 'bright' && tag === 'salt') break;
  }
  const buf = await page.screenshot();
  fs.writeFileSync(path.join(OUT, `runtime-${tag}-full.png`), buf);
  const r = await page.evaluate(() => {
    const ids = ['data-panel', 'pp-toggles', 'location-bar', 'gev-gfx-fab', 'gev-locate-btn', 'gev-perf-fps', 'gev-lang-toggle'];
    const out = {};
    for (const id of ids) { const el = document.getElementById(id); if (!el) continue; const b = el.getBoundingClientRect(); out[id] = [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 10) / 10); }
    return out;
  });
  return { tag, series, rects: r };
}

const darkFirst = await fly(-46.6333, -23.5505, 9000, 'dark', 3);
const salt = await fly(-67.5, -20.13, 12000, 'salt', 24);
const back = await fly(-46.6333, -23.5505, 9000, 'dark-back', 10);

const report = { url: URL, darkFirst, salt, back, errors: errs.slice(0, 10), errorCount: errs.length };
fs.writeFileSync(path.join(OUT, 'lum-probe.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  darkFirst: darkFirst.series.slice(-1)[0],
  saltLast: salt.series.slice(-1)[0],
  saltFlippedAt: (salt.series.find((s) => s.lum === 'bright') || {}).t ?? null,
  saltSeriesLum: salt.series.map((s) => s.lum),
  backLast: back.series.slice(-1)[0],
  darkLums: back.series.map((s) => s.lum),
  errors: report.errors,
}, null, 1));
await browser.close();
