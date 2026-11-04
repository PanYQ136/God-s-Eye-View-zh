#!/usr/bin/env node
/** qa-lg-record.mjs —— 录屏（等瓦片加载完再录，避免流式加载压低录制帧率） */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const DIR = 'evidence/lg-glass-shots/p0/final';
const FRAMES = `${DIR}/frames`;
fs.rmSync(FRAMES, { recursive: true, force: true });
fs.mkdirSync(FRAMES, { recursive: true });
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = []; page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 14000));
await page.keyboard.press('Escape');
await page.evaluate(() => { const w = document.querySelector('.welcome-modal, #welcome-modal'); if (w) { const b = w.querySelector('button'); if (b) b.click(); } });
/* 等瓦片真的加载完（最多 40s） */
const tiles = await page.evaluate(async () => {
  const t0 = performance.now();
  for (;;) {
    const s = window.__gevViewer && window.__gevViewer.scene;
    if (s && s.globe && s.globe.tilesLoaded) return { loaded: true, ms: Math.round(performance.now() - t0) };
    if (performance.now() - t0 > 40000) return { loaded: false, ms: 40000, pct: s && s.globe && s.globe.tilesLoaded };
    await new Promise((r) => setTimeout(r, 400));
  }
});
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 1800));
const client = await page.createCDPSession();
let n = 0; const times = [];
client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  n++; times.push(Date.now());
  fs.writeFileSync(`${FRAMES}/f${String(n).padStart(4, '0')}.jpg`, Buffer.from(data, 'base64'));
  try { await client.send('Page.screencastFrameAck', { sessionId }); } catch (e) {}
});
await client.send('Page.startScreencast', { format: 'jpeg', quality: 62, everyNthFrame: 1, maxWidth: 1280, maxHeight: 610 });
await page.evaluate(async () => {
  await new Promise((r) => setTimeout(r, 400));
  window.__gevLc.open('data-panel');
  await new Promise((r) => setTimeout(r, 1600));
  window.__gevLc.close('data-panel');
  await new Promise((r) => setTimeout(r, 1200));
  window.__gevLc.open('scene-panel');
  await new Promise((r) => setTimeout(r, 1400));
  window.__gevLc.close('scene-panel');
  await new Promise((r) => setTimeout(r, 900));
});
await client.send('Page.stopScreencast');
await new Promise((r) => setTimeout(r, 400));
const gaps = times.slice(1).map((t, i) => t - times[i]);
const fps = gaps.length ? +(1000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)).toFixed(1) : 0;
const st = await page.evaluate(() => { const s = window.__gevGlStats(); return { fps: s.fps, scale: s.scale, dev: s.devicePx, count: s.count }; });
console.log(JSON.stringify({ tiles, frames: n, avgFps: fps, p10Fps: +(1000 / gaps.slice().sort((a, b) => b - a)[Math.floor(gaps.length * 0.1)]).toFixed(1), stats: st, errors: errs.slice(0, 3) }));
await browser.close();
