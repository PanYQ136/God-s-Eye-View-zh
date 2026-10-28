#!/usr/bin/env node
/* review-lg-probe30.mjs —— 玻璃层 alpha 的 A/B 定性：改 uInterior 后同点 alpha 是否随之变化
   baseline → interiorRegular 0.50 → 1.00 → 隐藏玻璃画布，各测同一点 alpha
   同时导出 alpha 灰阶图供人眼确认「卡内是否真的有玻璃层」 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r5';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--window-size=1536,730'] });
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await sleep(13000);
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const x = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (x) x.click(); });
await sleep(2500);
const r0 = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top) }; });
await page.mouse.move(r0.l + 18, r0.t + 20); await page.mouse.down(); await sleep(60); await page.mouse.up();
await sleep(1200);
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await sleep(700);
const rect = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
await page.evaluate(() => {
  document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent';
  [...document.querySelectorAll('canvas')].forEach((c) => { if (c.id !== 'gev-gl-glass') c.style.visibility = 'hidden'; });
});
await sleep(600);

const alphaStats = async () => {
  const buf = await page.screenshot({ omitBackground: true });
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const get = (x, y, w, h) => {
    const A = [];
    for (let r = y; r < y + h; r++) for (let c = x; c < x + w; c++) { const i = (r * info.width + c) * info.channels; A.push(data[i + 3]); }
    A.sort((a, b) => a - b);
    return { p50: A[Math.floor(A.length / 2)], p90: A[Math.floor(A.length * 0.9)], max: A[A.length - 1] };
  };
  const X = (cssX) => Math.round(cssX * 2), Y = (cssY) => Math.round(cssY * 2);
  return {
    centreNoText: get(X(rect.l + 30), Y(rect.t + 250), X(60) - X(0), 40),
    nearEdge2: get(X(rect.l + 2), Y(rect.t + 250), 8, 40),
    deep12: get(X(rect.l + 12), Y(rect.t + 250), 10, 40),
    alphaImage: null,
  };
};
const base = await alphaStats();
const shot = async (name) => { const buf = await page.screenshot({ omitBackground: true, clip: { x: rect.l, y: rect.t, width: rect.w, height: rect.h } }); await sharp(buf).ensureAlpha().extractChannel(3).png().toFile(`${OUT}/${name}.png`); };
await shot('a30-base-alpha');
await page.evaluate(() => window.__gevGlSet({ interiorRegular: 0.5 })); await sleep(600);
const half = await alphaStats(); await shot('a30-i050-alpha');
await page.evaluate(() => window.__gevGlSet({ interiorRegular: 1.0 })); await sleep(600);
const one = await alphaStats();
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = 'none'; }); await sleep(400);
const noGlass = await alphaStats();
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = ''; window.__gevGlSet({ interiorRegular: 0.9 }); });
const out = { rect, base, interior050: half, interior100: one, glassHidden: noGlass };
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(`${OUT}/probe30.json`, JSON.stringify(out, null, 1));
await browser.close();
