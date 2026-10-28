#!/usr/bin/env node
/* qa-lg-alpha-glassonly.mjs — 玻璃层自身输出 alpha（只测 #gev-gl-glass，排除任何 DOM 叠层）
   与复核 probe31 的差别：把玻璃画布临时提到最顶层（z-index 2147483000），
   于是截图 alpha 通道 = 玻璃像素 alpha 本身，不会被卡片 scrim / 内容底板二次叠加。
   期望（§3.3）：regular 内部 219–235、clear 179–204；边缘内 0–2px 允许趋 1（AA/轮廓）。 */
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

async function shoot(surfaces, tag) {
  await page.evaluate(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    [...document.querySelectorAll('canvas')].forEach((c) => { if (c.id !== 'gev-gl-glass') c.style.visibility = 'hidden'; });
    const g = document.getElementById('gev-gl-glass');
    g.style.zIndex = '2147483000'; g.style.mixBlendMode = 'normal';
    // 全量剥 DOM 视觉（背景/文字/边框/阴影/伪元素），只留玻璃画布 →
    // 用于隔离「截图 alpha 是否只来自玻璃层」，排除卡壳 scrim / 文字墨迹叠加
    const st = document.createElement('style'); st.id = '__iso';
    st.textContent = '*{background:transparent!important;background-image:none!important;color:transparent!important;' +
      'box-shadow:none!important;border-color:transparent!important;text-shadow:none!important;-webkit-text-fill-color:transparent!important}' +
      '*::before,*::after{background:transparent!important;background-image:none!important;box-shadow:none!important;opacity:0!important}';
    document.head.appendChild(st);
  });
  await sleep(600);
  const { data, info } = await sharp(await page.screenshot({ omitBackground: true })).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, ch = info.channels;
  const stat = (x, y, w, h) => {
    const A = [];
    for (let r = Math.max(0, y); r < Math.min(H, y + h); r++) for (let c = Math.max(0, x); c < Math.min(W, x + w); c++) A.push(data[(r * W + c) * ch + 3]);
    if (!A.length) return null; A.sort((a, b) => a - b);
    return { p10: A[Math.floor(A.length * 0.1)], p50: A[Math.floor(A.length * 0.5)], p90: A[Math.floor(A.length * 0.9)], max: A[A.length - 1], n: A.length };
  };
  const rows = surfaces.map((s) => {
    const [x, y, w, h] = s.rect;
    const inset = Math.round(Math.min(w, h) * 0.35);
    // 内部：卡中线附近横向 26% 宽、6 CSS px 高的条（远离边缘带）
    const inner = stat((x + inset) * 2, (y + Math.round(h / 2) - 3) * 2, Math.max(6, Math.round(w * 0.26)) * 2, 6 * 2);
    // 边缘带：距轮廓 2px 处 1 CSS px 高条（应趋 1）
    const edge = stat((x + inset) * 2, (y + 2) * 2, Math.max(6, Math.round(w * 0.26)) * 2, 2);
    return { id: s.id, variant: s.variant, interiorUniform: s.interior, inner, edgeIn2: edge };
  });
  return { tag, rows };
}

const surfaces = await page.evaluate(() => window.__gevGlStats().surfaces.map((s) => ({ id: s.id, variant: s.variant, interior: s.interior, rect: s.rect })));
const a = await shoot(surfaces, 'default(0.90/0.75)');

// A/B：uniform 线性性（证明 alpha 真的由 uInterior 决定，而不是恒 1）
await page.evaluate(() => window.__gevGlSet({ interiorRegular: 0.86, interiorClear: 0.70 }));
await sleep(700);
const b = await shoot(await page.evaluate(() => window.__gevGlStats().surfaces.map((s) => ({ id: s.id, variant: s.variant, interior: s.interior, rect: s.rect }))), 'lo(0.86/0.70)');
await page.evaluate(() => window.__gevGlSet({ interiorRegular: 0.90, interiorClear: 0.75 }));
await sleep(700);

// 对照：玻璃画布隐藏后同点 alpha 应为 0
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = 'none'; });
await sleep(400);
const ctl = await sharp(await page.screenshot({ omitBackground: true })).raw().toBuffer({ resolveWithObject: true });
let ctlMax = 0;
for (let i = 3; i < ctl.data.length; i += ctl.info.channels) if (ctl.data[i] > ctlMax) ctlMax = ctl.data[i];

const out = { probe: 'qa-lg-alpha-glassonly', method: '玻璃画布提到最顶层 + 页面透明 + omitBackground → 截图 alpha 即玻璃像素 alpha', default: a, lo: b, control_glassHidden_maxAlpha: ctlMax, consoleErrors: errs };
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(`${OUT}/alpha-glassonly.json`, JSON.stringify(out, null, 1));
await browser.close();
