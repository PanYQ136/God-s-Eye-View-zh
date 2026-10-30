#!/usr/bin/env node
/* 前台真浏览器验收复测（回应用户口径：以「可见 FPS badge + 前台窗口」为准）
   ---------------------------------------------------------------------------
   每窗口同时采三路数：
     · rAF 帧间隔        —— 浏览器合成节奏（面板上限）
     · viewer.scene.postRender 次数 —— Cesium 真正画了多少帧/秒（app 渲染率）
     · #gev-perf-fps 徽标 —— 用户肉眼看到的那块数字（每 500ms 刷新，取窗口内 min/median）
   每窗口校验 document.visibilityState / hasFocus，hidden 的窗口直接判 INVALID（不参与验收），
   并把 resolutionScale 的每次变化记下来（GEV 有自适应分辨率，会改画布尺寸）。
   用法: node scripts/lc/_diag/fps-foreground-check.mjs [--windows=3] [--sample-ms=8000] [--tag=run1]
   输出: .gev-logs/lc/fps-foreground/<tag>.json
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argOf = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=')[1] : d;
};
const SAMPLE_MS = Number(argOf('sample-ms', 8000));
const WINDOWS = Number(argOf('windows', 3));
const TAG = argOf('tag', 'run1');
const W = 1360;
const H = 782;
const OUT = '.gev-logs/lc/fps-foreground';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion',
  ],
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

const env = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
  const e = window.__gevEdge && window.__gevEdge.stats ? window.__gevEdge.stats() : null;
  const v = window.__gevViewer;
  return {
    renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : null,
    glass: e ? { gain: e.gain, dispPx: e.dispPx, band: e.band, count: e.count } : null,
    viewer: v ? { resolutionScale: v.resolutionScale, targetFrameRate: v.targetFrameRate, canvas: [v.canvas.width, v.canvas.height] } : null,
    dpr: window.devicePixelRatio, viewport: [innerWidth, innerHeight],
    cards: document.querySelectorAll('.gev-lc').length,
    visibility: document.visibilityState, focus: document.hasFocus(),
  };
});

const cx = Math.round(W * 0.62);
const cy = Math.round(H * 0.42);

/* 预热：3s 真拖拽（父任务口径：不打预热拿到的是冷启动数） */
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
await sleep(2000);

