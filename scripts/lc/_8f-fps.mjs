#!/usr/bin/env node
/* Phase8F：启动可点口径 + 稳态 3×8s FPS 窗（每个窗口都报，取稳态；只读）
   用法: node scripts/lc/_8f-fps.mjs <url> <outPrefix> */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:4175/?welcome=0';
const OUT = process.argv[3] || '.gev-logs/lc/phase8f/shot/8f';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__lc && window.__lc.api && window.__lc.api.mounted), { timeout: 120000 }).catch(() => {});
const lcMountedMs = Date.now() - t0;
await page.waitForFunction(() => {
  const el = document.querySelector('#loading-screen');
  return !el || el.classList.contains('hidden') || getComputedStyle(el).display === 'none' || Number(getComputedStyle(el).opacity) < 0.05;
}, { timeout: 90000 }).catch(() => {});
const maskGoneMs = Date.now() - t0;
const boot = await page.evaluate(() => ({
  inputReleased: globalThis.__gevBoot?.inputReleased ?? null,
  state: globalThis.__gevBoot?.state ?? null,
  marks: globalThis.__bootTimeline?.marks?.() || globalThis.__bootTimeline?.entries?.() || null,
}));

const win = async () => page.evaluate(async () => {
  const frames = []; let last = performance.now(); const end = last + 8000;
  await new Promise((done) => { const tick = (t) => { frames.push(t - last); last = t; if (t >= end) done(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  frames.shift();
  const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
  const s = [...frames].sort((a, b) => a - b);
  return { fps: +(1000 / mean).toFixed(1), p50: +s[Math.floor(s.length / 2)].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), worst: +s[s.length - 1].toFixed(1), long100: frames.filter((f) => f > 100).length };
});

const wins = [];
for (let i = 0; i < 3; i++) { await sleep(3000); wins.push({ i, at: Date.now() - t0, ...(await win()) }); }

const after = await page.evaluate(() => ({
  photoreal: !!globalThis.__gevPhotoreal?.ready,
  resScale: globalThis.__godsEyeView?.viewer?.resolutionScale ?? null,
  canvas: (() => { const c = document.querySelector('canvas.cesium-widget canvas, #cesiumContainer canvas'); return c ? { w: c.width, h: c.height } : null; })(),
  webgl: (() => { const gl = document.createElement('canvas').getContext('webgl'); const d = gl && gl.getExtension('WEBGL_debug_renderer_info'); return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; })(),
}));

await page.mouse.move(700, 400); await sleep(400);
await page.screenshot({ path: `${OUT}-steady-1x.png` });
const box = await page.evaluate(() => {
  const el = document.querySelector('#control-panel') || document.querySelector('.gev-lc');
  if (!el) return null; const r = el.getBoundingClientRect();
  return { x: Math.max(0, Math.round(r.x - 10)), y: Math.max(0, Math.round(r.y - 10)), w: Math.min(Math.round(r.width + 20), innerWidth), h: Math.min(Math.round(r.height + 20), innerHeight) };
});
if (box) await page.screenshot({ path: `${OUT}-steady-card-1x.png`, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });

const out = { lcMountedMs, maskGoneMs, boot, wins, after, errors: errors.slice(0, 8) };
writeFileSync('.gev-logs/lc/phase8f/fps.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
await browser.close();
