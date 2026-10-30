#!/usr/bin/env node
/* Phase7D1 · 只读探针：photoreal tileset 统计 × 画面像素（定位切换期黑帧根因）
   用法: node scripts/lc/_diag/p7d1-tileset.mjs [tag] [waitMs]
*/
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'p7d1t';
const WAIT = Number(process.argv[3] || 42000);
const OUT = '.gev-logs/lc/phase7d1';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), `gev-${TAG}-ts-`));
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
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
const cdp = await page.createCDPSession();
await cdp.send('Network.enable').catch(() => {});
await cdp.send('Network.clearBrowserCache').catch(() => {});
if (process.env.P7D1_BLOCK) {
  await cdp.send('Network.setBlockedURLs', { urls: process.env.P7D1_BLOCK.split(',') }).catch((e) => console.log('block fail', e.message));
  console.log('blocked=' + process.env.P7D1_BLOCK);
}

await page.evaluateOnNewDocument(`(() => {
  window.__p7d1t = { s: [], ev: [] };
  const find = () => {
    const v = window.__gevViewer;
    if (!v || !v.scene) return null;
    const prims = v.scene.primitives;
    for (let i = 0; i < prims.length; i++) {
      const p = prims.get(i);
      if (p && p.root && typeof p.tilesLoaded === 'boolean') return p;
    }
    return null;
  };
  const tick = () => {
    const v = window.__gevViewer;
    const t = find();
    const stats = t && t.statistics ? t.statistics : null;
    const pick = {};
    if (stats) for (const k of Object.keys(stats)) {
      const val = stats[k];
      if (typeof val === 'number') pick[k] = val;
    }
    window.__p7d1t.s.push([
      +performance.now().toFixed(0),
      v && v.scene.globe ? (v.scene.globe.show ? 1 : 0) : null,
      v ? v.imageryLayers.length : null,
      t ? (t.show ? 1 : 0) : null,
      t ? (t.tilesLoaded ? 1 : 0) : null,
      t ? (pick.numberOfTilesSelected ?? pick.selected ?? null) : null,
      t ? (pick.numberOfTilesVisited ?? pick.visited ?? null) : null,
      t ? (pick.numberOfTilesWithContentReady ?? pick.numberOfPendingRequests ?? null) : null,
      t ? (pick.numberOfCommands ?? null) : null,
      globalThis.__gevPhotoreal && globalThis.__gevPhotoreal.ready ? 1 : 0,
      t ? Object.keys(pick).length : null,
    ]);
  };
  setInterval(tick, 150);
})();`);

await page.goto(`http://127.0.0.1:4174/?welcome=0&ts=${Date.now()}`, { waitUntil: 'load' });
const t0 = Date.now();
const px = [];
let i = 0;
while (Date.now() - t0 < WAIT) {
  const at = Date.now() - t0;
  try {
    const b64 = (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
    const buf = Buffer.from(b64, 'base64');
    if (i++ % 20 === 0) writeFileSync(`${OUT}/${TAG}-${String(at).padStart(5, '0')}.png`, buf);
    const { width, height } = await sharp(buf).metadata();
    const w = Math.min(640, width), h = Math.min(420, height);
    const x = Math.max(0, Math.round((width - w) / 2)), y = Math.max(0, Math.round((height - h) / 2));
    const raw = await sharp(buf).extract({ left: x, top: y, width: w, height: h }).raw().toBuffer();
    let sum = 0, sum2 = 0, n = 0; const uniq = new Set();
    for (let p = 0; p < raw.length; p += 3) {
      const l = 0.2126 * raw[p] + 0.7152 * raw[p + 1] + 0.0722 * raw[p + 2];
      sum += l; sum2 += l * l; n++; uniq.add((raw[p] << 16) | (raw[p + 1] << 8) | raw[p + 2]);
    }
    const mean = sum / n, std = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    px.push({ at, std: +std.toFixed(2), uniq: uniq.size, mean: +mean.toFixed(2) });
  } catch (e) { px.push({ at, err: String(e.message).slice(0, 60) }); }
  await sleep(70);
}
const dump = await page.evaluate(() => ({ s: window.__p7d1t.s, photoreal: globalThis.__gevPhotoreal || null }));
writeFileSync(`${OUT}/${TAG}-tileset.json`, JSON.stringify({ px, ...dump, pageErrors: errs.slice(0, 6) }, null, 1));
const stAt = (t) => [...dump.s].reverse().find((s) => s[0] <= t + 200) || [];
for (const p of px) {
  const s = stAt(p.at);
  const cls = p.err ? 'ERR' : p.std < 1 && p.uniq < 50 ? 'BLACK' : p.std >= 18 && p.uniq >= 800 ? 'ok' : 'dim';
  console.log(`${String(p.at).padStart(5)} ${cls.padEnd(5)} std=${String(p.std ?? p.err).padStart(6)} uniq=${String(p.uniq ?? '').padStart(6)} | gl=${s[1]} img=${s[2]} tshow=${s[3]} tl=${s[4]} sel=${s[5]} vis=${s[6]} ready=${s[7]} cmd=${s[8]} pr=${s[9]} k=${s[10]}`);
}
console.log('photoreal=' + JSON.stringify(dump.photoreal));
await browser.close();
