#!/usr/bin/env node
/* Phase6C Gate — 液态玻璃边缘可见度 / 轻微色散 / 单层玻璃 / 中心透明 / FPS
   真 Chrome + RTX 3060，1348×774，真指针。

   ── 仪器 ────────────────────────────────────────────────────────────
   测量口径 = **折射层自身的贡献**：先把 Cesium 冻结（useDefaultRenderLoop=false，
   地图静止 → 两次截图之间画面不变），再对同一张卡做 lens off / on 两张截图，
   逐像素差 Δ = 折射层画了什么。
     · Δ 沿边剖面（每 CSS px 平均）：可见度 / 斜面形状 / 是否双峰双线
     · Δ 的通道不一致 max|ΔR−ΔB|：色散（R/B 分离），真实底图上直接量
     · 卡片中心 Δ 必须 = 0（shader depth>band 处 discard → 中心透明）
   冻结 Cesium 只改运行时状态，不动源码；卡内内容隐藏也是测量期注入、用完撤掉。

   用法: node scripts/lc/phase6c-gate.mjs [tag]
   产物: .gev-logs/lc/phase6c/gate[-tag].json + *.png */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] ? '-' + process.argv[2] : '';
const W = 1348, H = 774;
const OUT = '.gev-logs/lc/phase6c';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const rec = (name, ok, detail) => {
  R.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  <- ' + JSON.stringify(detail).slice(0, 520)}`);
};

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
await page.bringToFront().catch(() => {});
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 140)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
    && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
await sleep(5200);
await page.mouse.move(4, 400);
const cdp = await page.createCDPSession();
const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
rec('G0 GPU = RTX 3060（非软件渲染）', !!gpu && /RTX 3060/.test(gpu.renderer || '') && gpu.software === false,
  gpu && { renderer: gpu.renderer, software: gpu.software, tier: gpu.tier });

const shot1x = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const clickHeader = async (id) => {
  const p = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const t = el.querySelector('.panel-header,.pp-header-row,.dock-tray-toggle,.location-toolbar-label') || el;
    const b = t.getBoundingClientRect();
    return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
  }, id);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await sleep(80);
  await page.mouse.down(); await sleep(40); await page.mouse.up();
  await sleep(1200);
};

/* ── 1) FPS（先测；冻结 Cesium 之后就没意义了） ───────────────────── */
const fpsSample = (label) => page.evaluate(async (label) => {
  const t0 = performance.now();
  const ft = []; let last = t0, worst = 0;
  await new Promise((res) => {
    const tick = (ts) => { const dt = ts - last; last = ts; if (dt > 0) { ft.push(dt); worst = Math.max(worst, dt); } if (ts - t0 < 8000) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick);
  });
  const s = ft.slice().sort((a, b) => a - b);
  const p50 = s[Math.floor(s.length * 0.5)];
  return { label, frames: ft.length, fps: +(1000 / p50).toFixed(1), p95ms: +s[Math.floor(s.length * 0.95)].toFixed(1), worstMs: +worst.toFixed(1) };
}, label);
const fpsIdle = await fpsSample('idle');
const hp = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: Math.round(b.x + 40), y: Math.round(b.y + 20) }; });
await page.mouse.move(hp.x, hp.y, { steps: 6 });
await sleep(250);
const fpsHover = await fpsSample('hover');
const edgeStats = await page.evaluate(() => { const s = window.__gevEdge.stats(); return { fps: s.fps, drawFps: s.drawFps, frames: s.frames, err: s.err }; });

/* ── 2) 打开 data-panel（真指针） ─────────────────────────────────── */
await page.evaluate(() => { window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }); });
await sleep(600);
let ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
if (ph !== 'open') { await clickHeader('data-panel'); await sleep(900); }
ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
rec('C0 真指针点击展开 data-panel', ph === 'open', { phase: ph });
const canvasCount = await page.evaluate(() => document.querySelectorAll('#gev-edge-lens').length);
const surfCount = await page.evaluate(() => window.__gevEdge.stats().count);
rec('C0b 单层：1 个折射 canvas / 9 个面（一卡一面）', canvasCount === 1 && surfCount === 9, { canvasCount, surfCount });
const lensErr = await page.evaluate(() => window.__gevEdge.stats().err);
rec('C1 lens 无 shader 报错', !lensErr, { err: lensErr });

const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const band = await page.evaluate(() => {
  const s = window.__gevEdge.stats();
  const f = (s.surfaces || []).find((x) => x.id === 'data-panel');
  return f ? f.band : s.band;
});

/* ── 3) 冻结 Cesium → 地图静止 ───────────────────────────────────── */
const frozen = await page.evaluate(() => {
  const v = (window.__godsEyeView && window.__godsEyeView.viewer) || window.__gevViewer || null;
  if (!v || !('useDefaultRenderLoop' in v)) return false;
  v.useDefaultRenderLoop = false;
  return true;
});
rec('C2 Cesium 已冻结（逐像素对照前提）', frozen === true, { frozen });
await sleep(1200);

