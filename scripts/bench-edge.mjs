#!/usr/bin/env node
/**
 * bench-edge.mjs —— 边缘折射方案基线取证
 *   · GPU / dpr / 卡片 rect & z-index / Cesium 画布可读性
 *   · 基线帧率（当前默认：warp blur6 + 1px CSS 光谱边）
 * 用法：node scripts/bench-edge.mjs [url]
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.argv[2] || 'http://localhost:4173/';
const W = 1536, H = 730;
const OUT = 'evidence/_collab/t_9739e3a7';
fs.mkdirSync(OUT, { recursive: true });

const args = [
  '--window-position=1900,40', '--no-sandbox', '--enable-gpu', '--use-angle=d3d11',
  '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-zero-copy',
  '--canvas-oop-rasterization', '--window-size=1536,820',
];
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args,
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(m.text().slice(0, 200)));
page.on('pageerror', (e) => logs.push('ERR ' + String(e).slice(0, 200)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9500);
await page.keyboard.press('Escape');
await sleep(1500);

const info = await page.evaluate(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
    'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
  const cards = ids.map((id) => {
    const el = document.getElementById(id);
    if (!el) return { id, missing: true };
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const chain = [];
    let n = el;
    while (n && n !== document.body && chain.length < 6) {
      const c = getComputedStyle(n);
      chain.push((n.id ? '#' + n.id : n.className.toString().split(' ')[0] || n.tagName) + ':z=' + c.zIndex + ',pos=' + c.position);
      n = n.parentElement;
    }
    return {
      id, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      z: cs.zIndex, pos: cs.position, radius: cs.borderTopLeftRadius, chain,
    };
  });
  const gl = (() => {
    const c = document.createElement('canvas');
    const g = c.getContext('webgl2') || c.getContext('webgl');
    const d = g && g.getExtension('WEBGL_debug_renderer_info');
    return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : (g ? g.getParameter(g.RENDERER) : 'no gl');
  })();
  // Cesium 画布可读性（preserveDrawingBuffer 关掉时 drawImage 可能全黑）
  let readable = null, size = null;
  const v = window.__gevViewer;
  if (v && v.canvas) {
    size = [v.canvas.width, v.canvas.height];
    try {
      const t = document.createElement('canvas'); t.width = 32; t.height = 32;
      const x = t.getContext('2d'); x.drawImage(v.canvas, 0, 0, 32, 32);
      const d = x.getImageData(0, 0, 32, 32).data; let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      readable = +(s / (d.length / 4 * 3)).toFixed(1);
    } catch (e) { readable = 'err:' + e.message; }
  }
  return {
    dpr: window.devicePixelRatio, gl, cardCount: document.querySelectorAll('.gev-lc').length,
    warpCount: document.querySelectorAll('.gev-lg-warp').length,
    rimCount: document.querySelectorAll('.gev-lg-rim').length,
    cesium: { size, readable },
    lensSvg: document.documentElement.className,
    cards,
  };
});

async function fps(label, ms = 2600) {
  const r = await page.evaluate(async (ms) => {
    const t = []; const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const a = performance.now();
      await new Promise((res) => requestAnimationFrame(res));
      t.push(performance.now() - a);
    }
    t.sort((x, y) => x - y);
    const p = (q) => +t[Math.floor(t.length * q)].toFixed(2);
    return { n: t.length, p50: p(0.5), p90: p(0.9), p99: p(0.99), fps50: +(1000 / p(0.5)).toFixed(1), fps90: +(1000 / p(0.9)).toFixed(1) };
  }, ms);
  console.log(label.padEnd(34), JSON.stringify(r));
  return r;
}

const base = await fps('baseline (css only)');
await page.screenshot({ path: `${OUT}/base-collapsed.png` });

// 展开 data-panel 后再测
const expand = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  return true;
});
await sleep(1400);
const rectAfter = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const r = el.getBoundingClientRect();
  return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
});
const baseExp = await fps('baseline (data-panel expanded)');
await page.screenshot({ path: `${OUT}/base-expanded.png` });

const out = { url: URL, info, expand, rectAfter, base, baseExp, logs: logs.slice(-25) };
fs.writeFileSync(`${OUT}/bench-baseline.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ dpr: info.dpr, gl: info.gl, cesium: info.cesium, cardCount: info.cardCount, rectAfter, base, baseExp }, null, 1));
await browser.close();
