#!/usr/bin/env node
/** qa-lg-hitch.mjs —— 定位展开瞬间的长帧来源（同步耗时 / 首帧 / 后续帧） */
import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto(process.argv[2] || 'http://localhost:5183/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 9000));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => { try { window.__gevViewer.camera.setView({ destination: window.__CESIUM__.Cartesian3.fromDegrees(10, 23, 40000) }); } catch (e) {} });
await new Promise((r) => setTimeout(r, 6000));

const out = await page.evaluate(async () => {
  const marks = {};
  const t0 = performance.now();
  window.__gevLc.open('data-panel');
  marks.syncOpen = +(performance.now() - t0).toFixed(1);
  const raf = (n) => new Promise((res) => { const s = performance.now(); requestAnimationFrame(() => res(+(performance.now() - s).toFixed(1))); });
  marks.raf1 = await raf();
  marks.raf2 = await raf();
  marks.raf3 = await raf();
  // 长任务
  const lt = [];
  const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => lt.push({ start: Math.round(e.startTime - t0), dur: Math.round(e.duration) })));
  try { po.observe({ entryTypes: ['longtask'] }); } catch (e) {}
  await new Promise((r) => setTimeout(r, 800));
  marks.longtasks = lt;
  // 关闭后再开一次（第二次应无首帧栅格化成本）
  window.__gevLc.close('data-panel');
  await new Promise((r) => setTimeout(r, 900));
  const t1 = performance.now();
  window.__gevLc.open('data-panel');
  marks.syncOpen2 = +(performance.now() - t1).toFixed(1);
  const lt2 = [];
  const po2 = new PerformanceObserver((l) => l.getEntries().forEach((e) => lt2.push({ start: Math.round(e.startTime - t1), dur: Math.round(e.duration) })));
  try { po2.observe({ entryTypes: ['longtask'] }); } catch (e) {}
  await new Promise((r) => setTimeout(r, 800));
  marks.longtasks2 = lt2;
  return marks;
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
