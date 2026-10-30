#!/usr/bin/env node
/* 评审 Round-2：遮罩收起 → 画面真正出现地图 的定量探针
   每 400ms 截中心区域 640×420，用像素离散度判定「空白 / 有影像」，
   同时记录 contentReady / pending / maskOpacity。 */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = process.argv[2] || 'rev2';
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
const t0 = Date.now();
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 400; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ok) break;
  await sleep(80);
}
const readyAt = Date.now() - t0;
const cdp = await page.createCDPSession();
const probe = () => page.evaluate(() => {
  const v = window.__gevViewer; let ts = null;
  try { const p = v.scene.primitives; for (let k = 0; k < p.length; k++) { const q = p.get(k); if (q && q.initialTilesLoaded) ts = q; } } catch (e) {}
  const st = ts && ts.statistics; const s = window.__gevBoot && window.__gevBoot.snapshot && window.__gevBoot.snapshot();
  return { contentReady: st && st.numberOfTilesWithContentReady, pending: st && st.numberOfPendingRequests,
    tilesLoaded: ts && !!ts.tilesLoaded, maskOpacity: s && s.maskOpacity, interactiveAt: s && s.interactiveAt,
    resScale: v && v.resolutionScale };
});
const out = { tag, readyAt, samples: [] };
for (let k = 0; k < 40; k++) {
  const at = k * 400;
  const wait = at - (Date.now() - t0 - readyAt);
  if (wait > 0) await sleep(wait);
  const info = await probe();
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 400, y: 180, width: 640, height: 420, scale: 1 } });
  writeFileSync(`.gev-logs/lc/phase6c3/${tag}-fine-${at}.png`, Buffer.from(shot.data, 'base64'));
  out.samples.push({ at, ...info });
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
