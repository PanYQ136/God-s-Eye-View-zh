#!/usr/bin/env node
/* Phase6C3：同一 profile 连续两次冷启动 —— 判定「shader program link 长帧」是否只发生在
   首次访问（Chrome 的 GPU program cache 是否会在第二次命中去掉那 80–100ms link）。
   用法: node scripts/lc/_diag/phase6c3-warm-second-load.mjs [tag]
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] || 'w1';
const W = 1348, VH = 774;
const OUT = '.gev-logs/lc/phase6c3';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${VH + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: VH, deviceScaleFactor: 1 },
});

async function oneLoad(label) {
  const page = await browser.newPage();
  await page.bringToFront().catch(() => {});
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
    try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
    const T0 = performance.now();
    window.__w = { frames: [], gl: [], t0: T0, readyAt: null };
    let last = performance.now();
    const tick = (ts) => { const dt = ts - last; last = ts; window.__w.frames.push([+(ts - T0).toFixed(1), +dt.toFixed(1)]); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const proto = WebGL2RenderingContext.prototype;
    const wrap = (n, th) => {
      const o = proto[n]; if (typeof o !== 'function') return;
      proto[n] = function (...a) {
        const t0 = performance.now();
        try { return o.apply(this, a); } finally {
          const dt = performance.now() - t0;
          if (dt >= th) window.__w.gl.push({ t: +(performance.now() - T0).toFixed(1), call: n, dt: +dt.toFixed(1) });
        }
      };
    };
    wrap('getProgramParameter', 20); wrap('linkProgram', 20); wrap('getBufferSubData', 8);
  });
  await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
  for (let i = 0; i < 150; i++) {
    const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
      && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
    if (ok) break;
    await sleep(400);
  }
  const readyAt = await page.evaluate(() => { window.__w.readyAt = +(performance.now() - window.__w.t0).toFixed(1); return window.__w.readyAt; });
  await sleep(20000);
  const w = await page.evaluate(() => ({ frames: window.__w.frames, gl: window.__w.gl, readyAt: window.__w.readyAt }));
  await page.close();
  const post = w.frames.filter((f) => f[0] >= readyAt);
  const worst = Math.max(...post.map((f) => f[1]));
  const over100 = post.filter((f) => f[1] > 100).length;
  const glPost = w.gl.filter((g) => g.t >= readyAt);
  console.log(`${label}: readyAt=${readyAt} worst=${worst}ms >100=${over100} | post-ready slow GL: ${JSON.stringify(glPost.slice(0, 8))}`);
  return { label, readyAt, worst, over100, glPost, frames: post };
}

const first = await oneLoad('load#1(冷 GPU cache)');
const second = await oneLoad('load#2(同 profile 第二次)');
const gpu = null;
await browser.close();
writeFileSync(`${OUT}/warm-${TAG}.json`, JSON.stringify({ first: { readyAt: first.readyAt, worst: first.worst, over100: first.over100, gl: first.glPost }, second: { readyAt: second.readyAt, worst: second.worst, over100: second.over100, gl: second.glPost } }, null, 1));
console.log('OUT', `${OUT}/warm-${TAG}.json`);
