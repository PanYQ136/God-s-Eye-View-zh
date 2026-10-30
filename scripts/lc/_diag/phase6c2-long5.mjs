#!/usr/bin/env node
/* Phase6C2 诊断5：长帧 A/B —— pdb on/off × fixedTex off/on（各自新起浏览器，避免 reload 破坏 Cesium） */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const W = 1348, VH = 774, OUT = '.gev-logs/lc/phase6c2';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = async (pdb) => {
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
  await page.goto(`http://127.0.0.1:4173/?welcome=0&gevEdgePdb=${pdb}&t=` + Date.now(), { waitUntil: 'load' });
  for (let i = 0; i < 150; i++) {
    if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false)) break;
    await sleep(400);
  }
  await sleep(5000);
  const cdp = await page.createCDPSession();
  const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
  await page.evaluate(() => {
    const d = document.createElement('div'); d.id = 'pc-under';
    d.style.cssText = 'position:fixed;inset:0;background:#808080;z-index:1;pointer-events:none'; document.body.appendChild(d);
    window.__gevEdge.testStripes(1, 8);
  });
  await page.mouse.move(4, 620, { steps: 3 });
  await sleep(1500);
  const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
  const vis = async () => {
    const on = await shot();
    await page.evaluate(() => window.__gevEdge.off()); await sleep(500);
    const off = await shot();
    await page.evaluate(() => window.__gevEdge.on()); await sleep(600);
    return page.evaluate(async (on, off, r) => {
      const dec = async (b64) => {
        const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
        const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
        const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
        return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
      };
      const A = await dec(on), B = await dec(off);
      const K = A.w / innerWidth;
      const prof = [];
      for (let k = 0; k <= 12; k++) {
        const y = Math.round((r.y + r.h * 0) * K) + 0 + Math.round(r.y * K) * 0 + Math.round(r.y * K) + k;
        const x0 = Math.round((r.x + r.w * 0.3) * K), x1 = Math.round((r.x + r.w * 0.7) * K);
        let s = 0, n = 0, dm = 0;
        for (let u = x0; u < x1; u++) { const i = (y * A.w + u) * 4; const dr = A.d[i] - B.d[i], dg = A.d[i + 1] - B.d[i + 1], db = A.d[i + 2] - B.d[i + 2]; s += Math.abs(0.2126 * dr + 0.7152 * dg + 0.0722 * db); dm = Math.max(dm, Math.abs(dr - db)); n++; }
        prof.push([+(s / n).toFixed(1), dm]);
      }
      return { peak: Math.max(...prof.slice(0, 10).map((p) => p[0])), prof, K };
    }, on, off, r);
  };
  const watch = (label, ms) => page.evaluate(async (label, ms) => {
    const t0 = performance.now(); const ft = []; let last = t0, worst = 0, worstAt = 0; const loaf = [];
    const o = new PerformanceObserver((l) => { for (const e of l.getEntries()) loaf.push(+e.duration.toFixed(1)); });
    try { o.observe({ type: 'long-animation-frame' }); } catch (e) {}
    await new Promise((res) => { const tick = (ts) => { const dt = ts - last; last = ts; if (dt > 0) { ft.push(+dt.toFixed(1)); if (dt > worst) { worst = dt; worstAt = Math.round(ts - t0); } } if (ts - t0 < ms) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
    o.disconnect();
    const s = ft.slice().sort((a, b) => a - b); const st = window.__gevEdge.stats();
    return { label, fps: +(1000 / s[Math.floor(s.length * .5)]).toFixed(1), p95: +s[Math.floor(s.length * .95)].toFixed(1), worst: +worst.toFixed(1),
      over80: ft.map((v, i) => [i, Math.round(v)]).filter((x) => x[1] > 80), loafN: loaf.length, loafMax: loaf.length ? Math.max(...loaf) : 0,
      drawMax: st.drawMax, upMax: st.upMax, src: st.src, poolAlloc: st.poolAlloc, tex: st.tex, texPool: st.texPool, pdb: st.pdb, drawFps: st.drawFps };
  }, label, ms);
  const out = {};
  await page.evaluate(() => window.__gevEdge.set({ fixedTex: false }));
  await sleep(1200);
  out.fixed0 = await watch('fixed0', 8000);
  const v0 = await vis();
  await page.evaluate(() => window.__gevEdge.set({ fixedTex: true }));
  await sleep(1200);
  out.fixed1 = await watch('fixed1', 8000);
  const v1 = await vis();
  await browser.close();
  return { pdb, out, vis: { fixed0: { peak: v0.peak, prof: v0.prof.slice(0, 9) }, fixed1: { peak: v1.peak, prof: v1.prof.slice(0, 9) } } };
};

const res = [];
for (const pdb of [1, 0]) {
  const r = await run(pdb);
  res.push(r);
  for (const k of ['fixed0', 'fixed1']) {
    const o = r.out[k];
    console.log(`pdb=${pdb} ${k}`.padEnd(16), JSON.stringify({ fps: o.fps, p95: o.p95, worst: o.worst, loafN: o.loafN, loafMax: o.loafMax, over80: o.over80, drawMax: o.drawMax, upMax: o.upMax, src: o.src, poolAlloc: o.poolAlloc, texPool: o.texPool, tex: o.tex, drawFps: o.drawFps }));
    console.log('   vis peak', r.vis[k].peak, JSON.stringify(r.vis[k].prof));
  }
}
writeFileSync(`${OUT}/diag5.json`, JSON.stringify(res, null, 1));
console.log('WROTE diag5.json');
