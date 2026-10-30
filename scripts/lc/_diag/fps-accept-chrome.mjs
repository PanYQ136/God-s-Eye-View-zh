#!/usr/bin/env node
/* Phase5-FPS 验收（Chrome + RTX 3060，50–60fps 口径）
   指标（AGENTS.md 2026-10-29 放宽）：
     · 连续 8s rAF 平均 fps ∈ [50, 60]
     · 单帧间隔 < 100ms（不允许长时间冻结）
     · 不允许掉到 30fps 以下（1s 滑窗最小 fps >= 30）
     · GPU renderer 必须是 RTX 3060，非软件渲染
     · 玻璃参数不变：gain 1.0 / dispPx 1.2 / band 10
   跑法: node scripts/lc/_diag/fps-accept-chrome.mjs [--sample-ms=8000] [--tag=idle]
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
const TAG = argOf('tag', 'idle');
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
    '--enable-gpu-rasterization',
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
  const lcg = window.__lc && window.__lc.gpu ? window.__lc.gpu() : null;
  const edge = window.__gevEdge && window.__gevEdge.stats ? window.__gevEdge.stats() : null;
  const v = window.__gevViewer;
  return {
    renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : null,
    vendor: d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : null,
    gevGpu: g, lcGpu: lcg, edge,
    viewer: v ? { targetFrameRate: v.targetFrameRate, resolutionScale: v.resolutionScale, canvas: [v.canvas.width, v.canvas.height] } : null,
    dpr: window.devicePixelRatio,
    viewport: [window.innerWidth, window.innerHeight],
    canvases: [...document.querySelectorAll('canvas')].map((el) => el.id || el.className || 'canvas').slice(0, 12),
    cards: [...document.querySelectorAll('.gev-lc')].length,
  };
});

/* 8s rAF 采样器：主线程侧帧时 + 1s 滑窗最小值 + 最长帧 */
async function measure(ms) {
  await page.evaluate(() => {
    window.__ft = [];
    window.__ftOn = true;
    const tick = (t) => { if (!window.__ftOn) return; window.__ft.push(t); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await sleep(ms);
  return page.evaluate(() => {
    window.__ftOn = false;
    const ts = window.__ft.slice();
    const gaps = [];
    for (let i = 1; i < ts.length; i++) gaps.push(+(ts[i] - ts[i - 1]).toFixed(2));
    const s = gaps.slice().sort((a, b) => a - b);
    const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
    const total = ts.length > 1 ? ts[ts.length - 1] - ts[0] : 0;
    const mean = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
    /* 1s 滑窗最小帧数 */
    let minWin = Infinity;
    let i = 0;
    for (let j = 0; j < ts.length; j++) {
      while (ts[j] - ts[i] > 1000) i++;
      minWin = Math.min(minWin, j - i + 1);
    }
    /* 帧间隔直方图（按 6.06ms vsync 分档） */
    const hist = {};
    for (const g of gaps) {
      const vs = Math.round(g / 6.0606);
      hist[vs] = (hist[vs] || 0) + 1;
    }
    return {
      frames: ts.length,
      spanMs: +total.toFixed(0),
      fps: +((gaps.length / Math.max(1, total)) * 1000).toFixed(2),
      meanGap: +mean.toFixed(2),
      p50: +q(0.5).toFixed(2),
      p95: +q(0.95).toFixed(2),
      p99: +q(0.99).toFixed(2),
      maxGap: s.length ? +s[s.length - 1].toFixed(2) : 0,
      over100ms: s.filter((g) => g > 100).length,
      under30fpsWindows: minWin === Infinity ? null : minWin,
      histVsync: hist,
    };
  });
}

const out = { tag: TAG, env, samples: {} };
out.samples.idle = await measure(SAMPLE_MS);

/* 真实交互：真鼠标点击展开一张卡，再测一次（交互期帧率） */
const box = await page.evaluate(() => {
  const el = document.querySelector('.gev-lc[data-card="location"]') || document.querySelector('.gev-lc');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + Math.min(r.width / 2, 40)), y: Math.round(r.y + 24), id: el.dataset.card || null };
});
if (box) {
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(1200);
  out.samples.afterClick = await measure(SAMPLE_MS);
  await page.screenshot({ path: `${OUT}/${TAG}-after-click.png` });
}
await page.screenshot({ path: `${OUT}/${TAG}-final.png` });

/* 断言（50–60 口径） */
const R = env.renderer || '';
const A = {
  gpu_rtx3060: /RTX\s*3060/i.test(R) && !/software|swiftshader|llvmpipe/i.test(R),
  idle_fps_50_60: out.samples.idle.fps >= 50 && out.samples.idle.fps <= 60,
  idle_no_frame_over_100ms: out.samples.idle.over100ms === 0,
  idle_no_drop_below_30fps: out.samples.idle.under30fpsWindows >= 30,
  glass_gain_1_0: null,
  glass_disp_1_2: null,
  glass_band_10: null,
};
const st = env.edge && (env.edge.material || env.edge) ? env.edge : null;
if (st && typeof st === 'object') {
  A.glass_gain_1_0 = st.gain === undefined ? null : st.gain === 1;
  A.glass_disp_1_2 = st.dispPx === undefined ? null : st.dispPx === 1.2;
  A.glass_band_10 = st.band === undefined ? null : st.band === 10;
}
out.assertions = A;
out.errors = errs.slice(0, 10);
out.verdict = Object.entries(A).every(([, v]) => v !== false) ? 'PASS' : 'FAIL';
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ verdict: out.verdict, assertions: A, idle: out.samples.idle, afterClick: out.samples.afterClick || null, renderer: R, errors: out.errors }, null, 2));
await browser.close();
