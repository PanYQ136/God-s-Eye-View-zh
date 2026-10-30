#!/usr/bin/env node
/* reveal 后 1.5s / 4s / 8s 三张连拍：确认地图是否补上来 */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = process.argv[2] || 'ts';
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
for (let i = 0; i < 200; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ok) break;
  await sleep(150);
}
const readyAt = Date.now() - t0;
const probe = () => page.evaluate(() => {
  const v = window.__gevViewer; let ts = null;
  try { const p = v.scene.primitives; for (let k = 0; k < p.length; k++) { const q = p.get(k); if (q && q.initialTilesLoaded) ts = q; } } catch (e) {}
  const st = ts && ts.statistics;
  return { contentReady: st && st.numberOfTilesWithContentReady, cmds: st && st.numberOfCommands,
    tilesLoaded: ts && !!ts.tilesLoaded, cine: window.__gevCine && window.__gevCine.stage,
    geo: window.__gevCine && window.__gevCine.geo && { lon: +window.__gevCine.geo.lon.toFixed(4), lat: +window.__gevCine.geo.lat.toFixed(4), s: window.__gevCine.geo.source },
    camH: v && v.camera && Math.round(v.camera.positionCartographic.height) };
});
const out = { readyAt, shots: [] };
for (const at of [1500, 4000, 8000]) {
  const wait = at - (Date.now() - t0 - readyAt);
  if (wait > 0) await sleep(wait);
  const info = await probe();
  const png = await page.screenshot({ encoding: 'base64' });
  writeFileSync(`.gev-logs/lc/phase6c3/gate4-c3p-${tag}-${at}.png`, Buffer.from(png, 'base64'));
  out.shots.push({ at, info });
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
