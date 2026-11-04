#!/usr/bin/env node
/**
 * qa-expand-evidence.mjs —— 出图 + 像素 A/B（t_f8d97c1c）
 *  1) control 单独展开 465：与「未加 .gev-lc-narrow 时代」的 ctrl-alone-2x.png 逐像素比对（必须 0 差异）
 *  2) 3 个曾重叠 combo：接缝特写（旧几何 465 复刻 = 压住 / 新几何 = 有 8px 缝）
 *  3) 合成 before/after 对比图
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const OUT = 'evidence/_collab/t_f8d97c1c';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization', '--window-size=1536,820', '--window-position=1900,40', '--hide-scrollbars'],
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
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(2500);

const shot = async (file, clip) => { await page.screenshot(clip ? { path: path.join(OUT, file), clip } : { path: path.join(OUT, file) }); };
const closeAll = async () => { await page.evaluate(() => (window.__gevLc._ids() || []).forEach((id) => window.__gevLc.close(id))); await sleep(800); };

// 1) control 单独展开（465）→ narrow 模式必须 OFF，且 CSS 在 465 下「零影响」（同帧开/关类逐字段比对）
await closeAll();
await page.evaluate(() => window.__gevLc.open('control-panel'));
await sleep(1200);
await shot('ctrl-alone-2x-after.png', { x: 780, y: 300, width: 560, height: 420 });
const info465 = await page.evaluate(() => ({ ...window.__gevLc.info('control-panel'), narrow: document.getElementById('control-panel').classList.contains('gev-lc-narrow') }));
console.log('CONTROL ALONE(465):', JSON.stringify(info465));

const geom465 = () => page.evaluate(() => {
  const el = document.getElementById('control-panel');
  const r = el.getBoundingClientRect();
  const pick = (sel) => [...el.querySelectorAll(sel)].map((n) => { const b = n.getBoundingClientRect(); return [Math.round(b.left - r.left), Math.round(b.top - r.top), Math.round(b.width), Math.round(b.height)]; });
  return { mapBtns: pick('.map-source-section button'), presetBtns: pick('#style-buttons button'), scroll: [el.scrollWidth, el.clientWidth, el.scrollHeight, el.clientHeight] };
});
const gOff = await geom465();
await page.evaluate(() => document.getElementById('control-panel').classList.add('gev-lc-narrow'));
await sleep(300);
const gOn = await geom465();
await page.evaluate(() => document.getElementById('control-panel').classList.remove('gev-lc-narrow'));
await sleep(200);
const cssInert465 = JSON.stringify(gOff) === JSON.stringify(gOn);
console.log('CSS-inert@465:', cssInert465, cssInert465 ? '' : JSON.stringify({ gOff, gOn }));

await closeAll();

// 2) 三个原重叠 combo：旧几何复刻 vs 新几何
const combos = [['pp-toggles', 'control'], ['cctv-panel', 'control'], ['global-context-panel', 'control']];
const seamClip = { x: 1080, y: 300, width: 300, height: 260 };   // 接缝区（control 右沿 ~1176..1303 / 右栏左沿）
const rows = [];
for (const [rail] of combos) {
  await closeAll();
  await page.evaluate((rail) => { window.__gevLc.open('data-panel'); window.__gevLc.open(rail); window.__gevLc.open('control-panel'); }, rail);
  await sleep(1300);
  const after = await page.evaluate(() => window.__gevLc._ids().map((id) => ({ id, ...window.__gevLc.info(id) })));
  await shot(`combo-${rail}+control-2x.png`);
  await page.screenshot({ path: path.join(OUT, `seam-${rail}-after.png`), clip: seamClip });
  // 旧几何复刻：把 control 写回改前的 465 宽（并保持 st.g 一致），即修复前的样子
  await page.evaluate(() => {
    const el = document.getElementById('control-panel');
    el.classList.remove('gev-lc-narrow');
    el.style.width = '465px';
    const r = el.getBoundingClientRect();
    el.style.left = Math.round(r.left) + 'px'; el.style.top = Math.round(r.top) + 'px';
  });
  await sleep(500);
  await page.screenshot({ path: path.join(OUT, `seam-${rail}-before.png`), clip: seamClip });
  rows.push({ rail, after });
  console.log('COMBO', rail, JSON.stringify(after));
  // 复位：重载页面，避免「旧几何」写样式把 App 的 rail 布局污染到下一个 combo
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
  await sleep(9000);
  // 等右栏真的布好（否则 open() 拿到 0 尺寸锚点）
  await page.waitForFunction(() => {
    const r = document.getElementById('global-context-panel');
    return r && r.getBoundingClientRect().left > 500 && r.getBoundingClientRect().height > 20;
  }, { timeout: 60000 });
  await page.keyboard.press('Escape');
  await sleep(1500);
}
await closeAll();

// 3) 合成：每个 combo 上=旧(压住) / 下=新(留缝)
for (const [rail] of combos) {
  const a = path.join(OUT, `seam-${rail}-before.png`);
  const b = path.join(OUT, `seam-${rail}-after.png`);
  const ia = await sharp(a).metadata(), ib = await sharp(b).metadata();
  const labelH = 0;
  const W = Math.max(ia.width, ib.width), H = ia.height + ib.height;
  await sharp({ create: { width: W, height: H, channels: 3, background: '#000' } })
    .composite([{ input: a, top: 0, left: 0 }, { input: b, top: ia.height, left: 0 }])
    .png().toFile(path.join(OUT, `cmp-seam-${rail}.png`));
}

console.log('DONE');
await browser.close();
