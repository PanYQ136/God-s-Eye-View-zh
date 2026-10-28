#!/usr/bin/env node
/**
 * qa-lg-scale.mjs —— 玻璃层分辨率档位 / 升降档路径 / 帧率实测
 * 用法: node scripts/qa-lg-scale.mjs [url]
 * 输出: 每档 canvas 设备像素 + rAF fps + stats.fps + scale 事件时间线
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(OUT, { recursive: true });
const out = { url, errors: [], rows: [] };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => out.errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 14000));

const fps = (ms) => page.evaluate((ms) => new Promise((done) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else done(+(n / ((performance.now() - t0) / 1000)).toFixed(1)); };
  requestAnimationFrame(tick);
}), ms);

const st = () => page.evaluate(() => {
  const s = window.__gevGlStats();
  return { fps: s.fps, scale: s.scale, target: s.scaleTarget, dev: s.devicePx, dpr: s.dpr, avgMs: s.avgMs, count: s.count };
});

out.auto0 = await st();
/* 自动档（不强制）稳定后的状态：先跑 8s 观察升降档 */
await new Promise((r) => setTimeout(r, 8000));
out.auto1 = await st();
out.autoFps = await fps(3000);
out.scaleEvents = await page.evaluate(() => window.__gevGlScale.events());

for (const s of [2.0, 1.5, 1.0]) {
  await page.evaluate((s) => window.__gevGlScale.force(s), s);
  await new Promise((r) => setTimeout(r, 1800));
  const info = await st();
  const f = await fps(2500);
  out.rows.push({ forced: s, ...info, rafFps: f });
}

/* 玻璃关闭基线（同一档 2.0 下） */
await page.evaluate(() => window.__gevGlScale.force(2.0));
await new Promise((r) => setTimeout(r, 1200));
out.glassOnFps2x = await fps(2500);
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = 'none'; });
await new Promise((r) => setTimeout(r, 700));
out.glassOffFps2x = await fps(2500);
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = ''; });
await new Promise((r) => setTimeout(r, 500));

/* 升降档回归：强制降到 0.75，再放开让自适应升回目标档 */
await page.evaluate(() => window.__gevGlScale.force(0.75));
await new Promise((r) => setTimeout(r, 2500));
const low = await st();
let climb = [];
for (let i = 0; i < 14; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  climb.push((await st()).scale);
}
out.downThenUp = { start: low.scale, climb, final: (await st()).scale };
out.events2 = await page.evaluate(() => window.__gevGlScale.events());

fs.writeFileSync(OUT + '/qa-lg-scale.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
