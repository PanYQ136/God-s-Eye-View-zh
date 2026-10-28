#!/usr/bin/env node
/** qa-lg-anim-frozen.mjs —— 冻结 Cesium 渲染循环后测展开/收起帧时（排除瓦片流式加载噪声） */
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
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 16000));
await page.evaluate(() => {
  window.__ft = []; let last = performance.now();
  const tick = (t) => { window.__ft.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const runOnce = async () => page.evaluate(async () => {
  const ft0 = window.__ft.length;
  const lens = [];
  window.__gevLc.open('data-panel');
  const t0 = performance.now();
  let stop = false;
  const watch = setInterval(() => { const g = window.__gevGlassAnim; if (g) lens.push(+(((performance.now() - g.t0) / g.dur)).toFixed(2)); }, 20);
  await new Promise((r) => setTimeout(r, 700));
  window.__gevLc.close('data-panel');
  await new Promise((r) => setTimeout(r, 700));
  clearInterval(watch);
  const ft = window.__ft.slice(ft0).sort((a, b) => a - b);
  const q = (p) => +(ft[Math.min(ft.length - 1, Math.floor(p * ft.length))] || 0).toFixed(1);
  return { frames: ft.length, p50: q(0.5), p90: q(0.9), p95: q(0.95), max: +ft[ft.length - 1].toFixed(1), over20: ft.filter((v) => v > 20).length, fpsP50: Math.round(1000 / q(0.5)), lensFrames: lens.length };
});
const out = { url, errors: errs, frozen: [], live: [] };
out.live.push(await runOnce());
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 2000));
for (let i = 0; i < 3; i++) out.frozen.push(await runOnce());
const st = await page.evaluate(() => { const s = window.__gevGlStats(); return { fps: s.fps, scale: s.scale, dev: s.devicePx, count: s.count, p90: s.p90 }; });
out.stats = st;
fs.writeFileSync(`${SCR}/qa-lg-anim-frozen.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