/* 测量期注入：隐藏卡内内容，只留卡壳 + 折射层 */
await page.evaluate(() => {
  const s = document.createElement('style');
  s.id = 'pc-blank';
  s.textContent = '#data-panel > *{visibility:hidden!important}';
  document.head.appendChild(s);
});
await sleep(600);
const on1 = await shot1x();
writeFileSync(`${OUT}/gate${TAG}-on-1x.png`, Buffer.from(on1, 'base64'));
await page.evaluate(() => window.__gevEdge.off());
await sleep(600);
const off1 = await shot1x();
writeFileSync(`${OUT}/gate${TAG}-off-1x.png`, Buffer.from(off1, 'base64'));
await page.evaluate(() => window.__gevEdge.on());
await sleep(700);
const on2 = await shot1x();
const noise = await page.evaluate(async (a, b) => {
  const dec = async (s) => {
    const blob = await (await fetch('data:image/png;base64,' + s)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return cx.getImageData(0, 0, bmp.width, bmp.height).data;
  };
  const A = await dec(a), B = await dec(b);
  let max = 0, sum = 0;
  for (let i = 0; i < A.length; i += 4) { const d = Math.abs(A[i] - B[i]); sum += d; max = Math.max(max, d); }
  return { maxAmp: max, meanAbs: +(sum / (A.length / 4)).toFixed(2) };
}, on1, on2);
rec('C3 冻结后底图噪声 ≈ 0（同状态连拍不变）', noise.maxAmp <= 3, noise);

/* ── 4) Δ 剖面 ───────────────────────────────────────────────────── */
const delta = (rect, edgePx, axis, bandCss) => page.evaluate(async (a, b, rect, edgePx, axis, bandCss) => {
  const dec = async (s) => {
    const blob = await (await fetch('data:image/png;base64,' + s)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
  };
  const A = await dec(a); const B = await dec(b);
  const x0 = Math.round(rect.x + rect.w * 0.3), x1 = Math.round(rect.x + rect.w * 0.7);
  const y0 = Math.round(rect.y + rect.h * 0.3), y1 = Math.round(rect.y + rect.h * 0.7);
  const edge = Math.round(edgePx);
  const prof = [], dprof = [];
  for (let k = -3; k <= 18; k++) {
    const aa = edge + k, bb = aa + 1;
    let s = 0, n = 0, chd = 0;
    for (let t = Math.max(0, aa); t < Math.min(axis === 'y' ? A.h : A.w, bb); t++) {
      for (let u = axis === 'y' ? x0 : y0; u < Math.min(axis === 'y' ? x1 : y1, axis === 'y' ? A.w : A.h); u++) {
        const i = axis === 'y' ? (t * A.w + u) * 4 : (u * A.w + t) * 4;
        const dr = A.d[i] - B.d[i], dg = A.d[i + 1] - B.d[i + 1], db = A.d[i + 2] - B.d[i + 2];
        s += Math.abs(0.2126 * dr + 0.7152 * dg + 0.0722 * db); n++;
        chd = Math.max(chd, Math.abs(dr - db));
      }
    }
    prof.push(n ? +(s / n).toFixed(1) : null);
    dprof.push(n ? chd : null);
  }
  const at = (k) => prof[k + 3] ?? 0;
  const band = Math.round(bandCss);
  let peak = 0, peakK = -1;
  for (let k = 0; k < band; k++) if (at(k) > peak) { peak = at(k); peakK = k; }
  let peaks = 0;
  for (let k = 1; k < band - 1; k++) if (at(k) >= at(k - 1) && at(k) >= at(k + 1) && at(k) > 3) peaks++;
  let centerMax = 0, centerN = 0;
  for (let y = Math.round(rect.y + rect.h * 0.4); y < Math.round(rect.y + rect.h * 0.6); y++) {
    for (let x = Math.round(rect.x + rect.w * 0.35); x < Math.round(rect.x + rect.w * 0.65); x++) {
      const i = (y * A.w + x) * 4;
      centerMax = Math.max(centerMax, Math.abs(A.d[i] - B.d[i]), Math.abs(A.d[i + 1] - B.d[i + 1]), Math.abs(A.d[i + 2] - B.d[i + 2]));
      centerN++;
    }
  }
  return { peak, peakK, peaks, prof, dprof: dprof.slice(0, 18), centerMax, centerN };
}, on1, off1, rect, edgePx, axis, bandCss);

const dTop = await delta(r, r.y, 'y', band);
const dLeft = await delta(r, r.x, 'x', band);
const dBot = await delta(r, r.y + r.h, 'y', band);
const dRight = await delta(r, r.x + r.w, 'x', band);
console.log('Δtop ', JSON.stringify({ peak: dTop.peak, peakK: dTop.peakK, peaks: dTop.peaks, prof: dTop.prof, dprof: dTop.dprof }));
console.log('Δleft', JSON.stringify({ peak: dLeft.peak, prof: dLeft.prof, dprof: dLeft.dprof }));
console.log('Δbot ', JSON.stringify({ peak: dBot.peak, prof: dBot.prof }));
console.log('Δright', JSON.stringify({ peak: dRight.peak, prof: dRight.prof }));

/* ── 5) 8x 放大（放大观察用；真 8x 见 phase6c-visual.mjs） ────────── */
const cropAt8 = await page.evaluate(async (b64, rect) => {
  const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
  const bmp = await createImageBitmap(blob);
  const w = 44, h = 36;
  const cv = document.createElement('canvas'); cv.width = w * 8; cv.height = h * 8;
  const cx = cv.getContext('2d');
  cx.drawImage(bmp, Math.round(rect.x - 6), Math.round(rect.y - 6), w, h, 0, 0, w * 8, h * 8);
  return cv.toDataURL('image/png');
}, on1, r);
writeFileSync(`${OUT}/gate${TAG}-corner-8x-zoom.png`, Buffer.from(String(cropAt8).split(',')[1], 'base64'));

/* ── 6) 单层玻璃 / 无描边 ────────────────────────────────────────── */
const style = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const cs = getComputedStyle(el);
  const inner = [...el.querySelectorAll('*')].filter((x) => {
    const s = getComputedStyle(x);
    return s.backdropFilter && s.backdropFilter !== 'none';
  });
  return { bg: cs.backgroundColor, bf: cs.backdropFilter, border: cs.borderTopWidth, outline: cs.outlineWidth,
    filter: cs.filter, shadowLayers: cs.boxShadow === 'none' ? 0 : cs.boxShadow.split(/,(?![^()]*\))/).length, innerBackdrop: inner.length };
});
await page.evaluate(() => { const s = document.getElementById('pc-blank'); if (s) s.remove(); });

