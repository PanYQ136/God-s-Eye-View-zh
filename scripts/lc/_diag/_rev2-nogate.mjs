#!/usr/bin/env node
/* 评审 Round-2 A/B：屏蔽就绪门（window.__gevBoot 读为 undefined）→ 旧路径（遮罩恢复完就收、
   之后跑可见电影镜头）。用于判定「reveal 瞬间空白」是不是本次 B 方案引入的。
   只读探针，不改任何产品源码。 */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = process.argv[2] || 'nogate';
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
  /* 让 startupChrome / lc / autolocate 都走「无就绪门」旧分支 */
  try {
    Object.defineProperty(window, '__gevBoot', { configurable: true, get: () => undefined, set: () => {} });
  } catch (e) {}
});
const t0 = Date.now();
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
const cdp = await page.createCDPSession();
/* 等遮罩真正开始淡出（opacity 从 1 掉到 0.95 以下）作为 reveal 起点 */
let revealAt = null;
for (let i = 0; i < 400; i++) {
  const op = await page.evaluate(() => {
    const el = document.getElementById('loading-screen');
    if (!el) return 0;
    const cs = getComputedStyle(el); const o = parseFloat(cs.opacity);
    return Number.isFinite(o) && cs.visibility !== 'hidden' ? o : 0;
  }).catch(() => 1);
  if (op < 0.95) { revealAt = Date.now() - t0; break; }
  await sleep(80);
}
const probe = () => page.evaluate(() => {
  const v = window.__gevViewer; let ts = null;
  try { const p = v.scene.primitives; for (let k = 0; k < p.length; k++) { const q = p.get(k); if (q && q.initialTilesLoaded) ts = q; } } catch (e) {}
  const st = ts && ts.statistics;
  return { contentReady: st && st.numberOfTilesWithContentReady, pending: st && st.numberOfPendingRequests,
    tilesLoaded: ts && !!ts.tilesLoaded, camH: v && v.camera && Math.round(v.camera.positionCartographic.height),
    cine: window.__gevCine && window.__gevCine.stage, ready: !!(window.__lc && window.__lc.api && window.__lc.api.ready) };
});
const out = { tag, revealAt, shots: [] };
for (const at of [200, 1000, 2000, 4000, 8000, 12000]) {
  const wait = at - (Date.now() - t0 - revealAt);
  if (wait > 0) await sleep(wait);
  const info = await probe();
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 400, y: 180, width: 640, height: 420, scale: 1 } });
  writeFileSync(`.gev-logs/lc/phase6c3/${tag}-reveal+${at}.png`, Buffer.from(shot.data, 'base64'));
  out.shots.push({ at, ...info });
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