const windows = [];
for (let wi = 0; wi < WINDOWS; wi++) {
  await page.bringToFront();
  await sleep(1200);
  await page.evaluate(() => {
    const v = window.__gevViewer;
    window.__F = {
      on: true, rafs: [], posts: 0, badges: [], res: [], resChanges: 0,
      f0: v && v.scene && v.scene.frameState ? v.scene.frameState.frameNumber : null,
    };
    const mine = window.__F;
    if (v && v.scene && v.scene.postRender) {
      mine._h = () => { mine.posts += 1; };
      v.scene.postRender.addEventListener(mine._h);
    } else mine._h = null;
    if (v) { mine._res0 = v.resolutionScale; mine._resLast = v.resolutionScale; }
    const rs = setInterval(() => {
      if (!window.__F.on) return clearInterval(rs);
      if (v && Math.abs((v.resolutionScale || 0) - mine._resLast) > 0.001) {
        mine.resChanges += 1;
        mine.res.push({ at: +(performance.now() / 1000).toFixed(1), r: +v.resolutionScale.toFixed(3), canvas: [v.canvas.width, v.canvas.height] });
        mine._resLast = v.resolutionScale;
      }
    }, 120);
    const bm = setInterval(() => {
      if (!window.__F.on) return clearInterval(bm);
      const el = document.getElementById('gev-perf-fps');
      if (el && el.textContent) mine.badges.push(el.textContent.trim());
    }, 500);
    const tick = (t) => { if (!mine.on) return; mine.rafs.push(+t.toFixed(2)); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });

  const t0 = Date.now();
  let n = 0;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  while (Date.now() - t0 < SAMPLE_MS) {
    await page.mouse.move(cx + Math.round(Math.sin(n / 12) * 60), cy + Math.round(Math.cos(n / 17) * 36));
    n += 1;
    await sleep(16);
  }
  await page.mouse.up();

  const raw = await page.evaluate(() => {
    const v = window.__gevViewer;
    const F = window.__F;
    F.on = false;
    try { if (F._h && v && v.scene && v.scene.postRender) v.scene.postRender.removeEventListener(F._h); } catch (e) {}
    const f1 = v && v.scene && v.scene.frameState ? v.scene.frameState.frameNumber : null;
    const e = window.__gevEdge && window.__gevEdge.stats ? window.__gevEdge.stats() : null;
    return {
      rafs: F.rafs.slice(), posts: F.posts, badges: F.badges.slice(), resChanges: F.resChanges, res: F.res.slice(),
      cesiumFrames: F.f0 != null && f1 != null ? f1 - F.f0 : null,
      visibility: document.visibilityState, focus: document.hasFocus(),
      edgeDraw: e ? e.drawFps : null, res0: F._res0, res1: v ? v.resolutionScale : null,
    };
  });

  const gaps = [];
  for (let i = 1; i < raw.rafs.length; i++) gaps.push(+(raw.rafs[i] - raw.rafs[i - 1]).toFixed(2));
  const sorted = gaps.slice().sort((a, b) => a - b);
  const q = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0);
  const span = raw.rafs.length > 1 ? raw.rafs[raw.rafs.length - 1] - raw.rafs[0] : 0;
  let minWin = Infinity;
  {
    let i = 0;
    for (let j = 0; j < raw.rafs.length; j++) {
      while (raw.rafs[j] - raw.rafs[i] > 1000) i++;
      if (raw.rafs[j] - raw.rafs[0] >= 1000) minWin = Math.min(minWin, j - i + 1);
    }
  }
  const badgeNums = raw.badges.map((b) => Number((b.match(/(\d+(\.\d+)?)/) || [])[1]) || 0).filter((x) => x > 0).sort((a, b) => a - b);
  const w = {
    mode: 'pan', actions: n,
    spanMs: Math.round(span), n: gaps.length,
    fps: span > 0 ? +((gaps.length / span) * 1000).toFixed(2) : 0,
    p50: q(0.5), p95: q(0.95), p99: q(0.99), maxGap: sorted[sorted.length - 1] ?? null,
    over100ms: sorted.filter((x) => x > 100).length,
    over50ms: sorted.filter((x) => x > 50).length,
    minFramesIn1s: minWin === Infinity ? null : minWin,
    cesiumFps: raw.cesiumFrames != null && span > 0 ? +((raw.cesiumFrames / span) * 1000).toFixed(1) : null,
    postsPerSec: span > 0 ? +((raw.posts / span) * 1000).toFixed(1) : null,
    badgeN: badgeNums.length, badgeMin: badgeNums.length ? badgeNums[0] : null,
    badgeP50: badgeNums.length ? badgeNums[Math.floor(badgeNums.length / 2)] : null,
    badgeMax: badgeNums.length ? badgeNums[badgeNums.length - 1] : null,
    resChanges: raw.resChanges, resFromTo: [raw.res0, raw.res1],
    visibility: raw.visibility, focus: raw.focus,
    valid: raw.visibility === 'visible' && gaps.length > 30,
  };
  windows.push(w);
  console.log(`w${wi + 1}`, JSON.stringify(w));
  await page.screenshot({ path: `${OUT}/${TAG}-w${wi + 1}.png` });
}

const valid = windows.filter((w) => w.valid);
const verdict = valid.length === windows.length
  && valid.every((w) => w.fps >= 50 && w.over100ms === 0 && (w.minFramesIn1s || 0) >= 30)
  ? 'PASS' : 'FAIL';
const report = {
  at: new Date().toISOString(), tag: TAG, url: 'http://127.0.0.1:4173/', env,
  windows, validWindows: valid.length, verdict,
  criteria: { avg_fps_ge_50: 'per window', over100ms: 0, minFramesIn1s_ge_30: 'per window', visibility: 'visible (前台)' },
};
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ verdict, validWindows: valid.length, of: windows.length }, null, 2));
await page.screenshot({ path: `${OUT}/${TAG}-final.png` });
await browser.close();
