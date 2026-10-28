#!/usr/bin/env node
/** qa-lg-stats.mjs —— 快速读取玻璃层运行状态（GPU 计时 / 分辨率档 / 面数 / 配置） */
import puppeteer from 'puppeteer';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const wait = +(process.argv[3] || 14000);
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
await new Promise((r) => setTimeout(r, wait));
const out = await page.evaluate(() => {
  const s = window.__gevGlStats();
  return {
    fps: s.fps, scale: s.scale, target: s.scaleTarget, dev: s.devicePx, dpr: s.dpr,
    gpuMs: s.gpuMs, timerQuery: s.timerQuery, avgMs: s.avgMs, p90: s.p90,
    count: s.count, events: s.scaleEvents, config: s.config, html: document.documentElement.dataset.gevGlassLum,
    surfaces: s.surfaces.map((x) => [x.id, x.variant, x.lum, x.bezel, x.rect.join(',')]),
  };
});
console.log(JSON.stringify(out, null, 1));
console.log('errors=' + JSON.stringify(errs.slice(0, 4)));
await browser.close();
