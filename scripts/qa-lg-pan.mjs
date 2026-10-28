#!/usr/bin/env node
/* qa-lg-pan.mjs — 地图拖动 A/B 帧率（玻璃开 vs 关），每档跑 2 轮取中位，归属瓶颈。
   拖动 = 直接改 Cesium 相机（连续 2.5s，每帧 0.02° 经度），与 qa-lg-final 的 pan 同法但重复采样。 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r6';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--window-size=1536,730'] });
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await sleep(15000);
await page.evaluate(() => { const x = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (x) x.click(); });
await sleep(3000);

async function run(glassOn) {
  return await page.evaluate(async (on) => {
    const cv = document.getElementById('gev-gl-glass');
    if (cv) cv.style.display = on ? '' : 'none';
    const v = window.__gevViewer;
    const a = v.camera.positionCartographic;
    let lon = a.longitude, lat = a.latitude, h = a.height;
    const ts = [];
    let last = performance.now();
    const t0 = last;
    await new Promise((res) => {
      const step = () => {
        const now = performance.now();
        ts.push(now - last); last = now;
        lon += 0.00025;
        v.camera.setView({ destination: window.__CESIUM__.Cartesian3.fromRadians(lon, lat, h) });
        v.scene.render();
        if (now - t0 < 2500) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    if (cv) cv.style.display = '';
    const s = ts.slice(5).sort((x, y) => x - y);
    return { n: s.length, p50: +s[Math.floor(s.length / 2)].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), p10: +s[Math.floor(s.length * 0.1)].toFixed(1) };
  }, glassOn);
}

const rounds = [];
for (let i = 0; i < 2; i++) {
  const on = await run(true); await sleep(1500);
  const off = await run(false); await sleep(1500);
  rounds.push({ on, off });
}
const med = (k, side) => rounds.map((r) => r[side].p50).sort((a, b) => a - b)[Math.floor(rounds.length / 2)];
const out = { probe: 'qa-lg-pan', rounds, p50Median: { glassOn: med('p50', 'on'), glassOff: med('p50', 'off') }, fpsMedian: { glassOn: +(1000 / med('p50', 'on')).toFixed(1), glassOff: +(1000 / med('p50', 'off')).toFixed(1) }, glassStats: await page.evaluate(() => { const s = window.__gevGlStats(); return { fps: s.fps, scale: s.scale, dev: s.devicePx }; }), consoleErrors: errs };
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(`${OUT}/pan.json`, JSON.stringify(out, null, 1));
await browser.close();
