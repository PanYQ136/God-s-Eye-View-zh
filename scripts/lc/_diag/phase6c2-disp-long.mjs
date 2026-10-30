#!/usr/bin/env node
/* Phase6C2 诊断：①dispPx 扫描（色散 R-B，屏幕级 + lens 画布级）②idle 长帧 LoAF 归因 */
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
await sleep(5000);
const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
console.log('GPU', gpu && gpu.renderer);

/* ── 打开 data-panel（真指针）＋ 棋盘底 ───────────────────────────── */
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(600);
const ph0 = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
if (ph0 !== 'open') {
  const p = await page.evaluate(() => {
    const el = document.getElementById('data-panel');
    const t = el.querySelector('.panel-header') || el; const b = t.getBoundingClientRect();
    return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
  });
  await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(80);
  await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1200);
}
await page.evaluate(() => {
  const s = document.createElement('style'); s.id = 'pc-blank';
  s.textContent = '#data-panel > *{visibility:hidden!important}';
  document.head.appendChild(s);
  const d = document.createElement('div'); d.id = 'pc-under';
  d.style.cssText = 'position:fixed;inset:0;background:#808080;z-index:1;pointer-events:none';
  document.body.appendChild(d);
  window.__gevEdge.testChecker(true, 8);
});
await page.mouse.move(4, 620, { steps: 3 });
await sleep(1800);

const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const bandCss = await page.evaluate(() => (window.__gevEdge.stats().surfaces.find((s) => s.id === 'data-panel') || {}).band);
const env = await page.evaluate(() => ({ dpr: devicePixelRatio, iw: innerWidth, ih: innerHeight, lens: window.__gevEdge.stats().scale, canvas: window.__gevEdge.stats().canvas }));

await page.evaluate(() => {
  window.__pc2 = {
    async dec(b64) {
      const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
      const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
      return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
    },
    prof(A, B, rect, edgePx, axis, dir, n) {
      dir = dir || 1; n = n || 12;
      const x0 = Math.round(rect.x + rect.w * 0.3), x1 = Math.round(rect.x + rect.w * 0.7);
      const y0 = Math.round(rect.y + rect.h * 0.3), y1 = Math.round(rect.y + rect.h * 0.7);
      const edge = Math.round(edgePx), out = { d: [], lum: [] };
      for (let k = 0; k <= n; k++) {
        const aa = edge + k * dir; let dm = 0, ls = 0, ln = 0;
        const lo = Math.min(axis === 'y' ? y0 : x0, axis === 'y' ? y1 : x1);
        const hi = Math.max(axis === 'y' ? y0 : x0, axis === 'y' ? y1 : x1);
        for (let t = Math.min(aa, aa + dir); t < Math.max(aa, aa + dir); t++) {
          if (t < 0) continue;
          for (let u = lo; u < hi; u++) {
            const i = axis === 'y' ? (t * A.w + u) * 4 : (u * A.w + t) * 4;
            const dr = A.d[i] - B.d[i], dg = A.d[i + 1] - B.d[i + 1], db = A.d[i + 2] - B.d[i + 2];
            dm = Math.max(dm, Math.abs(dr - db)); ls += Math.abs(0.2126 * dr + 0.7152 * dg + 0.0722 * db); ln++;
          }
        }
        out.d.push(dm); out.lum.push(ln ? +(ls / ln).toFixed(1) : 0);
      }
      return out;
    },
  };
});

const K = await page.evaluate(async (b64) => (await window.__pc2.dec(b64)).w / innerWidth, await shot());
const rS = { x: r.x * K, y: r.y * K, w: r.w * K, h: r.h * K };
const bandS = bandCss * K;
console.log('ENV', JSON.stringify(env), 'K', K, 'rect', JSON.stringify(r), 'band', bandCss);

const measure = async (onB64, offB64) => page.evaluate(async (onB64, offB64, r, band) => {
  const A = await window.__pc2.dec(onB64), B = await window.__pc2.dec(offB64);
  return {
    top: window.__pc2.prof(A, B, r, r.y, 'y', 1, 12),
    left: window.__pc2.prof(A, B, r, r.x, 'x', 1, 12),
    bot: window.__pc2.prof(A, B, r, r.y + r.h, 'y', -1, 12),
    right: window.__pc2.prof(A, B, r, r.x + r.w, 'x', -1, 12),
  };
}, onB64, offB64, rS, bandS);

