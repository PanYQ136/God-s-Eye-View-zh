#!/usr/bin/env node
/* review-lg-probe29.mjs —— 第五轮复核 · Contract lens 续2
   A) 玻璃层真实 alpha：透明页面 + 隐藏地图画布 + omitBackground 截图 → 读 alpha 通道
      （regular 应 ≈1-(1-0.90)(1-0.22)=0.922 → 235±；若玻璃内部 alpha=1 → 255，属规范§4-#7 禁止项）
   B) 指针 specular：指针「贴边」vs「远离」同区域差图（mean/max），验证 §3.5/§5.3-1
*/
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r5';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await sleep(13000);
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const x = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (x) x.click(); });
await sleep(2500);
const out = { probe: 'review-lg-probe29', url: URL };

/* 展开数据卡（真实指针） */
const r0 = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top) }; });
await page.mouse.move(r0.l + 18, r0.t + 20); await page.mouse.down(); await sleep(60); await page.mouse.up();
await sleep(1200);

/* A) alpha */
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await sleep(600);
const geom = await page.evaluate(() => {
  const g = (sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  return { data: g('#data-panel'), chip: g('#gev-locate-btn'), perf: g('#gev-perf-fps'), fab: g('#gev-gfx-fab'), top: g('#top-center-actions') };
});
await page.evaluate(() => {
  // 仅测试期：页面/地图透明，隔离玻璃层
  document.documentElement.style.background = 'transparent';
  document.body.style.background = 'transparent';
  const map = document.querySelector('canvas#cesium, .cesium-widget canvas, canvas');
  window.__hid = [];
  [...document.querySelectorAll('canvas')].forEach((c) => { if (c.id !== 'gev-gl-glass') { c.style.visibility = 'hidden'; } });
});
await sleep(600);
const alphaAt = async (clip) => {
  const buf = await page.screenshot({ clip, omitBackground: true });
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const A = [];
  for (let i = 3; i < data.length; i += info.channels) A.push(data[i]);
  A.sort((a, b) => a - b);
  const q = (p) => A[Math.min(A.length - 1, Math.floor(p * (A.length - 1)))];
  return { p10: q(0.1), p50: q(0.5), p90: q(0.9), min: A[0], max: A[A.length - 1] };
};
out.alpha = {
  note: 'regular interior = 1-(1-0.90)(1-0.22) ≈ 0.922 → 235；clear 0.75 → ≈0.805 → 205；若内部 255 = 不透明拷贝(§4-#7)',
  dataInterior: await alphaAt({ x: geom.data.x + 40, y: geom.data.y + 120, width: 100, height: 40 }),
  dataEdgeIn4: await alphaAt({ x: geom.data.x + 1, y: geom.data.y + 120, width: 5, height: 40 }),
  chip: await alphaAt({ x: geom.chip.x + 8, y: geom.chip.y + 8, width: Math.max(4, geom.chip.w - 16), height: Math.max(4, geom.chip.h - 16) }),
  fab: await alphaAt({ x: geom.fab.x + 8, y: geom.fab.y + 8, width: Math.max(4, geom.fab.w - 16), height: Math.max(4, geom.fab.h - 16) }),
  outsideCard: await alphaAt({ x: 400, y: 400, width: 40, height: 40 }),
  pageBg: await alphaAt({ x: 250, y: 660, width: 40, height: 40 }),
  canvasLayerReadPixelCenter: await page.evaluate((g) => window.__gevGlReadPixel(g.x + 40, g.y + 120), geom.data) // 旧法对照（预期 0，无 preserveDrawingBuffer）
};
await page.evaluate(() => {
  document.documentElement.style.background = '';
  document.body.style.background = '';
  [...document.querySelectorAll('canvas')].forEach((c) => { if (c.id !== 'gev-gl-glass') c.style.visibility = ''; });
});
await sleep(500);

/* B) specular：贴边 vs 远离 */
const rd = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
const bandClip = { x: rd.l - 2, y: rd.t + 30, width: 20, height: Math.min(280, rd.h - 60) };
const raw = async (x, y) => { await page.mouse.move(x, y); await sleep(600); return sharp(await page.screenshot({ clip: bandClip })).removeAlpha().raw().toBuffer({ resolveWithObject: true }); };
const far = await raw(rd.l + 160, rd.t + 30);
const near = await raw(rd.l + 2, rd.t + 120);
const diff = (A, B) => {
  let mx = 0, sum = 0, n = 0, best = null;
  for (let r = 0; r < A.info.height; r++) for (let c = 0; c < A.info.width; c++) {
    const i = (r * A.info.width + c) * A.info.channels;
    const d = (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2])) / 3;
    if (d > mx) { mx = d; best = { cssX: +(c / 2).toFixed(1), cssY: +((r + bandClip.y - rd.t) / 2).toFixed(1) }; }
    sum += d; n++;
  }
  return { max: +mx.toFixed(1), mean: +(sum / n).toFixed(3), at: best };
};
out.specular = { near_vs_far: diff(far, near), note: 'clip = 卡左侧 20 CSS px 宽竖条；>2/255 视为可测的 specular 跟随' };
out.uMouseState = await page.evaluate(() => ({ on: !!window.__gevGlStats, mouseKnown: true }));
out.consoleErrors = errs;
await page.screenshot({ path: `${OUT}/p29-alpha.png` });
fs.writeFileSync(`${OUT}/probe29.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
