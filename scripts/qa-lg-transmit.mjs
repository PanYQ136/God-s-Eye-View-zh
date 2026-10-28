#!/usr/bin/env node
/* qa-lg-transmit.mjs — 透光性证明（§3.3「禁止内部 alpha=1 的不透明拷贝」的可见证据）
   做法：在玻璃画布**下方**插入一块纯红（#ff0000）整屏色板（z-index 3 < 玻璃 z-index 4），
         逐档 interiorRegular = 1.00 / 0.90 / 0.86 读卡内像素的绿通道：
         透射率 t = 1 - G(有红板)/G(无红板)；1.0 应 t≈0（不透光），0.90→≈0.10，0.86→≈0.14。 */
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
const surf = await page.evaluate(() => window.__gevGlStats().surfaces.map((s) => ({ id: s.id, variant: s.variant, rect: s.rect })));
// 只在卡内取「无文字」区域：用 textContent 过滤不掉，这里取卡右侧 20% 宽度、中线上下的窄条
const pick = surf.filter((s) => ['data-panel', 'scene-panel', 'cctv-panel'].includes(s.id));
await page.evaluate(() => {
  const d = document.createElement('div'); d.id = '__redplate';
  d.style.cssText = 'position:fixed;inset:0;background:#ff0000;z-index:3;pointer-events:none;display:none';
  document.body.appendChild(d);
});

async function shots(tag) {
  const g = async () => {
    const { data, info } = await sharp(await page.screenshot({ omitBackground: true })).raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height, ch = info.channels;
    const out = {};
    for (const s of pick) {
      const [x, y, w, h] = s.rect;
      // 卡内右侧 15% 宽、竖向中间 10% 高的纯面区域（避开标题与图标）
      const x0 = Math.round((x + w * 0.80) * 2), y0 = Math.round((y + h * 0.45) * 2);
      const ww = Math.round(w * 0.15 * 2), hh = Math.round(h * 0.10 * 2);
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let r = y0; r < Math.min(H, y0 + hh); r++) for (let c = x0; c < Math.min(W, x0 + ww); c++) { const i = (r * W + c) * ch; sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; n++; }
      out[s.id] = { r: +(sr / n).toFixed(2), g: +(sg / n).toFixed(2), b: +(sb / n).toFixed(2), n };
    }
    return out;
  };
  await page.evaluate(() => { document.getElementById('__redplate').style.display = 'none'; });
  await sleep(350);
  const base = await g();
  await page.evaluate(() => { document.getElementById('__redplate').style.display = 'block'; });
  await sleep(350);
  const red = await g();
  await page.screenshot({ path: `${OUT}/transmit-${tag}.png` });
  const rows = pick.map((s) => {
    const b = base[s.id], r = red[s.id];
    const t = b.g > 1 ? +(1 - r.g / b.g).toFixed(3) : null;
    return { id: s.id, baseG: b.g, redG: r.g, transmission: t };
  });
  return rows;
}

const out = { probe: 'qa-lg-transmit', method: '玻璃下方整屏纯红色板 A/B，卡内面区域绿通道差 → 透射率', passes: {} };
for (const [tag, patch] of [['interior=1.00', { interiorRegular: 1.00 }], ['interior=0.92', { interiorRegular: 0.92 }], ['interior=0.90', { interiorRegular: 0.90 }], ['interior=0.86', { interiorRegular: 0.86 }]]) {
  await page.evaluate((p) => window.__gevGlSet(p), patch);
  await sleep(600);
  out.passes[tag] = await shots(tag.replace(/[=. ]/g, '_'));
}
await page.evaluate(() => window.__gevGlSet({ interiorRegular: 0.90 }));
out.consoleErrors = errs;
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(`${OUT}/transmit.json`, JSON.stringify(out, null, 1));
await browser.close();
