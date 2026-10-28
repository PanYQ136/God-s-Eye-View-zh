#!/usr/bin/env node
/* review-lg-probe31.mjs —— 玻璃层自身输出 alpha（剥离 CSS scrim）
   做法：页面/地图透明 + 隐藏其它 canvas + 运行期把 .gev-lc 的 CSS background 清零（只测玻璃层）
        逐卡取「内部」(min边*0.35 处) 与「边缘内 3px」的 alpha 中位数；clear 芯片同测。
   预期（规范 §3.3）：regular 内部 0.86–0.92(219–235)、clear 0.70–0.80(179–204)
*/
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
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await sleep(13000);
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const x = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (x) x.click(); });
await sleep(2500);
const r0 = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top) }; });
await page.mouse.move(r0.l + 18, r0.t + 20); await page.mouse.down(); await sleep(60); await page.mouse.up();
await sleep(1300);
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await sleep(700);

const surf = await page.evaluate(() => window.__gevGlStats().surfaces.map((s) => ({ id: s.id, variant: s.variant, interior: s.interior, rect: s.rect })));

await page.evaluate(() => {
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
  [...document.querySelectorAll('canvas')].forEach((c) => { if (c.id !== 'gev-gl-glass') c.style.visibility = 'hidden'; });
  // 剥离 CSS scrim / 内容底板，只留玻璃层 alpha
  const st = document.createElement('style');
  st.id = '__rev_strip';
  st.textContent = 'html,body{background:transparent!important} .gev-lc,.gev-lc *{background:transparent!important;background-image:none!important;box-shadow:none!important;border-color:transparent!important} #gev-locate-btn,#gev-lang-toggle,#gev-perf-fps{background:transparent!important}';
  document.head.appendChild(st);
});
await sleep(700);
const { data, info } = await sharp(await page.screenshot({ omitBackground: true })).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const alphaRect = (x, y, w, h) => {
  const A = [];
  for (let r = Math.max(0, y); r < Math.min(H, y + h); r++) for (let c = Math.max(0, x); c < Math.min(W, x + w); c++) { const i = (r * W + c) * info.channels; A.push(data[i + 3]); }
  if (!A.length) return null;
  A.sort((a, b) => a - b);
  return { p10: A[Math.floor(A.length * 0.1)], p50: A[Math.floor(A.length * 0.5)], p90: A[Math.floor(A.length * 0.9)], max: A[A.length - 1], n: A.length };
};
const rows = surf.map((s) => {
  const [x, y, w, h] = s.rect;
  const m = Math.min(w, h);
  const inset = Math.round(m * 0.35);
  return {
    id: s.id, variant: s.variant, interiorUniform: s.interior,
    inner: alphaRect((x + inset) * 2, (y + Math.round(h / 2) - 3) * 2, Math.max(6, Math.round(w * 0.25)) * 2, 6 * 2),
    edgeIn3: alphaRect((x + 2) * 2, (y + Math.round(h / 2) - 3) * 2, 3 * 2, 6 * 2),
  };
});
// 对照：把玻璃画布隐藏，确认剥离后确实为 0
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = 'none'; });
await sleep(400);
const off = await sharp(await page.screenshot({ omitBackground: true })).raw().toBuffer({ resolveWithObject: true });
const ctl = (() => {
  const A = [];
  const [x, y, w, h] = surf[0].rect;
  for (let r = y * 2; r < (y + h) * 2; r++) for (let c = x * 2; c < (x + w) * 2; c++) { const i = (r * off.info.width + c) * off.info.channels; A.push(off.data[i + 3]); }
  A.sort((a, b) => a - b);
  return { p50: A[Math.floor(A.length / 2)], max: A[A.length - 1] };
})();
const out = { probe: 'review-lg-probe31', method: 'CSS 全剥离 + 页面透明 + omitBackground，测的是玻璃画布自身 alpha', rows, control_glassHidden: ctl, consoleErrors: errs };
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(`${OUT}/probe31.json`, JSON.stringify(out, null, 1));
await page.screenshot({ path: `${OUT}/p31-strip.png` });
await browser.close();
