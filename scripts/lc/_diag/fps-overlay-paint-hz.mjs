#!/usr/bin/env node
/* 覆盖层实际重绘频率探针：给每个 canvas 的 2D ctx 打 clearRect 计数，
   看 #world-overlay-canvas / #world-overlay-detection-surface 在拖拽期是否
   真的降到 ~30Hz（本轮 MOTION_REPAINT_INTERVAL_MS 修复的验证）。
   用法: node scripts/lc/_diag/fps-overlay-paint-hz.mjs [--drag-ms=8000] */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argOf = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=')[1] : d;
};
const DRAG_MS = Number(argOf('drag-ms', 8000));
const W = 1360;
const H = 782;
const OUT = '.gev-logs/lc/fps-overlay';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox',
    `--window-size=${W + 24},${H + 160}`,
    '--window-position=40,20',
    '--hide-scrollbars',
    '--ignore-gpu-blocklist',
    '--force_high_performance_gpu',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront();
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.clear();
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
  } catch (e) {}
  // 每个 canvas 一个 clearRect 计数器
  window.__C = { clears: new Map(), t0: 0 };
  const orig = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function (...a) {
    const c = this.canvas;
    if (c && c.id) {
      const k = c.id;
      const s = window.__C.clears.get(k) || { n: 0, first: performance.now(), last: 0 };
      s.n += 1;
      s.last = performance.now();
      window.__C.clears.set(k, s);
    }
    return orig.apply(this, a);
  };
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break;
  await sleep(400);
}
await sleep(12000);
const cx = Math.round(W * 0.62);
const cy = Math.round(H * 0.42);
// 预热 3s
await page.mouse.move(cx, cy);
await page.mouse.down();
{
  const t = Date.now();
  let i = 0;
  while (Date.now() - t < 3000) {
    await page.mouse.move(cx + Math.round(Math.sin(i / 12) * 60), cy + Math.round(Math.cos(i / 17) * 36));
    i += 1;
    await sleep(16);
  }
}
await page.mouse.up();
await sleep(1200);

// 采样窗口：同时记录 rAF 帧与每个 canvas 的重绘次数
await page.evaluate(() => {
  window.__M = { rafs: [], on: true };
  window.__C.clears = new Map();
  window.__C.t0 = performance.now();
  const tick = (t) => {
    if (!window.__M.on) return;
    window.__M.rafs.push(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const t0 = Date.now();
let n = 0;
await page.mouse.move(cx, cy);
await page.mouse.down();
while (Date.now() - t0 < DRAG_MS) {
  await page.mouse.move(cx + Math.round(Math.sin(n / 12) * 60), cy + Math.round(Math.cos(n / 17) * 36));
  n += 1;
  await sleep(16);
}
await page.mouse.up();
const raw = await page.evaluate(() => {
  window.__M.on = false;
  const span = (performance.now() - window.__C.t0) / 1000;
  const clears = {};
  for (const [k, v] of window.__C.clears) clears[k] = { n: v.n, hz: +(v.n / span).toFixed(1) };
  const ts = window.__M.rafs;
  const g = [];
  for (let i = 1; i < ts.length; i++) g.push(+(ts[i] - ts[i - 1]).toFixed(2));
  const sorted = g.slice().sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const frameSpan = ts.length > 1 ? ts[ts.length - 1] - ts[0] : 0;
  return {
    spanS: +span.toFixed(2),
    fps: +((g.length / Math.max(1, frameSpan)) * 1000).toFixed(2),
    p50: q(0.5),
    p95: q(0.95),
    max: sorted[sorted.length - 1],
    clears,
  };
});
const out = { at: new Date().toISOString(), dragMs: DRAG_MS, ...raw };
writeFileSync(`${OUT}/paint-hz.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
