#!/usr/bin/env node
/** qa-lg-drag.mjs —— 拖动性能：① 拖动地图（小步，已加载区域）② 拖动卡片（玻璃 quad 每帧跟随） */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const SCR = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 16000));
await page.evaluate(() => {
  window.__ft = [];
  let last = performance.now();
  const tick = (t) => { window.__ft.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const stats = async (label, fn) => {
  const ft0 = await page.evaluate(() => window.__ft.length);
  await fn();
  return await page.evaluate((ft0) => {
    const ft = window.__ft.slice(ft0).sort((a, b) => a - b);
    const q = (p) => +(ft[Math.min(ft.length - 1, Math.floor(p * ft.length))] || 0).toFixed(1);
    return { frames: ft.length, p50: q(0.5), p95: q(0.95), fps: Math.round(1000 / (q(0.5) || 16.7)), over25: ft.filter((v) => v > 25).length };
  }, ft0);
};
const out = { url, errors: errs };
/* ① 地图小步震动（不引发新瓦片） */
out.mapNudge = await stats('nudge', async () => {
  await page.evaluate(async () => {
    const v = window.__gevViewer;
    for (let i = 0; i < 90; i++) { v.camera.moveRight(0.0004); v.camera.moveUp(0.0002); await new Promise((r) => requestAnimationFrame(r)); }
  });
});
/* ② 拖动卡片（浮层拖拽，玻璃每帧重算 quad） */
await page.evaluate(() => window.__gevLc.open('data-panel'));
await new Promise((r) => setTimeout(r, 1200));
const inf = await page.evaluate(() => window.__gevLc.info('data-panel'));
await page.mouse.move(inf.x + 120, inf.y + 14);
await page.mouse.down();
await new Promise((r) => setTimeout(r, 120));
out.cardDrag = await stats('drag', async () => {
  for (let i = 0; i < 80; i++) {
    await page.mouse.move(inf.x + 120 + Math.round(Math.sin(i / 6) * 120), inf.y + 14 + Math.round(Math.cos(i / 7) * 60));
    await new Promise((r) => setTimeout(r, 12));
  }
});
await page.mouse.up();
out.infoAfterDrag = await page.evaluate(() => window.__gevLc.info('data-panel'));
out.stats = await page.evaluate(() => { const s = window.__gevGlStats(); return { fps: s.fps, scale: s.scale, dev: s.devicePx, count: s.count }; });
fs.writeFileSync(`${SCR}/qa-lg-drag.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
