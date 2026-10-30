#!/usr/bin/env node
/* Phase6C3 诊断 v3：逐帧 WebGL 调用耗时分解
   —— 把 >60ms 的帧拆成 texImage2D / linkProgram / readPixels / bufferData / draw 等桶，
   判定长帧是「瓦片纹理上传」「着色器编译」「GPU 读回」还是纯 JS/合成。
   用法: node scripts/lc/_diag/phase6c3-gl-frame-budget.mjs [tag] [ms]
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] || 'g1';
const RUN_MS = Number(process.argv[3] || 30000);
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
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
  const T0 = performance.now();
  window.__gb = { frames: [], cur: null, t0: T0, readyAt: null };

  const NAMES = ['texImage2D', 'texSubImage2D', 'linkProgram', 'compileShader', 'readPixels',
    'bufferData', 'bufferSubData', 'drawElements', 'drawArrays', 'drawElementsInstanced',
    'getProgramParameter', 'checkFramebufferStatus', 'renderbufferStorageMultisample', 'clear'];
  const proto = WebGL2RenderingContext.prototype;
  for (const n of NAMES) {
    const orig = proto[n];
    if (typeof orig !== 'function') continue;
    proto[n] = function (...args) {
      const t0 = performance.now();
      try { return orig.apply(this, args); }
      finally {
        const dt = performance.now() - t0;
        const c = window.__gb.cur;
        if (c) {
          c.gl[n] = (c.gl[n] || 0) + dt;
          c.gln[n] = (c.gln[n] || 0) + 1;
        }
      }
    };
  }
  /* 每帧：rAF 开始时结算上一帧的 GL 耗时分桶 */
  let last = performance.now();
  const tick = (ts) => {
    const prev = window.__gb.cur;
    if (prev) {
      prev.dt = +(ts - prev.start).toFixed(1);
      window.__gb.frames.push(prev);
    }
    window.__gb.cur = { start: ts, t: +(ts - window.__gb.t0).toFixed(1), gl: {}, gln: {} };
    last = ts;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
    && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
const readyAt = await page.evaluate(() => { window.__gb.readyAt = +(performance.now() - window.__gb.t0).toFixed(1); return window.__gb.readyAt; });
await sleep(RUN_MS);
const gb = await page.evaluate(() => ({ frames: window.__gb.frames, readyAt: window.__gb.readyAt }));
const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
await browser.close();

const rel = (t) => +(t - gb.readyAt).toFixed(1);
const post = gb.frames.filter((f) => f.t >= gb.readyAt - 3000 && f.dt > 0);
const big = post.filter((f) => f.dt > 50).map((f) => ({
  rel: rel(f.t), dt: f.dt,
  gl: Object.fromEntries(Object.entries(f.gl).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => [k, +v.toFixed(1)])),
  n: Object.fromEntries(Object.entries(f.gln).sort((a, b) => b[1] - a[1]).slice(0, 5)),
}));
const sum = post.filter((f) => f.t >= 0).map((f) => f.dt);
sum.sort((a, b) => a - b);
const out = {
  tag: TAG, readyAt: gb.readyAt, gpu: gpu && gpu.renderer, frames: post.length,
  p50: sum[Math.floor(sum.length * .5)], p95: sum[Math.floor(sum.length * .95)],
  big,
};
writeFileSync(`${OUT}/glframe-${TAG}.json`, JSON.stringify({ out, raw: gb }, null, 1));
console.log('GPU', out.gpu, '| readyAt', out.readyAt, '| frames', out.frames, '| p50', out.p50, 'p95', out.p95);
console.log('big frames >50ms:');
big.forEach((b) => console.log('  ', JSON.stringify(b)));
console.log('OUT', `${OUT}/glframe-${TAG}.json`);
