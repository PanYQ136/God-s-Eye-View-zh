#!/usr/bin/env node
/* Phase7C · 只读探针 E：3D Tiles 后台最终 photoreal 画面质量（item 3）
   fresh profile 冷启动 → 等 __gevPhotoreal.ready → +0s/+5s/+10s 采中心 640×420 std/uniq + globe/tiles。
   「ready 标志」不等于「画面已细」，本条把两者分开量。
   用法: node scripts/lc/_diag/p7c-photoreal-final.mjs [tag] [runs]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'p7c';
const RUNS = Number(process.argv[3] || 2);
const OUT = '.gev-logs/lc/phase7c';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = [];
for (let run = 1; run <= RUNS; run++) {
  const profile = mkdtempSync(join(tmpdir(), `gev-${TAG}-pf-`));
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
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:4174/?welcome=0&pf=${run}&t=${Date.now()}`, { waitUntil: 'load' });
  let ready = null;
  for (let i = 0; i < 4000; i++) {
    const ok = await page.evaluate(() => !!(window.__gevPhotoreal && window.__gevPhotoreal.ready)).catch(() => false);
    if (ok) { ready = Date.now() - t0; break; }
    await sleep(100);
  }
  const sample = async (label) => {
    const b64 = (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
    const r = await page.evaluate(async (b) => {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b)).blob());
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
      let content = 0, tilesLoaded = null;
      try { for (let i = 0; i < v.scene.primitives.length; i++) { const p = v.scene.primitives.get(i); if (p && typeof p.numberOfTilesWithContentReady === 'number') { content += p.numberOfTilesWithContentReady; if (tilesLoaded === null) tilesLoaded = p.tilesLoaded; } } } catch (e) {}
      return { std: +std.toFixed(2), uniq: uniq.size, mean: +mean.toFixed(2), globeShow: v ? v.scene.globe.show : null, content, tilesLoaded, ready: !!(window.__gevPhotoreal && window.__gevPhotoreal.ready), pass: std >= 18 && uniq.size >= 800 };
    }, b64);
    if (label === '+10s') writeFileSync(`${OUT}/${TAG}-photoreal-final-run${run}.png`, Buffer.from(b64, 'base64'));
    return { label, at: Date.now() - t0, ...r };
  };
  const samples = [];
  samples.push(await sample('ready+0s'));
  await sleep(5000); samples.push(await sample('ready+5s'));
  await sleep(5000); samples.push(await sample('ready+10s'));
  rows.push({ run, readyWall: ready, samples });
  console.log(`run${run} photoreal.ready=${ready}ms ` + samples.map((s) => `${s.label}: std ${s.std} uniq ${s.uniq} globe ${s.globeShow} content ${s.content}`).join(' | '));
  await browser.close();
}
writeFileSync(`${OUT}/${TAG}-photoreal-final.json`, JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
