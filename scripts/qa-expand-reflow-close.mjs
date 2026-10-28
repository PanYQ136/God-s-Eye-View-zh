#!/usr/bin/env node
/** qa-expand-reflow-close.mjs —— 部分收起后「空间归还」验证：
 *  开 data+pp+control（control 收窄 338）→ 关 pp → control 应回到 465 且 overlap 0
 *  → 再关 control → 全部回基线；全程无重叠、无 console 错误。 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization', '--window-size=1536,820', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => { try { localStorage.removeItem('gev-liquid-cards:v2'); } catch (e) {} });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(2500);
const measure = () => page.evaluate(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-gfx-fab'];
  const rects = {};
  for (const id of ids) {
    const e = document.getElementById(id); if (!e) continue;
    const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
    rects[id] = { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), vis: s.visibility, op: Number(s.opacity), collapsed: e.classList.contains('collapsed') };
  }
  const vis = Object.keys(rects).filter((k) => rects[k].vis !== 'hidden' && rects[k].op > 0.05 && rects[k].w > 4 && rects[k].h > 4);
  const ov = [];
  for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
    const A = rects[vis[i]], B = rects[vis[j]];
    const w = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x);
    const h = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y);
    if (w > 0 && h > 0) ov.push({ a: vis[i], b: vis[j], area: Math.round(w * h) });
  }
  return { rects, overlaps: ov };
});
const r0 = await measure();
await page.evaluate(() => { window.__gevLc.open('data-panel'); window.__gevLc.open('pp-toggles'); window.__gevLc.open('control-panel'); });
await sleep(1300);
const r1 = await measure();
console.log('OPEN3  overlap=', r1.overlaps.length, 'control=', JSON.stringify(r1.rects['control-panel']));
await page.evaluate(() => window.__gevLc.close('pp-toggles'));
await sleep(1300);
const r2 = await measure();
console.log('CLOSE pp overlap=', r2.overlaps.length, 'control=', JSON.stringify(r2.rects['control-panel']), 'pp=', JSON.stringify(r2.rects['pp-toggles']));
await page.evaluate(() => window.__gevLc.close('control-panel'));
await page.evaluate(() => window.__gevLc.close('data-panel'));
await sleep(1500);
const r3 = await measure();
const diff = [];
for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
  const a = r0.rects[id], b = r3.rects[id];
  if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || a.collapsed !== b.collapsed) diff.push({ id, a, b });
}
console.log('FINAL overlap=', r3.overlaps.length, 'baselineIdentical=', diff.length === 0, JSON.stringify(diff));
console.log('console errors:', errs.length, errs.slice(0, 3));
await browser.close();
