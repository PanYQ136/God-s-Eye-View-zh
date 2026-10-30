#!/usr/bin/env node
/* Phase7D2 · 判据同口径冷启动（复制 phase7a-d-cold 的流程）+ shader link 归因
   目的：在「gate 判据那条链路」上回答：0–10s 里的 >100ms 帧有多少与
   getProgramParameter(LINK_STATUS) 阻塞重叠、每次多长、是哪个 program。
   用法: node scripts/lc/_diag/p7d2-cold6-attr.mjs <tag> [runs] [base]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'p7d2c6';
const RUNS = Number(process.argv[3] || 3);
const BASE = process.argv[4] || 'http://127.0.0.1:4174/?welcome=0';
const OUT = '.gev-logs/lc/phase7d2';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(1);
};
const CARD_IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];

const INSTRUMENT = () => {
  const G = (window.__gc6 = { t0: performance.now(), links: [], progs: 0 });
  for (const P of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!P || P.prototype.__p7d2c6) continue;
    const proto = P.prototype;
    proto.__p7d2c6 = 1;
    const oCP = proto.createProgram, oGPP = proto.getProgramParameter;
    proto.createProgram = function () { G.progs += 1; return oCP.apply(this, arguments); };
    proto.getProgramParameter = function (p, pname) {
      const t = performance.now();
      try { return oGPP.apply(this, arguments); } finally {
        const d = performance.now() - t;
        if (d >= 30) G.links.push({ at: +(performance.now() - G.t0).toFixed(0), ms: +d.toFixed(0), pname: pname === 0x8b82 ? 'LINK' : String(pname) });
      }
    };
  }
};

const runs = [];
for (let i = 1; i <= RUNS; i++) {
  const profile = mkdtempSync(join(tmpdir(), `gev-${TAG}-`));
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    userDataDir: profile,
    args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
      '--ignore-gpu-blocklist', '--force_high_performance_gpu',
      '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
    protocolTimeout: 300000,
    defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.bringToFront().catch(() => {});
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 200)); });
  await page.evaluateOnNewDocument(INSTRUMENT);
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable').catch(() => {});
  await cdp.send('Network.clearBrowserCache').catch(() => {});
  const wall0 = Date.now();
  await page.goto(`${BASE}&run=${i}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });

  let releasedWall = null;
  for (let k = 0; k < 2500; k++) {
    const v = await page.evaluate(() => !!(window.__gevBoot && window.__gevBoot.inputReleased)).catch(() => false);
    if (v) { releasedWall = Date.now() - wall0; break; }
    await sleep(20);
  }
  let click = null;
  if (releasedWall != null) {
    const hit = await page.evaluate((ids) => {
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.2) continue;
        const h = (el.querySelector('.panel-header, header, .lc-head') || el).getBoundingClientRect();
        if (h.width < 20 || h.height < 8) continue;
        return { id, x: Math.round(h.left + h.width / 2), y: Math.round(h.top + h.height / 2) };
      }
      return null;
    }, CARD_IDS).catch(() => null);
    if (hit) {
      const before = await page.evaluate((id) => window.__lc?.api?.phases()?.[id] ?? null, hit.id);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hit.x, y: hit.y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
      let after = null;
      for (let k = 0; k < 60; k++) {
        after = await page.evaluate((id) => window.__lc?.api?.phases()?.[id] ?? null, hit.id);
        if (after && after !== before) break;
        await sleep(50);
      }
      click = { id: hit.id, before, after, ok: before !== after };
    }
  }
  let revealWall = null;
  for (let k = 0; k < 3000; k++) {
    const v = await page.evaluate(() => {
      const g = window.__gevBoot;
      const el = document.getElementById('loading-screen');
      const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
      return !!(g && g.interactive) || (Number.isFinite(op) && op < 0.05);
    }).catch(() => false);
    if (v) { revealWall = Date.now() - wall0; break; }
    await sleep(20);
  }
  await sleep(100);
  const png = await page.screenshot({ encoding: 'base64' }).catch(() => null);
  const b5 = png ? await page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const w = Math.min(640, bmp.width), h = Math.min(420, bmp.height);
    const x = Math.max(0, Math.round((bmp.width - w) / 2)), y = Math.max(0, Math.round((bmp.height - h) / 2));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(bmp, x, y, w, h, 0, 0, w, h);
    const d = cx.getImageData(0, 0, w, h).data;
    let sum = 0, sum2 = 0, n = 0; const uniq = new Set();
    for (let p = 0; p < d.length; p += 4) {
      const l = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
      sum += l; sum2 += l * l; n += 1; uniq.add((d[p] << 16) | (d[p + 1] << 8) | d[p + 2]);
    }
    const mean = sum / n;
    return { std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(2), uniq: uniq.size };
  }, png).catch(() => null) : null;

  /* 判据同口径：交互后 0–10s 帧率 + 每帧 >100ms 与 shader link 重叠 */
  const perf = await page.evaluate(() => new Promise((resolve) => {
    const G = window.__gc6;
    const t0 = performance.now();
    G.links.length = 0;
    const baseProgs = G.progs;
    const ts = []; const frames = []; let last = t0;
    const step = () => {
      const now = performance.now(); ts.push(now - last);
      frames.push({ t: Math.round(now - t0), dt: +(now - last).toFixed(1) });
      last = now;
      if (now - t0 < 10000) requestAnimationFrame(step);
      else {
        const f = ts.slice(2);
        const sum = f.reduce((a, b) => a + b, 0);
        const over = frames.filter((x) => x.dt > 100).map((x) => {
          const hit = G.links.filter((l) => l.at >= 0 && Math.abs(l.at - (t0 + x.t)) <= 40);
          return { t: x.t, dt: x.dt, links: hit };
        });
        resolve({
          fps: +((f.length / sum) * 1000).toFixed(1), worst: +Math.max(...f).toFixed(1),
          over100: f.filter((x) => x > 100).length, over,
          newProgs: G.progs - baseProgs,
          linkTotalMs: G.links.reduce((a, b) => a + b.ms, 0),
          links: G.links.slice(),
        });
      }
    };
    requestAnimationFrame(step);
  }));
  let photo = null;
  for (let k = 0; k < 400; k++) {
    photo = await page.evaluate(() => {
      const p = window.__gevPhotoreal;
      const v = window.__gevViewer;
      return p && p.ready ? { ready: true, globeShow: v?.scene?.globe?.show } : null;
    }).catch(() => null);
    if (photo) break;
    await sleep(100);
  }
  const gpu = await page.evaluate(() => {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      const d = gl.getExtension('WEBGL_debug_renderer_info');
      return gl.getParameter(d.UNMASKED_RENDERER_WEBGL);
    } catch (_) { return null; }
  });
  const row = { run: i, cardsClickableWall: releasedWall, click, b5Wall: revealWall, b5, photoreal: photo, fps: perf, gpu, errors: errors.slice(0, 6) };
  runs.push(row);
  console.log(JSON.stringify({ run: i, reveal: revealWall, fps: perf.fps, worst: perf.worst, over100: perf.over100, linkMs: perf.linkTotalMs, newProgs: perf.newProgs, over: perf.over.map((o) => ({ t: o.t, dt: o.dt, links: o.links.map((l) => l.ms) })) }));
  await browser.close();
}
const summary = {
  tag: TAG, runs: runs.length,
  reveal: runs.map((r) => r.b5Wall),
  fps: runs.map((r) => r.fps.fps),
  worst: runs.map((r) => r.fps.worst),
  over100: runs.map((r) => r.fps.over100),
  over100FramesTotal: runs.reduce((a, r) => a + r.fps.over100, 0),
  over100WithLink: runs.reduce((a, r) => a + r.fps.over.filter((o) => o.links.length).length, 0),
  linkTotalMs: runs.map((r) => r.fps.linkTotalMs),
  newProgs: runs.map((r) => r.fps.newProgs),
  b5pass: runs.filter((r) => r.b5 && r.b5.std >= 18).length,
  photoreal: runs.filter((r) => r.photoreal?.ready).length,
  clickOk: runs.filter((r) => r.click?.ok).length,
};
writeFileSync(`${OUT}/${TAG}-summary.json`, JSON.stringify({ summary, runs }, null, 1));
console.log('SUMMARY ' + JSON.stringify(summary, null, 1));
