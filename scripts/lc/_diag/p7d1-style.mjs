#!/usr/bin/env node
/* Phase7D1 · 实验：Cesium3DTileStyle 的 alpha 对 Google Photoreal tileset 是否生效
   ready 后：baseline → style alpha 0 → style alpha 1，三步各截图算 std/uniq。
   用法: node scripts/lc/_diag/p7d1-style.mjs [tag]
*/
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'p7d1s';
const OUT = '.gev-logs/lc/phase7d1';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), `gev-${TAG}-st-`));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
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
const logs = [];
page.on('pageerror', (e) => logs.push('PE ' + String(e.message).slice(0, 160)));

const stats = async (label) => {
  const b64 = (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
  const buf = Buffer.from(b64, 'base64');
  writeFileSync(`${OUT}/${TAG}-${label}.png`, buf);
  const { width, height } = await sharp(buf).metadata();
  const w = Math.min(640, width), h = Math.min(420, height);
  const x = Math.round((width - w) / 2), y = Math.round((height - h) / 2);
  const raw = await sharp(buf).extract({ left: x, top: y, width: w, height: h }).raw().toBuffer();
  let sum = 0, sum2 = 0, n = 0; const uniq = new Set();
  for (let p = 0; p < raw.length; p += 3) {
    const l = 0.2126 * raw[p] + 0.7152 * raw[p + 1] + 0.0722 * raw[p + 2];
    sum += l; sum2 += l * l; n++; uniq.add((raw[p] << 16) | (raw[p + 1] << 8) | raw[p + 2]);
  }
  const mean = sum / n, std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  console.log(`${label}: std ${std.toFixed(2)} uniq ${uniq.size} mean ${mean.toFixed(2)}`);
  return { label, std: +std.toFixed(2), uniq: uniq.size, mean: +mean.toFixed(2) };
};

await page.goto(`http://127.0.0.1:4174/?welcome=0&st=${Date.now()}`, { waitUntil: 'load' });
for (let i = 0; i < 4000; i++) {
  const ok = await page.evaluate(() => !!(window.__gevPhotoreal && window.__gevPhotoreal.ready)).catch(() => false);
  if (ok) break;
  await sleep(100);
}
await sleep(2500);
const out = { rows: [] };
out.rows.push(await stats('baseline'));
const r1 = await page.evaluate(() => {
  const v = window.__gevViewer;
  let ts = null;
  for (let i = 0; i < v.scene.primitives.length; i++) {
    const p = v.scene.primitives.get(i);
    if (p && p.root && typeof p.tilesLoaded === 'boolean') ts = p;
  }
  if (!ts) return { err: 'no tileset' };
  window.__gevProbeTileset = ts;
  const C = window.Cesium;
  if (!C || !C.Cesium3DTileStyle) return { err: 'no Cesium global' };
  ts.style = new C.Cesium3DTileStyle({ color: 'color("white", 0.0)' });
  return { ok: true, hasStyle: !!ts.style };
});
console.log('style set', JSON.stringify(r1));
await sleep(700);
out.rows.push(await stats('alpha0'));
await page.evaluate(() => {
  const C = window.Cesium;
  window.__gevProbeTileset.style = new C.Cesium3DTileStyle({ color: 'color("white", 1.0)' });
});
await sleep(700);
out.rows.push(await stats('alpha1'));
out.pageErrors = logs.slice(0, 5);
writeFileSync(`${OUT}/${TAG}-style.json`, JSON.stringify(out, null, 1));
console.log('errs', JSON.stringify(out.pageErrors));
await browser.close();
