#!/usr/bin/env node
/* qa-lg-alpha-fb.mjs — 同帧读回玻璃 framebuffer 的 A 通道（验收 §3.3 输出 alpha）
   每卡取 15 个内部点（距边 ≥30%）+ 上边缘 1/2/3/6/12/20px 的过渡 ramp；
   A/B：interiorRegular 0.86 / 0.90 / 0.92、interiorClear 0.70 / 0.75 / 0.80 三档 → 证 alpha = uInterior 线性。 */
import puppeteer from 'puppeteer';
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

const surfaces = await page.evaluate(() => window.__gevGlStats().surfaces.map((s) => ({ id: s.id, variant: s.variant, interior: s.interior, rect: s.rect })));

async function measure(patch) {
  await page.evaluate((p) => window.__gevGlSet(p), patch);
  const out = await page.evaluate(async (surf) => {
    const pts = [];
    const idx = [];
    surf.forEach((s, si) => {
      const [x, y, w, h] = s.rect;
      const list = [];
      for (const fx of [0.3, 0.4, 0.5, 0.6, 0.7]) for (const fy of [0.3, 0.5, 0.7]) list.push([x + w * fx, y + h * fy]);
      for (const d of [1, 2, 3, 6, 12, 20]) list.push([x + w * 0.5, y + d]);
      idx.push({ id: s.id, variant: s.variant, n: list.length, innerN: 15 });
      list.forEach((p) => pts.push(p));
    });
    window.__gevGlAlphaProbe = pts;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const res = window.__gevGlAlphaOut || [];
    const rows = [];
    let k = 0;
    for (const s of idx) {
      const vals = res.slice(k, k + s.n).map((v) => v[0]);
      k += s.n;
      const inner = vals.slice(0, s.innerN).sort((a, b) => a - b);
      rows.push({ id: s.id, variant: s.variant, innerAlphaP50: inner[Math.floor(inner.length / 2)], innerMin: inner[0], innerMax: inner[inner.length - 1], edgeRamp: vals.slice(s.innerN) });
    }
    return rows;
  }, surfaces);
  await page.evaluate(() => { window.__gevGlAlphaProbe = null; });
  return out;
}

const passes = {};
for (const [tag, patch] of [['0.86/0.70', { interiorRegular: 0.86, interiorClear: 0.70 }], ['0.90/0.75', { interiorRegular: 0.90, interiorClear: 0.75 }], ['0.92/0.80', { interiorRegular: 0.92, interiorClear: 0.80 }]]) {
  passes[tag] = await measure(patch);
  await sleep(300);
}
await page.evaluate(() => window.__gevGlSet({ interiorRegular: 0.90, interiorClear: 0.75 }));
const out = { probe: 'qa-lg-alpha-fb', method: '同帧 gl.readPixels 读玻璃 framebuffer：A 通道 = 着色器输出 alpha', surfaces: surfaces.length, passes, consoleErrors: errs };
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(`${OUT}/alpha-fb.json`, JSON.stringify(out, null, 1));
await browser.close();
