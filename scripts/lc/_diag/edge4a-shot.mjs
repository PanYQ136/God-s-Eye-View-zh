#!/usr/bin/env node
/* 视觉证据：卡片上沿 + 左沿的折射环特写（只截变化区域，不是整页） */
import puppeteer from 'puppeteer';
const URL = process.env.LC_URL || 'http://127.0.0.1:4173/';
const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront();
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 240; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
await sleep(8000);
const rects = await page.evaluate(() => {
  const s = window.__gevEdge.stats();
  return {
    renderer: s.renderer, params: { band: s.band, dispPx: s.dispPx, gain: s.gain, ior: s.ior, bandAlpha: s.bandAlpha, count: s.count, tex: s.tex, fps: s.fps },
    dp: (s.surfaces.find((x) => x.id === 'data-panel') || {}).rect,
    pp: (s.surfaces.find((x) => x.id === 'pp-toggles') || {}).rect,
  };
});
console.log('RECTS ' + JSON.stringify(rects));
if (rects.dp) {
  const [x, y, w, h] = rects.dp;
  await page.screenshot({ path: '.gev-logs/lc/edge4a-edge-top.png', clip: { x: Math.max(0, x - 6), y: Math.max(0, y - 6), width: Math.min(320, w + 12), height: 34 } });
  await page.screenshot({ path: '.gev-logs/lc/edge4a-edge-left.png', clip: { x: Math.max(0, x - 6), y: Math.max(0, y - 6), width: 34, height: Math.min(200, h + 12) } });
  await page.screenshot({ path: '.gev-logs/lc/edge4a-card.png', clip: { x: Math.max(0, x - 6), y: Math.max(0, y - 6), width: w + 12, height: h + 12 } });
  console.log('SHOTS written');
}
await browser.close();
