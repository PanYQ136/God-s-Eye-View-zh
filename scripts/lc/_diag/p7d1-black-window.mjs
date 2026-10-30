#!/usr/bin/env node
/* Phase7D1 · 只读探针：黑帧时间序列（Node 侧 sharp 解码，不占用页面主线程）
   采样：页面内 100ms 状态（globe.show / imagery / tileset / terrain / 高度）
         + ~350ms 截图（sharp 解 PNG，中心 640×420 std/uniq）
   用法: node scripts/lc/_diag/p7d1-black-window.mjs [tag] [waitMs] [reload]
         reload=1 时先等 photoreal.ready 再 page.reload()（复现 F5 场景）
*/
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'p7d1';
const WAIT = Number(process.argv[3] || 30000);
const RELOAD = process.argv[4] === '1';
const OUT = '.gev-logs/lc/phase7d1';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), `gev-${TAG}-bw-`));
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
page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 160)); });
const cdp = await page.createCDPSession();
await cdp.send('Network.enable').catch(() => {});
await cdp.send('Network.clearBrowserCache').catch(() => {});

const STATE_SRC = `(() => {
  const v = window.__gevViewer;
  let content = null, loaded = null, show = null, prims = null;
  if (v && v.scene) {
    try {
      prims = v.scene.primitives.length;
      for (let i = 0; i < prims; i++) {
        const p = v.scene.primitives.get(i);
        if (p && typeof p.numberOfTilesWithContentReady === 'number') {
          content = (content || 0) + p.numberOfTilesWithContentReady;
          if (loaded === null) loaded = p.tilesLoaded;
          show = p.show;
        }
      }
    } catch (_) {}
  }
  return [
    +performance.now().toFixed(0),
    v ? (v.scene.globe.show ? 1 : 0) : null,
    v ? v.imageryLayers.length : null,
    content, loaded === null ? null : (loaded ? 1 : 0), show === null ? null : (show ? 1 : 0),
    v && v.scene.terrainProvider ? v.scene.terrainProvider.constructor.name : null,
    v ? Math.round(v.scene.camera.positionCartographic.height) : null,
    v ? v.scene.mode : null,
    globalThis.__gevPhotoreal && globalThis.__gevPhotoreal.ready ? 1 : 0,
    globalThis.__gevStackState && globalThis.__gevStackState.terrainBusy ? 1 : 0,
  ];
})()`;

await page.evaluateOnNewDocument(`(() => {
  window.__p7d1 = { states: [], events: [] };
  for (const ev of ['gev:photoreal-ready', 'gev:map-stack-changed']) {
    window.addEventListener(ev, (e) => {
      let d = null; try { d = JSON.stringify(e.detail || null).slice(0, 140); } catch (_) {}
      window.__p7d1.events.push([+performance.now().toFixed(0), ev, d]);
    });
  }
  const fn = () => ${STATE_SRC};
  setInterval(() => { try { window.__p7d1.states.push(fn()); } catch (_) {} }, 100);
})();`);

await page.goto(`http://127.0.0.1:4174/?welcome=0&bw=${Date.now()}`, { waitUntil: 'load' });
if (RELOAD) {
  for (let i = 0; i < 4000; i++) {
    const ok = await page.evaluate(() => !!(window.__gevPhotoreal && window.__gevPhotoreal.ready)).catch(() => false);
    if (ok) break;
    await sleep(100);
  }
  await sleep(1500);
  await page.reload({ waitUntil: 'load', timeout: 240000 });
}

const px = [];
const shotStats = async (saveName) => {
  const b64 = (await cdp.send('Page.captureScreenshot', { format: 'png' })).data;
  const buf = Buffer.from(b64, 'base64');
  if (saveName) writeFileSync(`${OUT}/${TAG}-${saveName}.png`, buf);
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
  return { std: +std.toFixed(2), uniq: uniq.size, mean: +mean.toFixed(2) };
};

const t0 = Date.now();
let i = 0;
while (Date.now() - t0 < WAIT) {
  const at = Date.now() - t0;
  try {
    const s = await shotStats(i++ % 12 === 0 ? String(at).padStart(5, '0') : null);
    px.push({ at, ...s });
  } catch (e) { px.push({ at, err: String(e.message).slice(0, 60) }); }
  await sleep(120);
}
const dump = await page.evaluate(() => ({
  states: window.__p7d1.states.slice(-1500),
  events: window.__p7d1.events,
  photoreal: globalThis.__gevPhotoreal || null,
  marks: ((globalThis.__bootTimeline && globalThis.__bootTimeline.snapshot && globalThis.__bootTimeline.snapshot().marks) || []),
}));
const out = { at: new Date().toISOString(), reload: RELOAD, px, ...dump, pageErrors: errs.slice(0, 8) };
writeFileSync(`${OUT}/${TAG}-black-window.json`, JSON.stringify(out, null, 1));

const black = px.filter((p) => !p.err && p.std < 1 && p.uniq < 50);
const dim = px.filter((p) => !p.err && !(p.std < 1 && p.uniq < 50) && !(p.std >= 18 && p.uniq >= 800));
console.log(`frames=${px.length} black=${black.length} dim=${dim.length}`);
console.log('blackAt=' + JSON.stringify(black.map((b) => b.at)));
console.log('dimAt=' + JSON.stringify(dim.map((b) => `${b.at}:${b.std}/${b.uniq}`)));
const stAt = (t) => [...dump.states].reverse().find((s) => s[0] <= t + 80) || [];
for (const p of px) {
  if (p.at % 800 > 130) continue;
  const s = stAt(p.at);
  const cls = p.err ? 'ERR' : p.std < 1 && p.uniq < 50 ? 'BLACK' : p.std >= 18 && p.uniq >= 800 ? 'ok' : 'dim';
  console.log(`${String(p.at).padStart(5)}ms ${cls.padEnd(5)} std=${String(p.std ?? p.err).padStart(6)} uniq=${String(p.uniq ?? '').padStart(6)} | gl=${s[1]} img=${s[2]} ct=${s[3]} tl=${s[4]} tsh=${s[5]} terr=${s[6]} h=${s[7]} mode=${s[8]} pr=${s[9]} tb=${s[10]}`);
}
console.log('events=' + JSON.stringify(dump.events));
console.log('marks=' + JSON.stringify(dump.marks));
console.log('pageErrors=' + JSON.stringify(out.pageErrors));
await browser.close();