const sweep = {};
for (const dp of [1.2, 1.5, 1.8, 2.2]) {
  await page.evaluate((v) => window.__gevEdge.set({ dispPx: v }), dp);
  await sleep(700);
  const on = await shot();
  await page.evaluate(() => window.__gevEdge.off()); await sleep(600);
  const off = await shot();
  await page.evaluate(() => window.__gevEdge.on()); await sleep(700);
  const m = await measure(on, off);
  // lens 画布级（预乘）读数：卡顶沿下 3 CSS px 的整行
  const sc = env.lens || 1;
  const grab = await page.evaluate(async (x, y, w) => {
    window.__gevEdgeGrab = { x: x, y: y, w: w };
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 25));
      if (window.__gevEdgeGrabOut) break;
    }
    const o = window.__gevEdgeGrabOut; window.__gevEdgeGrabOut = null;
    if (!o || !o.row) return { err: o && o.err };
    let mx = 0, arg = null, mxA = 0;
    for (const px of o.row) { const d = Math.abs(px[0] - px[2]); if (d > mx) { mx = d; arg = px; } mxA = Math.max(mxA, px[3]); }
    return { dRB: mx, px: arg, aMax: mxA, n: o.row.length };
  }, Math.round(r.x), Math.round(r.y + 3), Math.round(r.w));
  sweep[dp] = {
    top: m.top, left: m.left, bot: m.bot, right: m.right,
    dTop: Math.max(...m.top.d.slice(1)), dLeft: Math.max(...m.left.d.slice(1)),
    dBot: Math.max(...m.bot.d.slice(1)), dRight: Math.max(...m.right.d.slice(1)),
    canvas: grab,
  };
  console.log('dispPx', dp, 'screen dR-B top/left/bot/right', sweep[dp].dTop, sweep[dp].dLeft, sweep[dp].dBot, sweep[dp].dRight,
    '| lumTop', JSON.stringify(m.top.lum.slice(0, 6)), '| canvas', JSON.stringify(grab));
}
await page.evaluate(() => window.__gevEdge.set({ dispPx: 1.2 }));

/* ── idle 长帧：LoAF × 2 轮 ──────────────────────────────────────── */
await page.evaluate(() => { const d = document.getElementById('pc-under'); if (d) d.remove(); window.__gevEdge.testChecker(false, 8); });
await sleep(1500);
await page.mouse.move(4, 620, { steps: 3 });
const loaf = async (label) => page.evaluate(async (label) => {
  const L = { loaf: [], long: [] };
  const o1 = new PerformanceObserver((l) => { for (const e of l.getEntries()) L.loaf.push({ s: +e.startTime.toFixed(0), dur: +e.duration.toFixed(1), block: +(e.renderStart ? Math.max(0, e.renderStart - e.startTime) : e.duration).toFixed(1), styleLayout: +(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0).toFixed(1), scripts: (e.scripts || []).map((s) => ({ src: String(s.sourceURL || '').split('/').pop().slice(0, 40), dur: +s.duration.toFixed(1), inv: s.invokerType })) }); });
  const o2 = new PerformanceObserver((l) => { for (const e of l.getEntries()) L.long.push({ s: +e.startTime.toFixed(0), dur: +e.duration.toFixed(1), name: e.name, attr: e.attribution && e.attribution[0] && { name: e.attribution[0].name, type: e.attribution[0].containerType } }); });
  try { o1.observe({ type: 'long-animation-frame', buffered: false }); } catch (e) { L.noLoaf = String(e); }
  try { o2.observe({ type: 'longtask', buffered: false }); } catch (e) {}
  const t0 = performance.now(); const ft = []; let last = t0, worst = 0, worstAt = 0;
  await new Promise((res) => { const tick = (ts) => { const dt = ts - last; last = ts; if (dt > 0) { ft.push(+dt.toFixed(1)); if (dt > worst) { worst = dt; worstAt = +(ts - t0).toFixed(0); } } if (ts - t0 < 8000) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  o1.disconnect(); o2.disconnect();
  const s = ft.slice().sort((a, b) => a - b);
  const p50 = s[Math.floor(s.length * 0.5)];
  const gt = ft.map((v, i) => [i, v]).filter((x) => x[1] > 50);
  return { label, frames: ft.length, fps: +(1000 / p50).toFixed(1), p50: +p50.toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), worst: +worst.toFixed(1), worstAt, over50: gt, loaf: L.loaf, long: L.long, noLoaf: L.noLoaf || null };
}, label);
const L1 = await loaf('idle-1');
console.log('IDLE1', JSON.stringify({ fps: L1.fps, p95: L1.p95, worst: L1.worst, worstAt: L1.worstAt, over50: L1.over50, loaf: L1.loaf, long: L1.long }).slice(0, 2400));
const L2 = await loaf('idle-2');
console.log('IDLE2', JSON.stringify({ fps: L2.fps, p95: L2.p95, worst: L2.worst, worstAt: L2.worstAt, over50: L2.over50, loaf: L2.loaf, long: L2.long }).slice(0, 2400));
const L3 = await loaf('idle-3');
console.log('IDLE3', JSON.stringify({ fps: L3.fps, p95: L3.p95, worst: L3.worst, worstAt: L3.worstAt, over50: L3.over50, loaf: L3.loaf, long: L3.long }).slice(0, 2400));

writeFileSync(`${OUT}/diag1.json`, JSON.stringify({ gpu, env, K, rect: r, band: bandCss, sweep, idle: [L1, L2, L3] }, null, 1));
console.log('WROTE', `${OUT}/diag1.json`);
await browser.close();
