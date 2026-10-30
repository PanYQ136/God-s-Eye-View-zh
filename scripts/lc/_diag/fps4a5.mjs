#!/usr/bin/env node
/* 结论性测量：60fps 限速在 82.6Hz 面板上的算术（12.1+24.2）/2 = 18.15ms = 55fps。
   取消 targetFrameRate 后若能达到 ~82fps（12.1ms），说明「55fps」是限速器×刷新率的结果，
   不是页面算力不足。
   node scripts/lc/_diag/fps4a5.mjs */
import puppeteer from 'puppeteer';
const URL = process.env.LC_URL || 'http://127.0.0.1:4173/';
const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront();
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 240; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
await sleep(7000);

async function sample(tag, ms = 8000) {
  const r = await page.evaluate(async (ms) => {
    const ts = []; const t0 = performance.now();
    await new Promise((res) => { const f = (x) => { ts.push(x); if (x - t0 < ms) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    const g = []; for (let i = 1; i < ts.length; i++) g.push(+(ts[i] - ts[i - 1]).toFixed(2));
    const s = g.slice().sort((a, b) => a - b);
    const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0);
    const avg = g.length ? g.reduce((a, b) => a + b, 0) / g.length : 0;
    const hist = {};
    g.forEach((x) => { const k = x < 10 ? '<10' : x < 14 ? '10-14' : x < 18 ? '14-18' : x < 26 ? '18-26' : '>26'; hist[k] = (hist[k] || 0) + 1; });
    const e = window.__gevEdge.stats();
    return { ms, frames: g.length, avgFps: avg ? +(1000 / avg).toFixed(1) : 0, p50: q(0.5), p95: q(0.95), max: s[s.length - 1], hist,
      targetFrameRate: window.__gevViewer.targetFrameRate, edgeFps: e.fps, drawFps: e.drawFps, count: e.count, tex: e.tex, err: e.err };
  }, ms);
  console.log(tag.padEnd(24) + JSON.stringify(r));
  return r;
}
const rows = [];
rows.push(await sample('A 限速 60（现状）'));
await page.evaluate(() => { window.__gevViewer.targetFrameRate = undefined; });
await sleep(800);
rows.push(await sample('B 取消限速 + 折射开'));
await page.evaluate(() => window.__gevEdge.off());
await sleep(600);
rows.push(await sample('C 取消限速 + 折射关'));
await page.evaluate(() => { window.__gevEdge.on(); window.__gevViewer.targetFrameRate = 60; });
console.log('SUMMARY ' + JSON.stringify(rows.map((r) => [r.avgFps, r.p50, r.p95])));
await browser.close();
