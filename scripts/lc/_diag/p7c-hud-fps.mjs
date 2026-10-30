#!/usr/bin/env node
/* Phase7C · 只读探针 F：稳态「应用自报 FPS」vs 页面 rAF FPS（item 4 口径复核）
   1x 整页截图里 HUD 显示 FPS 41，而 gate 的 rAF 口径是 163.9 → 两个口径必须同时报。
   读法：页内 HUD 的 FPS 文本 + 8s 内 rAF 帧数 + Cesium 场景渲染计数（viewer.scene.render 包一层）。
   用法: node scripts/lc/_diag/p7c-hud-fps.mjs [tag]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'p7c';
const OUT = '.gev-logs/lc/phase7c';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), `gev-${TAG}-hud-`));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: profile,
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 300000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const cdp = await page.createCDPSession();
await cdp.send('Network.enable').catch(() => {});
await cdp.send('Network.clearBrowserCache').catch(() => {});
await page.goto(`http://127.0.0.1:4174/?welcome=0&hud=${Date.now()}`, { waitUntil: 'load' });
for (let i = 0; i < 4000; i++) {
  const ok = await page.evaluate(() => !!(window.__gevPhotoreal && window.__gevPhotoreal.ready)).catch(() => false);
  if (ok) break;
  await sleep(100);
}
await sleep(10000); /* 稳态：photoreal ready + 10s */

const res = await page.evaluate(() => new Promise((resolve) => {
  const hudTxt = () => {
    const els = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && /FPS/i.test(e.textContent || ''));
    return els.slice(0, 6).map((e) => (e.textContent || '').trim().slice(0, 40));
  };
  /* Cesium 渲染计数（scene.render 是真实出图次数） */
  const v = window.__gevViewer;
  let renders = 0, orig = null;
  try {
    orig = v.scene.render;
    v.scene.render = function (...a) { renders++; return orig.apply(this, a); };
  } catch (e) {}
  const t0 = performance.now();
  let raf = 0;
  const tick = () => { raf++; if (performance.now() - t0 < 8000) requestAnimationFrame(tick); else finish(); };
  requestAnimationFrame(tick);
  const finish = () => {
    const dt = (performance.now() - t0) / 1000;
    try { if (orig) v.scene.render = orig; } catch (e) {}
    resolve({ seconds: +dt.toFixed(2), rafFrames: raf, rafFps: +(raf / dt).toFixed(1), sceneRenders: renders, sceneFps: +(renders / dt).toFixed(1), hudText: hudTxt(), dpr: devicePixelRatio, canvas: [v.canvas.width, v.canvas.height],
      resolutionScale: v.resolutionScale, useDefaultRenderLoop: v.useDefaultRenderLoop });
  };
}));
const png = (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
writeFileSync(`${OUT}/${TAG}-steady-hud-1x.png`, Buffer.from(png, 'base64'));
writeFileSync(`${OUT}/${TAG}-hud-fps.json`, JSON.stringify({ at: new Date().toISOString(), res }, null, 1));
console.log(JSON.stringify(res, null, 1));
await browser.close();
