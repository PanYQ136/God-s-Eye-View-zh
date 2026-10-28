#!/usr/bin/env node
/**
 * dbg-gpuraster.mjs —— 带 --enable-gpu-rasterization 重测滤镜成本，并输出 GPU 状态摘要
 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = ["--window-position=1900,40",'--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization', '--enable-zero-copy', '--canvas-oop-rasterization', '--window-size=1536,820'];
const browser = await puppeteer.launch({ headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args });
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9500); await page.keyboard.press('Escape'); await sleep(1500);
const gpu = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : (gl ? gl.getParameter(gl.RENDERER) : 'no gl') };
});
const bench = async (label, filter) => {
  await page.evaluate((f) => document.querySelectorAll('.gev-lg-warp').forEach((w) => { w.style.filter = f; }), filter);
  await sleep(800);
  const r = await page.evaluate(async () => {
    const t = [];
    for (let i = 0; i < 50; i++) { const a = performance.now(); await new Promise((r2) => requestAnimationFrame(r2)); t.push(performance.now() - a); }
    t.sort((x, y) => x - y);
    return { median: +t[Math.floor(t.length / 2)].toFixed(1), p95: +t[Math.floor(t.length * 0.95)].toFixed(1) };
  });
  console.log(label.padEnd(30), JSON.stringify(r));
  return { label, ...r };
};
console.log('GPU', JSON.stringify(gpu));
const out = [];
out.push(await bench('none', 'none'));
out.push(await bench('url(#gev-lg-filter) 全滤镜', 'url(#gev-lg-filter)'));
out.push(await bench('none(复测)', 'none'));
// 只给一张卡加滤镜
await page.evaluate(() => {
  document.querySelectorAll('.gev-lg-warp').forEach((w) => { w.style.filter = 'none'; });
  const w = document.querySelector('#data-panel .gev-lg-warp'); if (w) w.style.filter = 'url(#gev-lg-filter)';
});
await sleep(800);
out.push(await bench('只有 data-panel 一张卡带滤镜', 'url(#gev-lg-filter)'));
console.log(JSON.stringify({ gpu, out }));
await browser.close();
