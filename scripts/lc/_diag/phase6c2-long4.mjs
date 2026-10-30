#!/usr/bin/env node
/* Phase6C2 诊断4：长帧归属 —— draw 体耗时 vs 重画率 vs 卡数（同页 A/B/C） */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const W = 1348, VH = 774, OUT = '.gev-logs/lc/phase6c2';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${VH + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000, defaultViewport: { width: W, height: VH, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false)) break;
  await sleep(400);
}
await sleep(4000);
const watch = (label, ms) => page.evaluate(async (label, ms) => {
  const t0 = performance.now(); const ft = []; let last = t0, worst = 0, worstAt = 0; const loaf = [];
  const o = new PerformanceObserver((l) => { for (const e of l.getEntries()) loaf.push({ t: Math.round(e.startTime), dur: +e.duration.toFixed(1) }); });
  try { o.observe({ type: 'long-animation-frame' }); } catch (e) {}
  await new Promise((res) => { const tick = (ts) => { const dt = ts - last; last = ts; if (dt > 0) { ft.push(+dt.toFixed(1)); if (dt > worst) { worst = dt; worstAt = Math.round(ts - t0); } } if (ts - t0 < ms) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  o.disconnect();
  const s = ft.slice().sort((a, b) => a - b); const st = window.__gevEdge.stats();
  return { label, fps: +(1000 / s[Math.floor(s.length * .5)]).toFixed(1), p95: +s[Math.floor(s.length * .95)].toFixed(1), worst: +worst.toFixed(1), worstAt,
    over50: ft.map((v, i) => [i, Math.round(v)]).filter((x) => x[1] > 50), loafN: loaf.length, loafMax: loaf.length ? Math.max(...loaf.map((x) => x.dur)) : 0,
    drawMs: st.drawMs, drawMax: st.drawMax, upMax: st.upMax, upN: st.upN, src: st.src, drawFps: st.drawFps, tex: st.tex, framesTotal: st.frames };
}, label, ms);
const out = {};
out.A = await watch('A-default', 8000);
console.log('A default      ', JSON.stringify({ fps: out.A.fps, p95: out.A.p95, worst: out.A.worst, loafN: out.A.loafN, loafMax: out.A.loafMax, drawMs: out.A.drawMs, drawMax: out.A.drawMax, upMax: out.A.upMax, upN: out.A.upN, src: out.A.src, drawFps: out.A.drawFps }));
await page.evaluate(() => window.__gevEdge.cap(20));
out.B = await watch('B-cap20', 8000);
console.log('B cap20        ', JSON.stringify({ fps: out.B.fps, p95: out.B.p95, worst: out.B.worst, loafN: out.B.loafN, loafMax: out.B.loafMax, drawMs: out.B.drawMs, drawMax: out.B.drawMax, upMax: out.B.upMax, upN: out.B.upN, src: out.B.src, drawFps: out.B.drawFps }));
await page.evaluate(() => window.__gevEdge.cap(0));
await page.evaluate(() => window.__gevEdge.only(['data-panel']));
out.C = await watch('C-one-card', 8000);
console.log('C one-card     ', JSON.stringify({ fps: out.C.fps, p95: out.C.p95, worst: out.C.worst, loafN: out.C.loafN, loafMax: out.C.loafMax, drawMs: out.C.drawMs, drawMax: out.C.drawMax, upMax: out.C.upMax, upN: out.C.upN, src: out.C.src, drawFps: out.C.drawFps }));
await page.evaluate(() => window.__gevEdge.only(null));
const st = await page.evaluate(() => { const s = window.__gevEdge.stats(); return { src: s.src, upLog: s.upLog, drawMs: s.drawMs, drawMax: s.drawMax }; });
console.log('SRC/UP', JSON.stringify(st).slice(0, 1200));
writeFileSync(`${OUT}/diag4.json`, JSON.stringify({ out, st }, null, 1));
await browser.close();
