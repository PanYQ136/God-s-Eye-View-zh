#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
   Phase5-FPS 验收 Gate（Chrome + RTX 3060，用户口解放宽后）
   ---------------------------------------------------------------------------
   指标（AGENTS.md 2026-10-29「FPS 指标」）：
     · 连续 8s 采样，平均 fps ≥ 50（下界，硬）
     · 单帧间隔 < 100ms（不允许长时间冻结）
     · 任意 1s 滑窗帧数 ≥ 30（不允许掉到 30fps 以下）
     · 上界 ≤ 60：仅在 60Hz 面板可达；165Hz 面板 rAF 恒为刷新率（空白页实测 165），
       因此本脚本对 165Hz 只判下界，并把「≤60」单独列为 panelBound 提示，不伪造 PASS。
     · GPU 必须 RTX 3060，非软件渲染；玻璃参数不得降级（gain 1.0 / dispPx 1.2 / band 10）。
   采样环境：真实鼠标拖拽地图（连续动画）+ 真实点击展开/收起卡片（交互动画），真截图。
   跑法: node scripts/lc/fps-accept-gate.mjs            （默认 3 个 8s 窗口）
        node scripts/lc/fps-accept-gate.mjs --windows=1
   ═══════════════════════════════════════════════════════════════════════════ */
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
const WINDOWS = Number(argOf('windows', 3));
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
  try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {}
});
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break;
  await sleep(400);
}
await sleep(12000);

const env = await page.evaluate(() => {
  const c = document.createElement('canvas');
  const gl = c.getContext('webgl2');
  const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
  const edge = window.__gevEdge && window.__gevEdge.stats ? window.__gevEdge.stats() : null;
  const v = window.__gevViewer;
  return {
    renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : null,
    granted: (window.__gevGpu && window.__gevGpu.state) ? window.__gevGpu.state().granted : null,
    software: (window.__gevGpu && window.__gevGpu.state) ? window.__gevGpu.state().software : null,
    glass: edge ? { gain: edge.gain, dispPx: edge.dispPx, band: edge.band, count: edge.count, lod: edge.lod, only: edge.only, blurPx: edge.blurPx } : null,
    viewer: v ? { targetFrameRate: v.targetFrameRate, resolutionScale: v.resolutionScale, canvas: [v.canvas.width, v.canvas.height] } : null,
    dpr: window.devicePixelRatio, viewport: [window.innerWidth, window.innerHeight],
    cards: document.querySelectorAll('.gev-lc').length,
    visibility: document.visibilityState,
  };
});

const installSampler = () => page.evaluate(() => {
  /* 用唯一 id 作废旧采样链，避免多条 rAF 链重复写入同一数组 */
  const id = (window.__M && window.__M.id ? window.__M.id + 1 : 1);
  window.__M = { id, rafs: [], on: true };
  const mine = window.__M;
  const tick = (t) => { if (!mine.on || window.__M.id !== id) return; mine.rafs.push(t); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

function stats(arr) {
  const g = [];
  for (let i = 1; i < arr.length; i++) g.push(+(arr[i] - arr[i - 1]).toFixed(2));
  const s = g.slice().sort((a, b) => a - b);
  const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
  const span = arr.length > 1 ? arr[arr.length - 1] - arr[0] : 0;
  /* 1s 滑窗最小帧数：跳过前 1s 不完整窗口，否则首帧恒为 1 */
  let minWin = Infinity;
  let i = 0;
  for (let j = 0; j < arr.length; j++) {
    while (arr[j] - arr[i] > 1000) i++;
    if (arr[j] - arr[0] >= 1000) minWin = Math.min(minWin, j - i + 1);
  }
  return {
    n: arr.length, spanMs: +span.toFixed(0),
    fps: span > 0 ? +((g.length / span) * 1000).toFixed(2) : 0,
    p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), p99: +q(0.99).toFixed(2),
    maxGap: s.length ? +s[s.length - 1].toFixed(2) : 0,
    over100ms: s.filter((x) => x > 100).length,
    minFramesIn1s: minWin === Infinity ? null : minWin,
  };
}
const readSampler = () => page.evaluate(() => {
  window.__M.on = false;
  const e = window.__gevEdge.stats();
  return {
    rafs: window.__M.rafs.slice(),
    badge: (document.getElementById('gev-perf-fps') || {}).textContent || null,
    edgeFrames: e.frames, edgeDrawFps: e.drawFps,
    visibility: document.visibilityState,
  };
});

const cx = Math.round(W * 0.62), cy = Math.round(H * 0.42);
const cardBox = await page.evaluate(() => {
  const el = document.querySelector('.gev-lc[data-card="location"]') || document.querySelector('.gev-lc');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + Math.min(r.width / 2, 40)), y: Math.round(r.y + 22), id: el.dataset.card || null };
});

