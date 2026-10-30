#!/usr/bin/env node
/* Phase6C3-R3 诊断：能不能在页内（不靠 CDP 截图、不靠 preserveDrawingBuffer）
   直接判定「当前相机视锥真的有影像」—— 为 gev-boot-gate 的收遮罩判据找可用信号。
   做法：scene.postRender 里对默认 framebuffer 做 gl.readPixels（中心 256×160），
   算亮度均值 / 标准差 / 唯一色数；与 tileset 统计量同帧记录。
   自跑：node scripts/lc/_diag/phase6c3-canvas-probe.mjs <tag> */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tag = process.argv[2] || 'cprobe';
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
page.on('pageerror', (e) => console.log('pageerror', String(e.message).slice(0, 140)));
/* 注意：这里刻意不开 pdb（preserveDrawingBuffer）—— 产品默认就是 false，
   页内探针必须在产品默认配置下可用。 */
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});
const t0 = Date.now();
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 400; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ok) break;
  await sleep(80);
}
const readyAt = Date.now() - t0;
/* 装探针：postRender → readPixels */
const hook = await page.evaluate(() => {
  const v = window.__gevViewer;
  if (!v || !v.scene) return 'no viewer';
  const scene = v.scene;
  let gl = null;
  try {
    const ctx = scene.context;
    gl = (ctx && (ctx._gl || (ctx.getGl && ctx.getGl()))) || null;
  } catch (e) { return 'no gl: ' + e.message; }
  if (!gl) return 'no gl';
  const W = 256, H = 160;
  const buf = new Uint8Array(W * H * 4);
  const sample = () => {
    const cw = gl.drawingBufferWidth, chh = gl.drawingBufferHeight;
    const x = Math.max(0, Math.floor(cw / 2 - W / 2)), y = Math.max(0, Math.floor(chh / 2 - H / 2));
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(x, y, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let sum = 0, sum2 = 0, n = 0;
    const uniq = new Set();
    for (let i = 0; i < buf.length; i += 4) {
      const l = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
      sum += l; sum2 += l * l; n++;
      uniq.add(((buf[i] >> 4) << 8) | ((buf[i + 1] >> 4) << 4) | (buf[i + 2] >> 4));
    }
    const mean = sum / n;
    return { mean: +mean.toFixed(2), std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(2), uniq: uniq.size, n };
  };
  window.__cprobe = { last: null, pending: false, samples: [] };
  scene.postRender.addEventListener(() => {
    if (!window.__cprobe.pending) return;
    window.__cprobe.pending = false;
    try { window.__cprobe.last = sample(); } catch (e) { window.__cprobe.last = { err: String(e.message) }; }
  });
  window.__cprobeAsk = () => { window.__cprobe.pending = true; try { scene.requestRender(); } catch (e) {} return new Promise((res) => {
    const t = setInterval(() => { if (!window.__cprobe.pending) { clearInterval(t); res(window.__cprobe.last); } }, 30);
    setTimeout(() => { clearInterval(t); res(window.__cprobe.last || { err: 'timeout' }); }, 3000);
  }); };
  return 'ok gl=' + (gl.getParameter(gl.VERSION) || '');
});
console.log('hook', hook);
const ts = () => page.evaluate(() => {
  const v = window.__gevViewer; let t = null;
  try { const p = v.scene.primitives; for (let k = 0; k < p.length; k++) { const q = p.get(k); if (q && q.initialTilesLoaded) t = q; } } catch (e) {}
  const st = t && t.statistics;
  const s = window.__gevBoot && window.__gevBoot.snapshot ? window.__gevBoot.snapshot() : null;
  return { contentReady: st && st.numberOfTilesWithContentReady, pending: st && st.numberOfPendingRequests,
    cmds: st && st.numberOfCommands, selected: st && st.selected, tilesLoaded: t && !!t.tilesLoaded,
    maskOp: s && s.maskOpacity, bootState: s && s.state,
    camH: v && v.camera && Math.round(v.camera.positionCartographic.height) };
});
const out = { tag, readyAt, series: [] };
for (let k = 0; k <= 24; k++) {
  const px = await page.evaluate(() => window.__cprobeAsk());
  const t = await ts();
  out.series.push({ at: Date.now() - t0 - readyAt, ...t, px });
  console.log(JSON.stringify(out.series[out.series.length - 1]));
  await sleep(500);
}
writeFileSync(`.gev-logs/lc/phase6c3/${tag}-canvas-probe.json`, JSON.stringify(out, null, 1));
await browser.close();
