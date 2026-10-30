#!/usr/bin/env node
/* Phase4A FPS 归因探针：off / on / 单面 / cap 四组对照 + 主线程响应度
   跑法: node scripts/lc/_diag/fps4a.mjs             (需要 127.0.0.1:4173)
        node scripts/lc/_diag/fps4a.mjs --full       (8s 采样) */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = process.env.LC_URL || 'http://127.0.0.1:4173/';
const W = 1536, H = 730;
const FULL = process.argv.includes('--full');
const SAMPLE_MS = FULL ? 8000 : 3000;
const OUT = '.gev-logs/lc';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox',
    `--window-size=${W + 24},${H + 160}`,
    '--window-position=40,20',
    '--hide-scrollbars',
    '--ignore-gpu-blocklist',
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
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 180)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 180)));
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.clear();
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
  } catch (e) {}
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  const ready = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ready) break;
  await sleep(400);
}
await sleep(12000);

/* 独立 rAF 帧时采集器（页面主线程侧；不等于合成帧，但主线程卡死时同样塌） */
const installSampler = () => page.evaluate(() => {
  window.__ft = [];
  window.__sampleOn = true;
  const tick = (t) => { if (!window.__sampleOn) return; window.__ft.push(t); if (window.__ft.length > 8000) window.__ft.shift(); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

async function measure(tag, setup) {
  if (setup) await page.evaluate(setup);
  await sleep(700);
  await installSampler();
  const t0 = Date.now();
  /* 主线程响应度：3 次 evaluate 往返耗时（卡死时 >1s） */
  const rtt = [];
  for (let i = 0; i < 3; i++) {
    const a = Date.now();
    await page.evaluate(() => 1 + 1);
    rtt.push(Date.now() - a);
    await sleep(200);
  }
  await sleep(Math.max(0, SAMPLE_MS - (Date.now() - t0)));
  const out = await page.evaluate(() => {
    window.__sampleOn = false;
    const ts = window.__ft.slice();
    const gaps = [];
    for (let i = 1; i < ts.length; i++) gaps.push(+(ts[i] - ts[i - 1]).toFixed(2));
    const s = gaps.slice().sort((a, b) => a - b);
    const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
    const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
    return {
      frames: gaps.length,
      avgFps: avg ? +(1000 / avg).toFixed(1) : 0,
      p50: q(0.5), p95: q(0.95), max: s.length ? s[s.length - 1] : 0,
      edge: (window.__gevEdge && window.__gevEdge.stats) ? (() => { const e = window.__gevEdge.stats(); return { fps: e.fps, p50: e.p50, p90: e.p90, frames: e.frames, skip: e.skip, count: e.count, tex: e.tex, scale: e.scale, canvas: e.canvas, err: e.err }; })() : null,
    };
  });
  return { tag, elapsedMs: Date.now() - t0, evalRttMs: rtt, ...out };
}

const base = await page.evaluate(() => ({
  renderer: (() => { try { return window.__gevEdge ? window.__gevEdge.stats().renderer : null; } catch (e) { return null; } })(),
  gpuTier: (() => { try { return window.__lc.api.gpu(); } catch (e) { return null; } })(),
  edge: (() => { try { const e = window.__gevEdge.stats(); return { band: e.band, dispPx: e.dispPx, gain: e.gain, ior: e.ior, count: e.count, canvas: e.canvas, scale: e.scale, tex: e.tex, err: e.err, fps: e.fps }; } catch (e) { return null; } })(),
  mode: (() => { try { return window.__gevEdgeLens && window.__gevEdgeLens.mode; } catch (e) { return null; } })(),
  perfMode: localStorage.getItem('gev.perfMode'),
  canvases: document.querySelectorAll('canvas').length,
  hasLens: !!document.getElementById('gev-edge-lens'),
}));
console.log('BASE ' + JSON.stringify(base));

const rows = [];
rows.push(await measure('as-is'));
rows.push(await measure('edge-off', () => { window.__gevEdge.off(); }));
rows.push(await measure('edge-on', () => { window.__gevEdge.on(); }));
rows.push(await measure('edge-on-only1', () => { window.__gevEdge.only(['data-panel']); }));
rows.push(await measure('edge-on-all', () => { window.__gevEdge.only(null); }));
rows.push(await measure('edge-cap60', () => { window.__gevEdge.cap(60); }));
rows.push(await measure('edge-cap30', () => { window.__gevEdge.cap(30); }));

for (const r of rows) console.log(r.tag.padEnd(16), JSON.stringify(r));
writeFileSync(`${OUT}/fps4a.json`, JSON.stringify({ base, rows, errs }, null, 2));
console.log('ERRS ' + JSON.stringify(errs.slice(0, 8)));
await browser.close();
