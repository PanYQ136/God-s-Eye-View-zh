#!/usr/bin/env node
/* Phase6C2 诊断2：①顶沿色散像素级原样 dump（屏幕 + lens 画布多行）②长帧归属：lens 开/关 对照 + 30s 周期性观察 */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const W = 1348, VH = 774, OUT = '.gev-logs/lc/phase6c2';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${VH + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: VH, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
    && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
await sleep(4000);

/* 打开 data-panel + 棋盘底 */
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(600);
if (await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase) !== 'open') {
  const p = await page.evaluate(() => {
    const b = document.getElementById('data-panel').querySelector('.panel-header').getBoundingClientRect();
    return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
  });
  await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(80);
  await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1200);
}
await page.evaluate(() => {
  const s = document.createElement('style'); s.id = 'pc-blank';
  s.textContent = '#data-panel > *{visibility:hidden!important}'; document.head.appendChild(s);
  const d = document.createElement('div'); d.id = 'pc-under';
  d.style.cssText = 'position:fixed;inset:0;background:#808080;z-index:1;pointer-events:none';
  document.body.appendChild(d);
  window.__gevEdge.testChecker(true, 8);
});
await page.mouse.move(4, 620, { steps: 3 });
await sleep(1600);
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const env = await page.evaluate(() => ({ dpr: devicePixelRatio, lens: window.__gevEdge.stats().scale, canvas: window.__gevEdge.stats().canvas }));

await page.evaluate(() => {
  window.__pc3 = {
    async dec(b64) {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
      return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
    },
  };
});
const on = await shot();
await page.evaluate(() => window.__gevEdge.off()); await sleep(600);
const off = await shot();
await page.evaluate(() => window.__gevEdge.on()); await sleep(700);
const grid = await page.evaluate(async (on, off, r) => {
  const A = await window.__pc3.dec(on), B = await window.__pc3.dec(off);
  const out = {};
  const rows = {};
  /* 顶沿：截图行（card top y*1.25 附近），取 30%–70% 宽的 24 列 */
  for (let k = 0; k <= 8; k++) {
    const y = Math.round(r.y) + k, x0 = Math.round(r.x + r.w * 0.3);
    const arr = [];
    for (let u = x0; u < x0 + 24; u++) {
      const i = (y * A.w + u) * 4;
      arr.push([A.d[i] - B.d[i], A.d[i + 1] - B.d[i + 1], A.d[i + 2] - B.d[i + 2]]);
    }
    rows[k] = arr;
  }
  out.topRows = rows;
  /* 左沿：列 x*1.25 附近，24 行 */
  const cols = {};
  for (let k = 0; k <= 8; k++) {
    const x = Math.round(r.x) + k, y0 = Math.round(r.y + r.h * 0.4);
    const arr = [];
    for (let u = y0; u < y0 + 24; u++) {
      const i = (u * A.w + x) * 4;
      arr.push([A.d[i] - B.d[i], A.d[i + 1] - B.d[i + 1], A.d[i + 2] - B.d[i + 2]]);
    }
    cols[k] = arr;
  }
  out.leftCols = cols;
  return out;
}, on, off, { x: r.x * 1.25, y: r.y * 1.25, w: r.w * 1.25, h: r.h * 1.25 });
const sum = (rows) => Object.entries(rows).map(([k, arr]) => k + ':' + Math.max(...arr.map((p) => Math.abs(p[0] - p[2]))));
console.log('SCREEN top rows max|dR-dB| per k =', sum(grid.topRows).join(' '));
console.log('SCREEN left cols max|dR-dB| per k =', sum(grid.leftCols).join(' '));
console.log('SCREEN top row2 sample dRGB =', JSON.stringify(grid.topRows['2'].slice(0, 8)));

