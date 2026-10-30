#!/usr/bin/env node
/* 交互期 100ms+ 停顿归因：LoAF（long-animation-frame）+ longtask + 逐帧 rAF 间隔。
   用法: node scripts/lc/_diag/fps-loaf-chrome.mjs [--drag-ms=30000]
   输出: .gev-logs/lc/fps-loaf/long.json  （长帧 + 脚本归因 + 帧间隔直方图） */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argOf = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=')[1] : d;
};
const DRAG_MS = Number(argOf('drag-ms', 30000));
const W = 1360;
const H = 782;
const OUT = '.gev-logs/lc/fps-loaf';
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
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break;
  await sleep(400);
}
await sleep(12000);

const cx = Math.round(W * 0.62);
const cy = Math.round(H * 0.42);

// 预热 3s 真拖拽
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
await sleep(1500);

// 装 LoAF + longtask + 帧间隔采样
await page.evaluate(() => {
  window.__L = { loaf: [], long: [], rafs: [], on: true };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__L.loaf.push({
          start: +e.startTime.toFixed(1),
          dur: +e.duration.toFixed(1),
          blocking: +(e.renderStart === 0 ? e.duration : Math.max(0, e.renderStart - e.startTime)).toFixed(1),
          styleLayout: +(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0).toFixed(1),
          scripts: (e.scripts || []).map((s) => ({
            dur: +s.duration.toFixed(1),
            invoker: s.invoker,
            fn: s.sourceFunctionName,
            url: (s.sourceURL || '').split('/').pop(),
            line: s.sourceCharPosition,
          })),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch (err) {
    window.__L.loafError = String(err && err.message);
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__L.long.push({ start: +e.startTime.toFixed(1), dur: +e.duration.toFixed(1), name: e.name });
    }).observe({ type: 'longtask', buffered: true });
  } catch (err) {}
  const tick = (t) => {
    if (!window.__L.on) return;
    window.__L.rafs.push(t);
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
  window.__L.on = false;
  const out = { loaf: window.__L.loaf, long: window.__L.long, rafs: window.__L.rafs, loafError: window.__L.loafError || null };
  const d = window.__gevWorldOverlay && window.__gevWorldOverlay.getDiagnostics ? window.__gevWorldOverlay.getDiagnostics() : null;
  out.overlayDiag = d;
  const det = window.__gevDetection && window.__gevDetection.getDiagnostics ? window.__gevDetection.getDiagnostics() : null;
  out.detectionDiag = det;
  return out;
});

const gaps = [];
for (let i = 1; i < raw.rafs.length; i++) gaps.push(+(raw.rafs[i] - raw.rafs[i - 1]).toFixed(1));
const sorted = gaps.slice().sort((a, b) => a - b);
const q = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
const span = raw.rafs.length > 1 ? raw.rafs[raw.rafs.length - 1] - raw.rafs[0] : 0;
const summary = {
  at: new Date().toISOString(),
  dragMs: DRAG_MS,
  frame: {
    n: gaps.length,
    fps: +((gaps.length / Math.max(1, span)) * 1000).toFixed(2),
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    max: sorted[sorted.length - 1] ?? null,
    over50: sorted.filter((x) => x > 50).length,
    over100: sorted.filter((x) => x > 100).length,
    worst: gaps.map((g, i) => ({ g, i })).sort((a, b) => b.g - a.g).slice(0, 15),
  },
  loafCount: raw.loaf.length,
  loaf: raw.loaf.sort((a, b) => b.dur - a.dur).slice(0, 25),
  longCount: raw.long.length,
  long: raw.long.sort((a, b) => b.dur - a.dur).slice(0, 15),
  loafError: raw.loafError,
  overlayDiag: raw.overlayDiag,
  detectionDiag: raw.detectionDiag,
};
writeFileSync(`${OUT}/long.json`, JSON.stringify({ summary, rawLoaf: raw.loaf, rawLong: raw.long, gaps }, null, 2));
console.log(JSON.stringify(summary, null, 2));
await page.screenshot({ path: `${OUT}/after-drag.png` });
await browser.close();