const windows = [];

/* 预热：先真实拖拽 3s，让 Cesium 瓦片流/着色器编译完成，避免把冷启动算进 FPS */
await page.bringToFront();
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

for (let wi = 0; wi < WINDOWS; wi++) {
  const mode = wi % 2 === 0 ? 'pan' : 'morph';
  await page.bringToFront();
  await sleep(1500);
  await installSampler();
  const t0 = Date.now();
  let n = 0;
  if (mode === 'pan') {
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    while (Date.now() - t0 < SAMPLE_MS) {
      await page.mouse.move(cx + Math.round(Math.sin(n / 12) * 60), cy + Math.round(Math.cos(n / 17) * 36));
      n += 1;
      await sleep(16);
    }
    await page.mouse.up();
  } else {
    while (Date.now() - t0 < SAMPLE_MS && cardBox) {
      await page.mouse.click(cardBox.x, cardBox.y);
      n += 1;
      await sleep(700);
    }
  }
  const raw = await readSampler();
  windows.push({ mode, actions: n, ...stats(raw.rafs), badge: raw.badge, edgeFrames: raw.edgeFrames, edgeDrawFps: raw.edgeDrawFps, visibility: raw.visibility });
  await page.screenshot({ path: `${OUT}/gate-w${wi + 1}-${mode}.png` });
}
await page.screenshot({ path: `${OUT}/gate-final.png` });

/* 真实点击展开一张卡，留一张「玻璃在 Chrome 下正常」的证据截图 */
if (cardBox) {
  await page.mouse.click(cardBox.x, cardBox.y);
  await sleep(1200);
  await page.screenshot({ path: `${OUT}/gate-card-open.png` });
}

const G = env.glass || {};
const fpsOk = windows.every((w) => w.fps >= 50);
const stallOk = windows.every((w) => w.maxGap < 100 && w.minFramesIn1s >= 30);
const upper = windows.every((w) => w.fps <= 60);
const assertions = {
  gpu_rtx3060: /RTX\s*3060/i.test(env.renderer || '') && env.software === false,
  fps_ge_50_all_windows: fpsOk,
  no_frame_over_100ms: windows.every((w) => w.over100ms === 0),
  no_drop_below_30fps: windows.every((w) => w.minFramesIn1s >= 30),
  fps_le_60_all_windows: upper,
  glass_gain_1_0: G.gain === 1,
  glass_disp_1_2: G.dispPx === 1.2,
  glass_band_10: G.band === 10,
  glass_single_owner: G.count === 9,
  no_console_errors: errs.length === 0,
};
const judge = {
  hard: ['gpu_rtx3060', 'fps_ge_50_all_windows', 'no_frame_over_100ms', 'no_drop_below_30fps', 'glass_gain_1_0', 'glass_disp_1_2', 'glass_band_10', 'glass_single_owner', 'no_console_errors'],
  panelBound: 'fps_le_60_all_windows',
};
const hardPass = judge.hard.every((k) => assertions[k] === true);
const out = {
  at: new Date().toISOString(), url: URL, env, windows, assertions, judge,
  verdict: hardPass ? 'PASS' : 'FAIL',
  note: upper
    ? '165Hz/60Hz 面板：本次平均 fps 也落在 ≤60 上界内'
    : '面板 165Hz：rAF 恒等于刷新率（空白页实测 165fps），"≤60" 由面板决定、应用不可控；按 ≥50 + 无 >100ms 冻结 + 无掉 30 判定',
  errors: errs.slice(0, 8),
};
writeFileSync(`${OUT}/gate.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
await browser.close();
process.exit(hardPass ? 0 : 1);
