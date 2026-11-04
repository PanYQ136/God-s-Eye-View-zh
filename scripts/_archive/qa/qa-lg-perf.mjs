#!/usr/bin/env node
/**
 * qa-lg-perf.mjs —— 60fps 证据：GPU 型号 + 静止/展开动画/连续拖动 三种状态帧率（玻璃开/关对比）
 * 用法: node scripts/qa-lg-perf.mjs <url> <label> [lon] [lat] [height] [W] [H]
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const url = process.argv[2] || 'http://localhost:5183/';
const label = process.argv[3] || 'perf';
const lon = Number(process.argv[4] || 116.4), lat = Number(process.argv[5] || 39.9), hgt = Number(process.argv[6] || 14000);
const W = Number(process.argv[7] || 1536), H = Number(process.argv[8] || 730);
const outDir = 'evidence/lg-glass-shots/p0';
fs.mkdirSync(outDir, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', `--window-size=${W},${H}`],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('c:' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 9000));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate((lon, lat, hgt) => {
  try { window.__gevViewer.camera.setView({ destination: window.__CESIUM__.Cartesian3.fromDegrees(lon, lat, hgt), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }); } catch (e) {}
}, lon, lat, hgt);
await new Promise((r) => setTimeout(r, 12000));
// 等瓦片队列空闲（避免把「地图瓦片加载」算到玻璃头上）
await page.evaluate(async () => {
  try {
    const v = window.__gevViewer, s = v.scene, g = s.globe;
    await new Promise((res) => {
      let done = false;
      const to = setTimeout(() => { done = true; res(); }, 25000);
      const off = g.tileLoadProgressEvent.addEventListener((n) => {
        if (n === 0 && !done) { done = true; clearTimeout(to); off(); res(); }
      });
      if (g.tilesLoaded) { done = true; clearTimeout(to); off(); res(); }
    });
  } catch (e) {}
});
await new Promise((r) => setTimeout(r, 2500));

const gpu = await page.evaluate(() => {
  const c = document.createElement('canvas'); const gl = c.getContext('webgl2');
  if (!gl) return 'no-webgl2';
  const d = gl.getExtension('WEBGL_debug_renderer_info');
  return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) + ' | ' + gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : 'no-debug-info';
});

/* 帧采样：rAF 间隔统计（p50/p95/max）+ 玻璃层自身帧计数 */
const meas = async (ms) => page.evaluate(async (ms) => {
  const dts = [];
  let last = performance.now();
  const t0 = last;
  const f0 = window.__gevGlStats ? window.__gevGlStats().frames : 0;
  await new Promise((res) => {
    const tick = () => {
      const n = performance.now(); dts.push(n - last); last = n;
      if (n - t0 < ms) requestAnimationFrame(tick); else res();
    };
    requestAnimationFrame(tick);
  });
  const f1 = window.__gevGlStats ? window.__gevGlStats().frames : 0;
  const el = performance.now() - t0;
  const s = dts.slice(1).sort((a, b) => a - b);
  const q = (p) => +(s[Math.min(s.length - 1, Math.floor(s.length * p))] || 0).toFixed(2);
  return {
    frames: dts.length, ms: Math.round(el),
    rafFps: +((dts.length * 1000) / el).toFixed(1),
    glassFps: +(((f1 - f0) * 1000) / el).toFixed(1),
    p50ms: q(0.5), p95ms: q(0.95), maxms: +(s[s.length - 1] || 0).toFixed(2),
    droppedOver33: s.filter((d) => d > 33.4).length,
  };
}, ms);

const res = {};
res.gpu = gpu;
res.scene = { lon, lat, hgt, viewport: [W, H] };
res.idle = await meas(3000);

