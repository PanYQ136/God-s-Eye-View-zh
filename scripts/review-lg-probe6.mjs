#!/usr/bin/env node
/**
 * review-lg-probe6.mjs —— 亮/暗背景下卡片标题文字 WCAG 对比度实测（像素法）
 * 取标题行 clip，前景=高亮分位（文字），背景=中位（玻璃面），按 sRGB→线性算对比度
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(OUT, { recursive: true });
const out = { url, errors: [] };
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => out.errors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('c:' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const wcag = async (clip, tag) => {
  const buf = await page.screenshot({ clip });
  fs.writeFileSync(path.join(OUT, tag + '.png'), buf);
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = [];
  for (let i = 0; i < data.length; i += info.channels) {
    L.push(0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]));
  }
  L.sort((a, b) => a - b);
  const q = (p) => L[Math.min(L.length - 1, Math.floor(p * L.length))];
  const bg = q(0.5), fg = q(0.97);
  return { bg: +bg.toFixed(3), fg: +fg.toFixed(3), ratio: +(((fg + 0.05) / (bg + 0.05))).toFixed(2), n: L.length, p10: +q(0.1).toFixed(3), p90: +q(0.9).toFixed(3) };
};

const shot = async (label) => {
  const st = await page.evaluate(() => window.__gevGlStats());
  const lc = await page.evaluate(() => window.__gevLc.info('data-panel'));
  const clip = { x: lc.x + 6, y: lc.y + 6, width: lc.w - 12, height: Math.min(30, lc.h - 12) };
  const header = await wcag(clip, label + '-data-panel-header');
  const cs = await page.evaluate(() => {
    const el = document.querySelector('#data-panel .panel-inner, #data-panel [class$="-inner"]');
    const t = document.querySelector('#data-panel .panel-title') || document.querySelector('#data-panel h2, #data-panel h3');
    const g = (e, p) => (e ? getComputedStyle(e)[p] : null);
    return {
      innerBg: g(el, 'backgroundColor'), titleColor: g(t, 'color'), textShadow: g(t, 'textShadow'),
      htmlLum: document.documentElement.dataset.gevGlassLum,
      lum: (window.__gevGlStats().surfaces.find((s) => s.id === 'data-panel') || {}).lum,
    };
  });
  return { label, header, cs };
};

out.bright = await shot('p6-bright-dark');
await page.evaluate(() => {
  try { window.__gevViewer.camera.setView({ destination: (window.Cesium || window.__CESIUM__).Cartesian3.fromDegrees(-67.5, -20.13, 12000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }); } catch (e) {}
});
await new Promise((r) => setTimeout(r, 14000));
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 1500));
out.brightBg = await shot('p6-bright-salt');
fs.writeFileSync(path.join(OUT, 'p6-bright.png'), await page.screenshot());
fs.writeFileSync(path.join(OUT, 'review-probe6.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