/* lens 画布：多行 readback（每行单独 grab） */
const canvasRows = {};
for (let k = 0; k <= 8; k++) {
  const g = await page.evaluate(async (x, y, w) => {
    window.__gevEdgeGrab = { x: x, y: y, w: w };
    for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 25)); if (window.__gevEdgeGrabOut) break; }
    const o = window.__gevEdgeGrabOut; window.__gevEdgeGrabOut = null;
    if (!o || !o.row) return null;
    return o.row;
  }, Math.round(r.x + 20), Math.round(r.y + k), 200);
  if (g) {
    let mx = 0, px = null;
    for (const p of g) { const d = Math.abs(p[0] - p[2]); if (d > mx) { mx = d; px = p; } }
    canvasRows[k] = { max: mx, px, aMax: Math.max(...g.map((p) => p[3])) };
  }
}
console.log('CANVAS top rows max|dR-dB| =', JSON.stringify(canvasRows));

/* ── 长帧：30s 周期观察（lens 开）＋ 关掉 lens 后 2×8s ───────────── */
await page.evaluate(() => { const d = document.getElementById('pc-under'); if (d) d.remove(); window.__gevEdge.testChecker(false, 8); });
await page.mouse.move(4, 620, { steps: 3 });
await sleep(1500);
const loaf = async (label, ms) => page.evaluate(async (label, ms) => {
  const L = { loaf: [] };
  const o1 = new PerformanceObserver((l) => { for (const e of l.getEntries()) L.loaf.push({ t: Math.round(e.startTime), dur: +e.duration.toFixed(1), scripts: (e.scripts || []).map((s) => String(s.sourceURL || '').split('/').pop().slice(0, 24) + ':' + s.duration.toFixed(0)) }); });
  try { o1.observe({ type: 'long-animation-frame' }); } catch (e) {}
  const t0 = performance.now(); const ft = []; let last = t0, worst = 0, worstAt = 0;
  await new Promise((res) => { const tick = (ts) => { const dt = ts - last; last = ts; if (dt > 0) { ft.push(dt); if (dt > worst) { worst = dt; worstAt = Math.round(ts - t0); } } if (ts - t0 < ms) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  o1.disconnect();
  const s = ft.slice().sort((a, b) => a - b);
  return { label, fps: +(1000 / s[Math.floor(s.length * .5)]).toFixed(1), p95: +s[Math.floor(s.length * .95)].toFixed(1), worst: +worst.toFixed(1), worstAt, over60: ft.map((v, i) => [i, +v.toFixed(0)]).filter((x) => x[1] > 60), loaf: L.loaf };
}, label, ms);
const A1 = await loaf('on-20s', 8000);
const A2 = await loaf('on-30s', 8000);
console.log('LOAF-ON-1', JSON.stringify({ fps: A1.fps, p95: A1.p95, worst: A1.worst, worstAt: A1.worstAt, over60: A1.over60, loaf: A1.loaf }).slice(0, 1800));
console.log('LOAF-ON-2', JSON.stringify({ fps: A2.fps, p95: A2.p95, worst: A2.worst, worstAt: A2.worstAt, over60: A2.over60, loaf: A2.loaf }).slice(0, 1800));
await page.evaluate(() => { window.__gevEdge.off(); const c = document.getElementById('gev-edge-lens'); if (c) c.remove(); });
await sleep(1200);
const B1 = await loaf('off-1', 8000);
const B2 = await loaf('off-2', 8000);
console.log('LENS-OFF-1', JSON.stringify({ fps: B1.fps, p95: B1.p95, worst: B1.worst, worstAt: B1.worstAt, over60: B1.over60, loaf: B1.loaf }).slice(0, 1800));
console.log('LENS-OFF-2', JSON.stringify({ fps: B2.fps, p95: B2.p95, worst: B2.worst, worstAt: B2.worstAt, over60: B2.over60, loaf: B2.loaf }).slice(0, 1800));
writeFileSync(`${OUT}/diag2.json`, JSON.stringify({ env, r, grid, canvasRows, on: [A1, A2], off: [B1, B2] }, null, 1));
console.log('WROTE diag2.json');
await browser.close();
