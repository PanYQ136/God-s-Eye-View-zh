#!/usr/bin/env node
/* Phase6C3 诊断 v4：慢 WebGL 调用的调用栈归因
   —— 对 linkProgram / getBufferSubData / texImage2D / getProgramParameter 计时，
      超过阈值就打一条带 JS 调用栈的记录，用来看清「谁在冷启动里做主线程同步重活」。
   用法: node scripts/lc/_diag/phase6c3-gl-stacks.mjs [tag] [ms]
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] || 's1';
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
  window.__st = { slow: [], frames: [], t0: T0, readyAt: null };
  let fno = 0, last = performance.now();
  const tick = (ts) => {
    window.__st.curFrame = ++fno;
    const dt = ts - last; last = ts;
    window.__st.frames.push([+(ts - T0).toFixed(1), +dt.toFixed(1), fno]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const clip = (s) => String(s || '').split('\n').slice(1, 9).map((l) => l.trim().replace(/^at\s+/, '')).join(' | ');
  const TH = { linkProgram: 20, getProgramParameter: 20, getBufferSubData: 10, texImage2D: 24, readPixels: 10, bufferData: 12 };
  const proto = WebGL2RenderingContext.prototype;
  for (const name of Object.keys(TH)) {
    const orig = proto[name];
    if (typeof orig !== 'function') continue;
    proto[name] = function (...args) {
      const t0 = performance.now();
      try { return orig.apply(this, args); }
      finally {
        const dt = performance.now() - t0;
        if (dt >= TH[name]) {
          const v = window.__gevViewer;
          window.__st.slow.push({
            t: +(performance.now() - T0).toFixed(1), frame: window.__st.curFrame, call: name, dt: +dt.toFixed(1),
            res: v ? +(v.resolutionScale || 0).toFixed(2) : null,
            cw: v && v.canvas ? v.canvas.width : null,
            size: name === 'texImage2D' ? `w=${args[3]} h=${args[4]}` : (name === 'getBufferSubData' ? `len=${args[2] && args[2].byteLength}` : ''),
            stack: clip(new Error().stack),
          });
        }
      }
    };
  }
});

await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
    && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
const readyAt = await page.evaluate(() => { window.__st.readyAt = +(performance.now() - window.__st.t0).toFixed(1); return window.__st.readyAt; });
await sleep(RUN_MS);
const st = await page.evaluate(() => ({ slow: window.__st.slow, frames: window.__st.frames, readyAt: window.__st.readyAt }));
const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
await browser.close();
writeFileSync(`${OUT}/stacks-${TAG}.json`, JSON.stringify({ gpu, readyAt: st.readyAt, slow: st.slow, frames: st.frames }, null, 1));

const rel = (t) => +(t - st.readyAt).toFixed(0);
console.log('GPU', gpu && gpu.renderer, '| readyAt', st.readyAt, '| slow calls', st.slow.length);
const post = st.slow.filter((s) => s.t >= st.readyAt);
const agg = {};
for (const s of post) {
  const k = s.call + ' @ ' + s.stack.split(' | ').slice(0, 4).join(' < ');
  agg[k] = agg[k] || { n: 0, ms: 0, max: 0 };
  agg[k].n++; agg[k].ms += s.dt; agg[k].max = Math.max(agg[k].max, s.dt);
}
console.log('--- post-ready slow calls aggregated (top 25 by total ms) ---');
Object.entries(agg).sort((a, b) => b[1].ms - a[1].ms).slice(0, 25).forEach(([k, v]) =>
  console.log(`  ${v.ms.toFixed(0).padStart(6)}ms n=${String(v.n).padStart(3)} max=${v.max.toFixed(0).padStart(4)}  ${k}`));
console.log('--- post-ready slow calls timeline (top 25 by dt) ---');
post.slice().sort((a, b) => b.dt - a.dt).slice(0, 25).forEach((s) =>
  console.log(`  rel=+${rel(s.t)}ms ${s.call} ${s.dt}ms ${s.size} res=${s.res} ${s.stack.split(' | ').slice(0, 5).join(' < ')}`));
console.log('OUT', `${OUT}/stacks-${TAG}.json`);