// 展开动画期间的帧率（卡片从 header morph 成大卡）
res.duringOpen = await page.evaluate(async () => {
  const dts = []; let last = performance.now();
  const f0 = window.__gevGlStats().frames, t0 = last;
  window.__gevLc.open('data-panel');
  const animNow = window.__gevGlassAnim ? { dur: window.__gevGlassAnim.dur } : null;
  const lens = [];
  await new Promise((res2) => {
    const tick = () => {
      const n = performance.now(); dts.push(n - last); last = n;
      const g = window.__gevGlassAnim;
      lens.push(g ? +(((n - g.t0) / g.dur)).toFixed(2) : -1);
      if (n - t0 < 900) requestAnimationFrame(tick); else res2();
    };
    requestAnimationFrame(tick);
  });
  const f1 = window.__gevGlStats().frames, el = performance.now() - t0;
  const s = dts.slice(1).sort((a, b) => a - b);
  return {
    animAtCall: animNow,
    rafFps: +((dts.length * 1000) / el).toFixed(1), glassFps: +(((f1 - f0) * 1000) / el).toFixed(1),
    p95ms: +(s[Math.floor(s.length * 0.95)] || 0).toFixed(2), maxms: +(s[s.length - 1] || 0).toFixed(2),
    droppedOver33: s.filter((d) => d > 33.4).length,
    lensSamples: lens.filter((v) => v >= 0).length, lensMax: Math.max(...lens),
    lensFirst: lens.slice(0, 6),
  };
});
await new Promise((r) => setTimeout(r, 900));
await page.screenshot({ path: `${outDir}/${label}-morph.png` });
res.duringOpenShot = `${outDir}/${label}-morph.png`;

// 收起 + 连续拖动
await page.evaluate(() => window.__gevLc.close('data-panel'));
await new Promise((r) => setTimeout(r, 900));
res.duringPan = await page.evaluate(async () => {
  const dts = []; let last = performance.now();
  const f0 = window.__gevGlStats().frames, t0 = last;
  const v = window.__gevViewer;
  await new Promise((res2) => {
    const tick = () => {
      const n = performance.now(); dts.push(n - last); last = n;
      v.camera.moveRight(0.0035); v.camera.moveUp(0.001);
      if (n - t0 < 2500) requestAnimationFrame(tick); else res2();
    };
    requestAnimationFrame(tick);
  });
  const f1 = window.__gevGlStats().frames, el = performance.now() - t0;
  const s = dts.slice(1).sort((a, b) => a - b);
  return {
    rafFps: +((dts.length * 1000) / el).toFixed(1), glassFps: +(((f1 - f0) * 1000) / el).toFixed(1),
    p95ms: +(s[Math.floor(s.length * 0.95)] || 0).toFixed(2), maxms: +(s[s.length - 1] || 0).toFixed(2),
    droppedOver33: s.filter((d) => d > 33.4).length,
  };
});

// 玻璃关闭（移除合成层）后的对照：静止 + 同样拖动 → 证明玻璃是不是瓶颈
res.glassOff = await page.evaluate(async () => {
  const cv = document.getElementById('gev-gl-glass');
  if (cv) cv.remove();
  await new Promise((r) => setTimeout(r, 600));
  const run = async (pan) => {
    const dts = []; let last = performance.now(); const t0 = last;
    const v = window.__gevViewer;
    await new Promise((res2) => {
      const tick = () => {
        const n = performance.now(); dts.push(n - last); last = n;
        if (pan) { v.camera.moveRight(0.0035); v.camera.moveUp(0.001); }
        if (n - t0 < 2500) requestAnimationFrame(tick); else res2();
      };
      requestAnimationFrame(tick);
    });
    const el = performance.now() - t0;
    const s = dts.slice(1).sort((a, b) => a - b);
    return { rafFps: +((dts.length * 1000) / el).toFixed(1), p95ms: +(s[Math.floor(s.length * 0.95)] || 0).toFixed(2), droppedOver33: s.filter((d) => d > 33.4).length };
  };
  const idle = await run(false);
  const pan = await run(true);
  return { idle, pan };
});

res.errors = errs;
res.stats = await page.evaluate(() => (window.__gevGlStats ? { fps: window.__gevGlStats().fps, count: window.__gevGlStats().count, scale: window.__gevGlStats().scale } : null));
fs.writeFileSync(`${outDir}/${label}.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
await browser.close();
