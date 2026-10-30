#!/usr/bin/env node
/* Phase6C3 诊断 v5：shader program link 审计
   —— 记录冷启动到 ready+25s 内每次 linkProgram 的耗时，慢的（>15ms）连
      着色器源码特征（#define 行 + 关键字）一起抓下来，用于判定长帧是不是
      「新 shader permutation 首次 link」，以及它属于哪个渲染器（3D Tiles / globe / 大气 / 其它）。
   用法: node scripts/lc/_diag/phase6c3-shader-audit.mjs [tag] [ms]
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] || 'sh1';
const RUN_MS = Number(process.argv[3] || 25000);
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
  window.__sh = { links: [], frames: [], t0: T0, readyAt: null };
  let last = performance.now();
  const tick = (ts) => {
    const dt = ts - last; last = ts;
    window.__sh.frames.push([+(ts - T0).toFixed(1), +dt.toFixed(1)]);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const proto = WebGL2RenderingContext.prototype;
  const origLink = proto.linkProgram;
  const kw = ['czm_globe', 'globeSurface', 'GlobeSurface', 'Atmosphere', 'Cesium3DTiles', 'czm_model',
    'computeNormal', 'atmosphere', 'cumulus', 'waterMask', 'SKY', 'translucent', 'Clamped'];
  proto.linkProgram = function (program) {
    const t0 = performance.now();
    try { return origLink.call(this, program); }
    finally {
      const dt = performance.now() - t0;
      const gl = this;
      let sig = '', defines = [];
      try {
        const shaders = gl.getAttachedShaders(program) || [];
        for (const sh of shaders) {
          const src = gl.getShaderSource(sh) || '';
          defines = defines.concat((src.match(/^#define\s+\w+/gm) || []).slice(0, 14));
          if (!sig) {
            sig = kw.filter((k) => src.indexOf(k) >= 0).join(',');
            sig += ' :: ' + src.split('\n').filter((l) => l.trim() && !l.startsWith('#')).slice(0, 6).join(' / ').slice(0, 260);
          }
        }
      } catch (e) { sig = 'ERR ' + e.message; }
      const v = window.__gevViewer;
      window.__sh.links.push({
        t: +(performance.now() - T0).toFixed(1), dt: +dt.toFixed(1),
        res: v ? +(v.resolutionScale || 0).toFixed(2) : null,
        cw: v && v.canvas ? v.canvas.width : null,
        sig: sig.slice(0, 380), defines: defines.slice(0, 14),
      });
    }
  };
  const origGPP = proto.getProgramParameter;
  proto.getProgramParameter = function (program, pname) {
    const t0 = performance.now();
    try { return origGPP.call(this, program, pname); }
    finally {
      const dt = performance.now() - t0;
      if (dt > 15) {
        let sig = '';
        try {
          const attached = this.getAttachedShaders(program) || [];
          for (const sh of attached) { const src = this.getShaderSource(sh) || ''; sig += src.split('\n').filter((l) => l.trim() && !l.startsWith('#')).slice(0, 4).join(' / ').slice(0, 140) + ' || '; }
        } catch (e) {}
        const v = window.__gevViewer;
        window.__sh.links.push({ t: +(performance.now() - T0).toFixed(1), dt: +dt.toFixed(1), call: 'getProgramParameter', pname, res: v ? +(v.resolutionScale || 0).toFixed(2) : null, cw: v && v.canvas ? v.canvas.width : null, sig: sig.slice(0, 300) });
      }
    }
  };
  const origBuf = proto.getBufferSubData;
  proto.getBufferSubData = function (...a) {
    const t0 = performance.now();
    try { return origBuf.apply(this, a); }
    finally {
      const dt = performance.now() - t0;
      if (dt > 8) window.__sh.links.push({ t: +(performance.now() - T0).toFixed(1), dt: +dt.toFixed(1), call: 'getBufferSubData', len: a[2] && a[2].byteLength });
    }
  };
});

await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
    && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
const readyAt = await page.evaluate(() => { window.__sh.readyAt = +(performance.now() - window.__sh.t0).toFixed(1); return window.__sh.readyAt; });
await sleep(RUN_MS);
const sh = await page.evaluate(() => ({ links: window.__sh.links, frames: window.__sh.frames, readyAt: window.__sh.readyAt }));
const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
await browser.close();
writeFileSync(`${OUT}/shader-${TAG}.json`, JSON.stringify({ gpu, ...sh }, null, 1));

const rel = (t) => +(t - sh.readyAt).toFixed(0);
const post = sh.links.filter((l) => l.t >= sh.readyAt);
const sum = post.filter((l) => !l.call).reduce((a, l) => a + l.dt, 0);
console.log('--- boot/pre-ready 慢事件 (>40ms) ---');
sh.links.filter((l) => l.t < sh.readyAt && l.dt > 40).forEach((l) => console.log(`  t=${l.t}ms ${l.call || 'link'} dt=${l.dt} res=${l.res} cw=${l.cw} ${(l.sig || '').slice(0, 160)}`));
console.log('GPU', gpu && gpu.renderer, '| readyAt', sh.readyAt);
console.log(`post-ready linkProgram 次数 ${post.filter((l) => !l.call).length}，总耗时 ${sum.toFixed(0)}ms；getBufferSubData>8ms ${post.filter((l) => l.call).length} 次`);
console.log('--- post-ready 慢 link (>15ms) ---');
post.filter((l) => l.dt > 15).forEach((l) => console.log(`  rel=+${rel(l.t)}ms ${l.call || 'link'} dt=${l.dt}ms res=${l.res} cw=${l.cw}\n     ${(l.sig || '').slice(0, 220)}\n     ${(l.defines || []).join(' ')}`));
console.log('--- post-ready getBufferSubData>8ms ---');
post.filter((l) => l.call).forEach((l) => console.log(`  rel=+${rel(l.t)}ms ${l.dt}ms len=${l.len}`));
const big = sh.frames.filter((f) => f[0] >= sh.readyAt && f[1] > 60);
console.log('--- post-ready 帧 >60ms ---');
big.forEach(([t, dt]) => {
  const near = sh.links.filter((l) => Math.abs(l.t - t) < 200).map((l) => (l.call || 'link') + ':' + l.dt);
  console.log(`  rel=+${rel(t)}ms dt=${dt}ms near=${JSON.stringify(near)}`);
});
console.log('OUT', `${OUT}/shader-${TAG}.json`);
