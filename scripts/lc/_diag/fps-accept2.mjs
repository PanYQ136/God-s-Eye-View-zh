#!/usr/bin/env node
/* Phase5-FPS 验收 v2（Chrome + RTX 3060，50–60fps 口径）
   指标定义（关键）：FPS = **应用实际绘制帧率**（Cesium scene.postRender 真实渲染次数，
   以及玻璃层 draw 次数），rAF 单独记录仅供参考（165Hz 屏上 rAF 恒等于刷新率，不反映 App）。
   采样窗口：8s 真实鼠标拖拽地图（持续动画）+ 8s 真实点击展开/收起卡片（交互动画）。
   判定：平均 fps ∈ [50,60]；maxGap < 100ms；1s 滑窗最小帧数 >= 30；GPU = RTX 3060；玻璃参数未降级。
   跑法: node scripts/lc/_diag/fps-accept2.mjs [--sample-ms=8000] [--tag=v2]
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = process.env.LC_URL || 'http://127.0.0.1:4173/';
const W = Number(process.env.LC_W || 1360);
const H = Number(process.env.LC_H || 782);
const argOf = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split('=')[1] : d;
};
const SAMPLE_MS = Number(argOf('sample-ms', 8000));
const TAG = argOf('tag', 'v2');
const OUT = '.gev-logs/lc/fps-accept';
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
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 200)));
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

const env = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
  const g = window.__gevGpu && window.__gevGpu.state ? window.__gevGpu.state() : null;
  const edge = window.__gevEdge && window.__gevEdge.stats ? window.__gevEdge.stats() : null;
  const v = window.__gevViewer;
  return {
    renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : null,
    gpuGranted: g ? g.granted : null, gpuSoftware: g ? g.software : null, gpuTier: g ? g.tier : null,
    glass: edge ? { gain: edge.gain, dispPx: edge.dispPx, band: edge.band, count: edge.count, lod: edge.lod, only: edge.only } : null,
    viewer: v ? { targetFrameRate: v.targetFrameRate, resolutionScale: v.resolutionScale, requestRenderMode: v.scene.requestRenderMode, canvas: [v.canvas.width, v.canvas.height] } : null,
    dpr: window.devicePixelRatio, viewport: [window.innerWidth, window.innerHeight],
    cards: document.querySelectorAll('.gev-lc').length,
  };
});

/* 页面内采样器：postRender（真实渲染帧）+ rAF（刷新率）+ 玻璃 draw */
await page.evaluate(() => {
  const v = window.__gevViewer;
  window.__P = { posts: [], rafs: [], on: true, edge0: null };
  v.scene.postRender.addEventListener(() => { if (window.__P.on) window.__P.posts.push(performance.now()); });
  const tick = (t) => { if (!window.__P.on) return; window.__P.rafs.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

function stats(arr) {
  const g = [];
  for (let i = 1; i < arr.length; i++) g.push(+(arr[i] - arr[i - 1]).toFixed(2));
  const s = g.slice().sort((a, b) => a - b);
  const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
  const span = arr.length > 1 ? arr[arr.length - 1] - arr[0] : 0;
  let minWin = Infinity, i = 0;
  for (let j = 0; j < arr.length; j++) { while (arr[j] - arr[i] > 1000) i++; minWin = Math.min(minWin, j - i + 1); }
  return {
    n: arr.length, fps: span > 0 ? +((g.length / span) * 1000).toFixed(2) : 0,
    p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2),
    maxGap: s.length ? +s[s.length - 1].toFixed(2) : 0,
    over100ms: s.filter((x) => x > 100).length,
    minFramesIn1s: minWin === Infinity ? null : minWin,
  };
}

const readP = () => page.evaluate(() => {
  window.__P.on = false;
  const e = window.__gevEdge.stats();
  return { posts: window.__P.posts.slice(), rafs: window.__P.rafs.slice(), edgeFrames: e.frames, edgeDrawFps: e.drawFps };
});
const startP = () => page.evaluate(() => {
  window.__P = { posts: [], rafs: [], on: true };
  window.__gevViewer.scene.postRender.addEventListener(() => { if (window.__P.on) window.__P.posts.push(performance.now()); });
  const tick = (t) => { if (!window.__P.on) return; window.__P.rafs.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

const out = { tag: TAG, env, samples: {}, errors: errs };
const cx = Math.round(W * 0.62), cy = Math.round(H * 0.42);

/* ── 采样 1：8s 真实鼠标拖拽地图（连续动画） ─────────────────── */
await startP();
const t0 = Date.now();
await page.mouse.move(cx, cy);
await page.mouse.down();
let k = 0;
while (Date.now() - t0 < SAMPLE_MS) {
  const dx = Math.round(Math.sin(k / 12) * 60);
  const dy = Math.round(Math.cos(k / 17) * 36);
  await page.mouse.move(cx + dx, cy + dy);
  k += 1;
  await sleep(16);
}
await page.mouse.up();
out.samples.pan = await readP();
await page.screenshot({ path: `${OUT}/${TAG}-pan.png` });

/* ── 采样 2：8s 真实点击展开/收起（交互动画） ───────────────── */
const cardBox = await page.evaluate(() => {
  const el = document.querySelector('.gev-lc[data-card="location"]') || document.querySelector('.gev-lc');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + Math.min(r.width / 2, 40)), y: Math.round(r.y + 22), id: el.dataset.card || null };
});
await sleep(1500);
await startP();
const t1 = Date.now();
let clickN = 0;
while (Date.now() - t1 < SAMPLE_MS && cardBox) {
  await page.mouse.click(cardBox.x, cardBox.y);
  clickN += 1;
  await sleep(700);
}
out.samples.morph = await readP();
out.clickN = clickN;
await page.screenshot({ path: `${OUT}/${TAG}-morph.png` });

/* ── 采样 3：空转 8s（可选，记录 rAF 与渲染分离现象） ───────── */
await sleep(1200);
await startP();
await sleep(SAMPLE_MS);
out.samples.idle = await readP();

out.pan = { cesium: stats(out.samples.pan.posts), raf: stats(out.samples.pan.rafs), edgeFrames: out.samples.pan.edgeFrames };
out.morph = { cesium: stats(out.samples.morph.posts), raf: stats(out.samples.morph.rafs), edgeFrames: out.samples.morph.edgeFrames };
out.idle = { cesium: stats(out.samples.idle.posts), raf: stats(out.samples.idle.rafs), edgeFrames: out.samples.idle.edgeFrames };
delete out.samples;

const inBand = (s) => s.fps >= 50 && s.fps <= 60;
const clean = (s) => s.maxGap < 100 && s.minFramesIn1s >= 30;
const glass = env.glass || {};
out.assertions = {
  gpu_rtx3060: /RTX\s*3060/i.test(env.renderer || '') && env.gpuSoftware === false,
  pan_fps_50_60: inBand(out.pan.cesium),
  pan_no_stall: clean(out.pan.cesium),
  pan_p95_le_16_7: out.pan.cesium.p95 <= 16.7,
  morph_fps_50_60: inBand(out.morph.cesium),
  morph_no_stall: clean(out.morph.cesium),
  glass_gain: glass.gain === 1, glass_disp: glass.dispPx === 1.2, glass_band: glass.band === 10,
  glass_single_owner: glass.count === 9,
  no_console_errors: (out.errors || []).length === 0,
};
out.verdict = Object.values(out.assertions).every((v) => v === true) ? 'PASS' : 'FAIL';
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ verdict: out.verdict, assertions: out.assertions, pan: out.pan, morph: out.morph, idle: out.idle, env, errors: out.errors.slice(0, 6) }, null, 2));
await browser.close();
