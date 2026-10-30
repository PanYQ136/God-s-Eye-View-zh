#!/usr/bin/env node
/* 对照：卡片全 mini（初始态）vs 全部展开后，真实拖拽 8s 的 fps */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1360, H = 782;
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break;
  await sleep(400);
}
await sleep(14000);
const cx = Math.round(W * 0.62), cy = Math.round(H * 0.42);

async function pan8(label) {
  await page.evaluate(() => {
    const id = (window.__S && window.__S.id ? window.__S.id + 1 : 1);
    window.__S = { id, rafs: [], on: true };
    const mine = window.__S;
    const tick = (t) => { if (!mine.on || window.__S.id !== id) return; mine.rafs.push(t); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  const t0 = Date.now(); let n = 0;
  await page.mouse.move(cx, cy); await page.mouse.down();
  while (Date.now() - t0 < 8000) {
    await page.mouse.move(cx + Math.round(Math.sin(n / 12) * 70), cy + Math.round(Math.cos(n / 17) * 40));
    n += 1; await sleep(16);
  }
  await page.mouse.up();
  const r = await page.evaluate(() => {
    window.__S.on = false;
    const ts = window.__S.rafs; const g = [];
    for (let i = 1; i < ts.length; i++) g.push(ts[i] - ts[i - 1]);
    const span = ts.length > 1 ? ts[ts.length - 1] - ts[0] : 0;
    const s = g.slice().sort((a, b) => a - b);
    return { fps: +((g.length / Math.max(1, span)) * 1000).toFixed(1), p50: +(s[Math.floor(s.length * .5)] || 0).toFixed(1),
      p95: +(s[Math.floor(s.length * .95)] || 0).toFixed(1), max: +(s[s.length - 1] || 0).toFixed(1),
      over100: s.filter((x) => x > 100).length,
      open: document.querySelectorAll('.gev-lc.is-open, .gev-lc[data-open="true"]').length };
  });
  r.moves = n;
  console.log(label, JSON.stringify(r));
}
await pan8('pan-mini-1');
await pan8('pan-mini-2');
/* 真实点击展开所有卡 */
const centers = await page.evaluate(() => [...document.querySelectorAll('.gev-lc')].map((el) => {
  const r = el.getBoundingClientRect();
  return { id: el.dataset.card || el.id, x: Math.round(r.x + Math.min(r.width / 2, 40)), y: Math.round(r.y + 22) };
}));
for (const c of centers) { await page.mouse.click(c.x, c.y); await sleep(600); }
await sleep(1500);
await page.screenshot({ path: '.gev-logs/lc/fps-accept/expanded.png' });
await pan8('pan-expanded');
await page.screenshot({ path: '.gev-logs/lc/fps-accept/expanded-after-pan.png' });
console.log('errs', JSON.stringify(errs.slice(0, 4)));
await browser.close();
