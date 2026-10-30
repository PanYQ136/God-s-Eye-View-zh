#!/usr/bin/env node
/* Phase7C · 只读探针 D：photoreal 就绪后再 F5（复现 gate B5 第二次冷加载黑帧）
   fresh profile → 首载 → 等 __gevPhotoreal.ready（3D Tiles 已上屏, globe.show=false）
   → reload → 遮罩收起时刻 +1s/+4s/+8s 采 std/uniq/globe/stack/tiles。
   用法: node scripts/lc/_diag/p7c-reload-photoreal.mjs [tag]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'p7c';
const OUT = '.gev-logs/lc/phase7c';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1348, VH = 774;
const profile = mkdtempSync(join(tmpdir(), `gev-${TAG}-rp-`));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: profile,
  args: ['--no-sandbox', `--window-size=${W + 24},${VH + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 300000,
  defaultViewport: { width: W, height: VH, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
const cdp = await page.createCDPSession();
await cdp.send('Network.enable').catch(() => {});
await cdp.send('Network.clearBrowserCache').catch(() => {});
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
const probe = async (png) => page.evaluate(async (b64) => {
  const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  const w = Math.min(640, bmp.width), h = Math.min(420, bmp.height);
  const x = Math.max(0, Math.round((bmp.width - w) / 2)), y = Math.max(0, Math.round((bmp.height - h) / 2));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, x, y, w, h, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;
  let sum = 0, sum2 = 0, n = 0; const uniq = new Set();
  for (let p = 0; p < d.length; p += 4) {
    const l = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
    sum += l; sum2 += l * l; n++; uniq.add((d[p] << 16) | (d[p + 1] << 8) | d[p + 2]);
  }
  const mean = sum / n, std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const v = window.__gevViewer;
  let tiles = null;
  try { tiles = { loaded: v.scene.primitives.length, content: (() => { let c = 0; for (let i = 0; i < v.scene.primitives.length; i++) { const p = v.scene.primitives.get(i); if (p && typeof p.numberOfTilesWithContentReady === 'number') c += p.numberOfTilesWithContentReady; } return c; })() }; } catch (e) {}
  return { std: +std.toFixed(2), uniq: uniq.size, mean: +mean.toFixed(2), pass: std >= 18 && uniq.size >= 800,
    globeShow: v ? v.scene.globe.show : null, tiles,
    lsLastStack: (() => { try { return localStorage.getItem('gev.lastStack'); } catch (e) { return null; } })(),
    persistent: (() => { try { return Object.keys(localStorage).filter((k) => /stack|photoreal|cine/i.test(k)).map((k) => k + '=' + String(localStorage.getItem(k)).slice(0, 24)); } catch (e) { return null; } })() };
}, png);

await page.goto(`http://127.0.0.1:4174/?welcome=0&rp=${Date.now()}`, { waitUntil: 'load' });
for (let i = 0; i < 3000; i++) {
  const ok = await page.evaluate(() => !!(window.__gevPhotoreal && window.__gevPhotoreal.ready)).catch(() => false);
  if (ok) break;
  await sleep(100);
}
await sleep(1500);
const before = await probe(await shot());
console.log('first-load photoreal ' + JSON.stringify(before));

/* 用户按 F5 */
errs.length = 0;
const t0 = Date.now();
await page.reload({ waitUntil: 'load', timeout: 240000 });
let revealWall = null;
for (let i = 0; i < 2000; i++) {
  const st = await page.evaluate(() => {
    const g = window.__gevBoot; const el = document.getElementById('loading-screen');
    const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
    return { interactive: !!(g && g.interactive), op };
  }).catch(() => null);
  if (st && (st.interactive || (Number.isFinite(st.op) && st.op < 0.05))) { revealWall = Date.now() - t0; break; }
  await sleep(25);
}
const samples = [];
for (const at of [100, 1000, 4000, 8000]) {
  await sleep(Math.max(0, at - (Date.now() - t0 - revealWall)));
  const png = await shot();
  if (at === 100) writeFileSync(`${OUT}/${TAG}-reload-photoreal-reveal100.png`, Buffer.from(png, 'base64'));
  samples.push({ at, ...(await probe(png)) });
}
const out = { at: new Date().toISOString(), before, revealWall, samples, pageErrors: errs.slice(0, 6) };
writeFileSync(`${OUT}/${TAG}-reload-photoreal.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ revealWall, samples, pageErrors: out.pageErrors }, null, 1));
await browser.close();
