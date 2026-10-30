#!/usr/bin/env node
/* Phase6C2 诊断3：①按边对齐条纹底量色散（顶/下 用横条纹，左/右 用竖条纹）②长帧 ↔ texImage2D 上传耗时归因 */
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
const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
console.log('GPU', gpu && gpu.renderer, '| mapCanvas', await page.evaluate(() => { const v = window.__gevViewer; const c = v && v.canvas; return c ? [c.width, c.height] : null; }));

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
});
await page.mouse.move(4, 620, { steps: 3 });
await sleep(1200);
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
await page.evaluate(() => {
  window.__pc4 = {
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
const K = await page.evaluate(async (b64) => (await window.__pc4.dec(b64)).w / innerWidth, await shot());
const rS = { x: r.x * K, y: r.y * K, w: r.w * K, h: r.h * K };

const pair = async () => {
  const on = await shot();
  await page.evaluate(() => window.__gevEdge.off()); await sleep(550);
  const off = await shot();
  await page.evaluate(() => window.__gevEdge.on()); await sleep(650);
  return page.evaluate(async (on, off, r) => {
    const A = await window.__pc4.dec(on), B = await window.__pc4.dec(off);
    return {
      top: window.__pc4.prof(A, B, r, r.y, 'y', 1, 12),
      bot: window.__pc4.prof(A, B, r, r.y + r.h, 'y', -1, 12),
      left: window.__pc4.prof(A, B, r, r.x, 'x', 1, 12),
      right: window.__pc4.prof(A, B, r, r.x + r.w, 'x', -1, 12),
    };
  }, on, off, rS);
};
const mx = (a, from, to) => Math.max(...a.slice(from, to));

const res = {};
for (const dp of [1.2, 1.4, 1.6, 1.8]) {
  await page.evaluate((v) => window.__gevEdge.set({ dispPx: v }), dp);
  /* 横条纹：量顶/下（位移纵向） */
  await page.evaluate(() => window.__gevEdge.testStripes(1, 8));
  await sleep(1100);
  const hz = await pair();
  /* 竖条纹：量左/右（位移横向） */
  await page.evaluate(() => window.__gevEdge.testStripes(0, 8));
  await sleep(1100);
  const vt = await pair();
  res[dp] = {
    top_d: mx(hz.top.d, 1, 9), bot_d: mx(hz.bot.d, 1, 9),
    left_d: mx(vt.left.d, 1, 9), right_d: mx(vt.right.d, 1, 9),
    top_dprof: hz.top.d, bot_dprof: hz.bot.d, left_dprof: vt.left.d, right_dprof: vt.right.d,
    top_lum: hz.top.lum.slice(0, 8), left_lum: vt.left.lum.slice(0, 8),
  };
  console.log('dispPx', dp, '| R-B  max  top', res[dp].top_d, 'bot', res[dp].bot_d, 'left', res[dp].left_d, 'right', res[dp].right_d,
    '| top dprof', JSON.stringify(res[dp].top_dprof), '| left dprof', JSON.stringify(res[dp].left_dprof));
}
await page.evaluate(() => { window.__gevEdge.testChecker(false, 8); const d = document.getElementById('pc-under'); if (d) d.remove(); });

/* 长帧 ↔ 上传耗时 */
await page.mouse.move(4, 620, { steps: 3 });
await sleep(1500);
const frameWatch = (label, ms) => page.evaluate(async (label, ms) => {
  const t0 = performance.now(); const ft = []; let last = t0, worst = 0, worstAt = 0;
  const loaf = [];
  const o = new PerformanceObserver((l) => { for (const e of l.getEntries()) loaf.push({ t: Math.round(e.startTime), dur: +e.duration.toFixed(1), s: (e.scripts || []).map((x) => String(x.sourceURL || '').split('/').pop().slice(0, 18) + ':' + x.duration.toFixed(0)) }); });
  try { o.observe({ type: 'long-animation-frame' }); } catch (e) {}
  await new Promise((res) => { const tick = (ts) => { const dt = ts - last; last = ts; if (dt > 0) { ft.push(+dt.toFixed(1)); if (dt > worst) { worst = dt; worstAt = Math.round(ts - t0); } } if (ts - t0 < ms) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  o.disconnect();
  const s = ft.slice().sort((a, b) => a - b);
  const st = window.__gevEdge.stats();
  return { label, fps: +(1000 / s[Math.floor(s.length * .5)]).toFixed(1), p95: +s[Math.floor(s.length * .95)].toFixed(1), worst: +worst.toFixed(1), worstAt, over50: ft.map((v, i) => [i, Math.round(v)]).filter((x) => x[1] > 50), loaf, upLog: st.upLog, upMax: st.upMax, upN: st.upN, tex: st.tex };
}, label, ms);
const A1 = await frameWatch('on-1', 8000);
console.log('FRAMES', JSON.stringify({ fps: A1.fps, p95: A1.p95, worst: A1.worst, worstAt: A1.worstAt, over50: A1.over50, loaf: A1.loaf, upMax: A1.upMax, upN: A1.upN, tex: A1.tex, upLog: A1.upLog }));
writeFileSync(`${OUT}/diag3.json`, JSON.stringify({ gpu, K, r, res, frames: A1 }, null, 1));
console.log('WROTE diag3.json');
await browser.close();
