#!/usr/bin/env node
/* Phase6C2 诊断6：交错 A/B（同一页、同页龄、真实底图）—— fixedTex 1/0/1/0 + lens off/on */
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
await page.mouse.move(4, 620, { steps: 3 });
await sleep(20000);   // 充分 settle（瓦片/着色器/自适应分辨率收敛）
const watch = (label, ms) => page.evaluate(async (label, ms) => {
  const t0 = performance.now(); const ft = []; let last = t0, worst = 0; const loaf = [];
  const o = new PerformanceObserver((l) => { for (const e of l.getEntries()) loaf.push(+e.duration.toFixed(1)); });
  try { o.observe({ type: 'long-animation-frame' }); } catch (e) {}
  await new Promise((res) => { const tick = (ts) => { const dt = ts - last; last = ts; if (dt > 0) { ft.push(+dt.toFixed(1)); if (dt > worst) worst = dt; } if (ts - t0 < ms) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  o.disconnect();
  const s = ft.slice().sort((a, b) => a - b); const st = window.__gevEdge.stats();
  return { label, fps: +(1000 / s[Math.floor(s.length * .5)]).toFixed(1), p95: +s[Math.floor(s.length * .95)].toFixed(1), worst: +worst.toFixed(1),
    loafN: loaf.length, loafMax: loaf.length ? Math.max(...loaf) : 0, upN: st.upN, upMax: st.upMax, src: st.src, poolAlloc: st.poolAlloc, tex: st.tex, drawFps: st.drawFps };
}, label, ms);
const rows = [];
const step = async (label, patch, ms = 8000) => {
  if (patch) { await page.evaluate((p) => window.__gevEdge.set(p), patch); await sleep(900); }
  const r = await watch(label, ms);
  rows.push(r);
  console.log(label.padEnd(14), JSON.stringify({ fps: r.fps, p95: r.p95, worst: r.worst, loafN: r.loafN, loafMax: r.loafMax, upN: r.upN, upMax: r.upMax, src: r.src, tex: r.tex, poolAlloc: r.poolAlloc }));
};
await step('A fixed1', { fixedTex: true });
await step('B fixed0', { fixedTex: false });
await step('A2 fixed1', { fixedTex: true });
await step('B2 fixed0', { fixedTex: false });
/* lens off（画布保留但清空）对照，交错再来一轮 */
await page.evaluate(() => window.__gevEdge.off()); await sleep(900);
const off1 = await watch('C lens-off', 8000); rows.push(off1);
console.log('C lens-off    ', JSON.stringify({ fps: off1.fps, p95: off1.p95, worst: off1.worst, loafN: off1.loafN, loafMax: off1.loafMax }));
await page.evaluate(() => window.__gevEdge.on()); await sleep(900);
await step('A3 fixed1', { fixedTex: true });
await step('B3 fixed0', { fixedTex: false });
await step('A4 fixed1', { fixedTex: true });
writeFileSync(`${OUT}/diag6.json`, JSON.stringify(rows, null, 1));
console.log('WROTE diag6.json');
await browser.close();