/* ── 断言 ────────────────────────────────────────────────────────── */
const bandMean = (() => { const s = dTop.prof.slice(4, 11).filter((v) => v != null); return s.length ? s.reduce((a, b) => a + b) / s.length : 0; })();
const dispMax = Math.max(...dTop.dprof.slice(0, 12).filter((x) => x != null));
rec('T1 顶沿高光可见（Δ 峰值 ≥ 30 灰阶且位于最外 4px）', dTop.peak >= 30 && dTop.peakK <= 4, { peak: dTop.peak, peakK: dTop.peakK, prof: dTop.prof.slice(0, 8) });
rec('T2 边缘整段有折射（第 1–8px Δ 均值 ≥ 8 灰阶：不是只剩 1px 细线）', bandMean >= 8, { bandMean: +bandMean.toFixed(2), prof: dTop.prof.slice(0, 14) });
rec('T3 单峰剖面（band 内 1 个局部极大 → 无外圈+内圈双线）', dTop.peaks <= 1, { peaks: dTop.peaks, prof: dTop.prof.slice(0, 14) });
rec('T4 四条边都有折射（左/下/右 Δ 峰值 ≥ 4）', dLeft.peak >= 4 && dBot.peak >= 4 && dRight.peak >= 4,
  { left: dLeft.peak, bot: dBot.peak, right: dRight.peak });
rec('T5 卡片中心 100% 不受折射影响（Δ 恒 0）', dTop.centerMax === 0, { centerMax: dTop.centerMax, px: dTop.centerN });
rec('T6 色散可见但克制（band 内 max|ΔR−ΔB| 6–45）', dispMax >= 6 && dispMax <= 45, { dispMax, dprof: dTop.dprof.slice(0, 12) });
rec('T7 单层玻璃：0 border / 0 outline / 0 backdrop-filter / 卡内 0 第二层玻璃',
  style.border === '0px' && style.outline === '0px' && (!style.bf || style.bf === 'none') && style.innerBackdrop === 0, style);
rec('T8 FPS ≥ 50（idle，rAF p50）', fpsIdle.fps >= 50, fpsIdle);
rec('T9 FPS ≥ 50（hover 真指针）', fpsHover.fps >= 50, fpsHover);
rec('T10 无长帧冻结（worst ≤ 100ms）', fpsIdle.worstMs <= 100 && fpsHover.worstMs <= 100, { idle: fpsIdle.worstMs, hover: fpsHover.worstMs });
rec('T11 渲染无 JS 报错', errs.filter((e) => !/Failed to load resource|favicon/i.test(e)).length === 0, errs.slice(0, 4));

writeFileSync(`${OUT}/gate${TAG}.json`, JSON.stringify({ gpu, rect: r, band, delta: { top: dTop, left: dLeft, bot: dBot, right: dRight }, noise, style, fps: { fpsIdle, fpsHover }, edgeStats, errs, results: R }, null, 1));
const pass = R.filter((x) => x.ok).length;
console.log(`\n${pass}/${R.length} PASS   (json: ${OUT}/gate${TAG}.json)`);
await browser.close();
process.exit(pass === R.length ? 0 : 1);
