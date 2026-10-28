#!/usr/bin/env node
/* review-lg-probe32.mjs — A/B：uInterior 是否真的作用在内部（复核轮次 5 的阻塞复验）
   冻结 Cesium → 剥 CSS → 透明页 → 逐档设 interiorRegular/interiorClear，读内部 alpha。 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r6';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--window-size=1536,730'] });
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await sleep(13000);
await page.evaluate(() => { const x = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (x) x.click(); });
await sleep(2500);
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await sleep(600);

const surfaces = await page.evaluate(() => {
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
  [...document.querySelectorAll('canvas')].forEach((c) => { if (c.id !== 'gev-gl-glass') c.style.visibility = 'hidden'; });
  const st = document.createElement('style'); st.id = '__ab_strip';
  st.textContent = 'html,body{background:transparent!important} .gev-lc,.gev-lc *{background:transparent!important;background-image:none!important;box-shadow:none!important;border-color:transparent!important;color:transparent!important;text-shadow:none!important} #gev-locate-btn,#gev-lang-toggle,#gev-perf-fps,#gev-perf-wrap{background:transparent!important}';
  document.head.appendChild(st);
  return window.__gevGlStats().surfaces.map((s) => ({ id: s.id, variant: s.variant, rect: s.rect }));
});

async function alphaAt(rects) {
  const { data, info } = await sharp(await page.screenshot({ omitBackground: true })).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, ch = info.channels;
  const stat = (x, y, w, h) => {
    const A = [];
    for (let r = Math.max(0, y); r < Math.min(H, y + h); r++) for (let c = Math.max(0, x); c < Math.min(W, x + w); c++) A.push(data[(r * W + c) * ch + 3]);
    if (!A.length) return null; A.sort((a, b) => a - b);
    return { p10: A[Math.floor(A.length * 0.1)], p50: A[Math.floor(A.length * 0.5)], p90: A[Math.floor(A.length * 0.9)], n: A.length };
  };
  const out = {};
  for (const s of rects) {
    const [x, y, w, h] = s.rect;
    const inset = Math.round(Math.min(w, h) * 0.35);
    out[s.id] = { variant: s.variant, inner: stat((x + inset) * 2, (y + Math.round(h / 2) - 3) * 2, Math.max(6, Math.round(w * 0.25)) * 2, 6 * 2) };
  }
  return out;
}

const rows = {};
for (const [reg, clr] of [[0.90, 0.75], [0.50, 0.50], [1.00, 1.00]]) {
  await page.evaluate((r, c) => window.__gevGlSet({ interiorRegular: r, interiorClear: c }), reg, clr);
  await sleep(700);
  rows[`reg=${reg},clear=${clr}`] = await alphaAt(surfaces);
}
const uniformReadout = await page.evaluate(() => window.__gevGlStats().surfaces.map((s) => ({ id: s.id, v: s.variant, interior: s.interior })));
const out = { probe: 'review-lg-probe32', note: 'interior alpha A/B（剥 CSS + 透明页 + omitBackground）', rows, uniformReadout, consoleErrors: errs };
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(`${OUT}/probe32.json`, JSON.stringify(out, null, 1));
await page.evaluate(() => window.__gevGlSet({ interiorRegular: 0.90, interiorClear: 0.75 }));
await sleep(400);
await page.screenshot({ path: `${OUT}/p32-alpha-strip.png` });
await browser.close();
