#!/usr/bin/env node
/* 探针：Cesium postRender 是否每帧双触发 + 拖拽期间真实渲染节奏 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1360, H = 782;
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront();
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break;
  await sleep(400);
}
await sleep(12000);
const cfg = await page.evaluate(() => {
  const v = window.__gevViewer;
  window.__T = { posts: [], rafs: [] };
  v.scene.postRender.addEventListener(() => window.__T.posts.push(performance.now()));
  const tick = (t) => { window.__T.rafs.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return { tfq: v.targetFrameRate, rrm: v.scene.requestRenderMode, loop: v.useDefaultRenderLoop, rs: v.resolutionScale };
});
const cx = Math.round(W * 0.62), cy = Math.round(H * 0.42);
await page.mouse.move(cx, cy);
await page.mouse.down();
const t0 = Date.now();
let k = 0, moves = 0;
while (Date.now() - t0 < 3000) {
  await page.mouse.move(cx + Math.round(Math.sin(k / 12) * 60), cy + Math.round(Math.cos(k / 17) * 36));
  k++; moves++;
  await sleep(16);
}
await page.mouse.up();
const r = await page.evaluate(() => {
  const g = (a) => { const o = []; for (let i = 1; i < a.length; i++) o.push(+(a[i] - a[i - 1]).toFixed(1)); return o; };
  const dedupe = (a, eps) => { const o = []; for (const t of a) if (!o.length || t - o[o.length - 1] > eps) o.push(t); return o; };
  const s = (a) => a.slice().sort((x, y) => x - y);
  const sp = a => { const q = s(a); return { n: a.length, p50: q[Math.floor(q.length * .5)], p95: q[Math.floor(q.length * .95)], max: q[q.length - 1] }; };
  return {
    postGaps: g(window.__T.posts).slice(0, 30),
    nPosts: window.__T.posts.length, nRaf: window.__T.rafs.length,
    postDedup2: sp(g(dedupe(window.__T.posts, 2))),
    rafStat: sp(g(window.__T.rafs)),
  };
});
console.log(JSON.stringify({ cfg, moves, ...r }, null, 1));
await browser.close();
