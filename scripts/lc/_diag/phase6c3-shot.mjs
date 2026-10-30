#!/usr/bin/env node
/* Phase6C3-B 产品视角截图：遮罩收起后 1.5s 的正常画面（不含验收底衬） */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const TAG = process.argv[2] || 'p1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 200; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ok) break;
  await sleep(250);
}
const info = await page.evaluate(() => {
  const v = window.__gevViewer;
  const cam = v && v.camera && v.camera.positionCartographic;
  return {
    boot: window.__gevBoot && window.__gevBoot.snapshot(),
    cine: window.__gevCine && { stage: window.__gevCine.stage, done: !!window.__gevCine.done, geo: window.__gevCine.geo },
    camH: cam ? Math.round(cam.height) : null,
    lcReady: !!(window.__lc && window.__lc.api && window.__lc.api.ready),
    mask: (() => { const e = document.getElementById('loading-screen'); return e ? +parseFloat(getComputedStyle(e).opacity).toFixed(2) : null; })(),
    cards: [...document.querySelectorAll('.gev-lc')].map((e) => e.id),
  };
});
await sleep(1500);
const shot = await page.screenshot({ encoding: 'base64' });
writeFileSync(`.gev-logs/lc/phase6c3/gate4-c3p-${TAG}.png`, Buffer.from(shot, 'base64'));
console.log(JSON.stringify({ camH: info.camH, lcReady: info.lcReady, mask: info.mask, cards: info.cards.length,
  cine: info.cine && info.cine.stage, cineDone: info.cine && info.cine.done,
  reason: info.boot && info.boot.reason, marks: (info.boot && info.boot.marks || []).map((m) => m.name + '@' + m.t) }, null, 1));
await browser.close();
