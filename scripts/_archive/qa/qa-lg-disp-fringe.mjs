#!/usr/bin/env node
/**
 * qa-lg-disp-fringe.mjs —— R/B 色边质心错位（复核阻塞项 1 的直接证据）
 *  斜面带内逐行取「红偏」(R−G)>0 与「蓝偏」(B−G)>0 的加权质心，
 *  Δ = 质心B − 质心R（设备 px）。中性灰条纹背景 → 任何红/蓝偏都来自色散。
 *  同时输出色散关（etaLo=etaHi）的对照值。
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const DIR = 'evidence/lg-glass-shots/p0/disp';
const SCR = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(DIR, { recursive: true }); fs.mkdirSync(SCR, { recursive: true });
const out = { url, errors: [] };

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => out.errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 16000));
const DSF = 2;

const grab = async (clip, tag) => {
  const buf = await page.screenshot({ clip });
  if (tag) fs.writeFileSync(path.join(SCR, tag + '.png'), buf);
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels, buf };
};

/* 逐行红/蓝偏质心 */
function fringe(img, x0, x1, y0, y1, minMass = 40) {
  const rows = [];
  for (let y = y0; y <= y1; y++) {
    let mR = 0, mB = 0, cxR = 0, cxB = 0;
    for (let x = x0; x <= x1; x++) {
      const i = (y * img.w + x) * img.ch;
      const R = img.data[i], G = img.data[i + 1], B = img.data[i + 2];
      const wr = Math.max(0, R - G), wb = Math.max(0, B - G);
      mR += wr; mB += wb; cxR += x * wr; cxB += x * wb;
    }
    if (mR < minMass || mB < minMass) continue;
    rows.push({ y, d: +(cxB / mB - cxR / mR).toFixed(2), massR: Math.round(mR), massB: Math.round(mB) });
  }
  const ds = rows.map((r) => r.d).sort((a, b) => a - b);
  return {
    rows: rows.length,
    medianDevice: ds.length ? ds[Math.floor(ds.length / 2)] : null,
    medianCss: ds.length ? +(Math.abs(ds[Math.floor(ds.length / 2)]) / 2).toFixed(2) : null,
    p25: ds.length ? ds[Math.floor(ds.length * 0.25)] : null,
    p75: ds.length ? ds[Math.floor(ds.length * 0.75)] : null,
    sample: rows.slice(0, 6),
  };
}

/* A. 中性条纹 */
const card = await page.evaluate(() => {
  const s = window.__gevGlStats().surfaces;
  return s.find((x) => x.id === 'pp-toggles') || s[0];
});
const bezelDev = Math.round(card.bezel * DSF);
await page.evaluate(() => { window.__gevGlTestBg(true, 8); window.__gevGlSet({ etaLo: 1.48, etaHi: 1.56 }); });
await new Promise((r) => setTimeout(r, 1200));
const clipA = { x: card.rect[0] - 1, y: card.rect[1] + 8, width: Math.ceil(bezelDev / DSF) + 1, height: Math.min(26, card.rect[3] - 16) };
const A = await grab(clipA, 'fringe-stripes-on');
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.52, etaHi: 1.52 }));
await new Promise((r) => setTimeout(r, 800));
const A0 = await grab(clipA, 'fringe-stripes-off');
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.48, etaHi: 1.56 }));
const xr = 1, xl = A.w - 2, yr = 1, yl = A.h - 2;
out.stripes = { clip: clipA, bezelCss: card.bezel, on: fringe(A, xr, xl, yr, yl), off: fringe(A0, xr, xl, yr, yl) };

/* B. 真实地图卡角 */
await page.evaluate(() => window.__gevGlTestBg(false));
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  try {
    const C = window.Cesium || window.__CESIUM__;
    window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-73.9857, 40.7484, 900), orientation: { heading: 0.6, pitch: -0.7, roll: 0 } });
  } catch (e) {}
});
await new Promise((r) => setTimeout(r, 10000));
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 1200));
const card2 = await page.evaluate(() => {
  const s = window.__gevGlStats().surfaces;
  return s.find((x) => x.id === 'data-panel') || s[0];
});
const clipB = { x: card2.rect[0] - 4, y: card2.rect[1] - 4, width: 30, height: 30 };
const B1 = await grab(clipB, 'fringe-map-on');
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.52, etaHi: 1.52 }));
await new Promise((r) => setTimeout(r, 700));
const B0 = await grab(clipB, 'fringe-map-off');
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.48, etaHi: 1.56 }));
out.map = { clip: clipB, on: fringe(B1, 8, 8 + bezelDev, 2, B1.h - 3), off: fringe(B0, 8, 8 + bezelDev, 2, B0.h - 3) };

out.stats = await page.evaluate(() => { const s = window.__gevGlStats(); return { fps: s.fps, scale: s.scale, dev: s.devicePx, count: s.count, dispPx: s.config.dispPx }; });
fs.writeFileSync(path.join(SCR, 'qa-lg-disp-fringe.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ stripes: out.stripes, map: out.map, stats: out.stats, errors: out.errors.slice(0, 3) }, null, 1));
await browser.close();
