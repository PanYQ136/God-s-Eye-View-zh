#!/usr/bin/env node
/* qa-lg-alpha-readpixels.mjs — 直接读玻璃 WebGL 缓冲区的 alpha（不复用截图路径，避开 DOM 叠层污染）
   §3.3：regular 内部 0.86–0.92、clear 0.70–0.80；只有最外 1–2 CSS px 允许趋 1（AA/轮廓）。 */
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

async function sample() {
  return await page.evaluate(() => {
    const surf = window.__gevGlStats().surfaces;
    const rows = [];
    for (const s of surf) {
      const [x, y, w, h] = s.rect;
      // 内部：卡中心附近 5 点 × 3 行，全部距边 ≥ min(w,h)*0.3
      const ins = Math.min(w, h) * 0.3;
      const pts = [];
      for (const fx of [0.25, 0.4, 0.5, 0.6, 0.75]) for (const fy of [0.35, 0.5, 0.65]) pts.push([x + w * fx, y + h * fy]);
      const inner = pts.map(([px, py]) => window.__gevGlReadPixel(px, py)).filter(Boolean).map((p) => p[3]);
      // 边缘带：距上轮廓 1/2/3/6/12 CSS px（透镜带内），看 AA → uInterior 的过渡
      const edge = [1, 2, 3, 6, 12, 20].map((d) => { const p = window.__gevGlReadPixel(x + w * 0.5, y + d); return p ? p[3] : null; });
      // 中心（应等于 uInterior）
      const c = window.__gevGlReadPixel(x + w * 0.5, y + h * 0.5);
      rows.push({ id: s.id, variant: s.variant, interiorUniform: s.interior, innerAlpha: inner, edgeRamp: edge, center: c ? c[3] : null });
    }
    return rows;
  });
}

const out = { probe: 'qa-lg-alpha-readpixels', method: 'window.__gevGlReadPixel 直读玻璃 WebGL drawing buffer 的 A 通道（非截图）', passes: {} };
for (const [tag, patch] of [['default(0.90/0.75)', { interiorRegular: 0.90, interiorClear: 0.75 }], ['lo(0.86/0.70)', { interiorRegular: 0.86, interiorClear: 0.70 }], ['hi(0.92/0.80)', { interiorRegular: 0.92, interiorClear: 0.80 }]]) {
  await page.evaluate((p) => window.__gevGlSet(p), patch);
  await sleep(800);
  out.passes[tag] = await sample();
}
await page.evaluate(() => window.__gevGlSet({ interiorRegular: 0.90, interiorClear: 0.75 }));
out.consoleErrors = errs;
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(`${OUT}/alpha-readpixels.json`, JSON.stringify(out, null, 1));
await browser.close();
