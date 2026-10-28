#!/usr/bin/env node
/* _rv5-g-fps.mjs — reviewer round-5 probe G: FPS cross-check.
   The page ships its own counter (#gev-perf-fps). Contract requires >=30fps at 1536x730.
   Read the app's own counter over time AND measure rAF frame intervals, so a disagreement
   between the two cannot hide behind one metric. */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536, H = 730;
const URL = 'http://127.0.0.1:4173/?welcome=0';
const OUT = path.resolve('.gev-logs/review-t829-r5');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {};
const put = (k, v) => { R[k] = v; console.log('##', k, JSON.stringify(v)); };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });

const counter = [];
for (let i = 0; i < 18; i++) {
  await sleep(1000);
  counter.push(await page.evaluate(() => { const el = document.querySelector('#gev-perf-fps'); return el ? el.textContent.trim() : null; }));
}
put('app_counter_per_second', counter);

const raf = [];
for (let k = 0; k < 4; k++) {
  const r = await page.evaluate(async () => {
    const t = []; let last = performance.now(); let n = 0;
    await new Promise((res) => { const tick = (ts) => { t.push(ts - last); last = ts; if (++n < 180) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
    const d = t.slice(3).sort((a, b) => a - b);
    return { median: +(1000 / d[Math.floor(d.length / 2)]).toFixed(1), p95: +(1000 / d[Math.floor(d.length * 0.95)]).toFixed(1), min: +(1000 / d[d.length - 1]).toFixed(1), max: +(1000 / d[0]).toFixed(1) };
  });
  raf.push(r);
}
put('raf_windows', raf);
put('app_counter_tail', counter.slice(-6));
put('raf_median_overall', +(raf.reduce((a, r) => a + r.median, 0) / raf.length).toFixed(1));
await page.screenshot({ path: path.join(OUT, 'G-fps.png') });
fs.writeFileSync(path.join(OUT, 'G-fps.json'), JSON.stringify(R, null, 1));
console.log('WROTE G');
await browser.close();
