#!/usr/bin/env node
/* Phase6C/C1 Gate v2 — 液态玻璃边缘可见度（换仪器，见 docs/Phase6C1）
   真 Chrome + RTX 3060，1348×774，真指针。

   ── 为什么换仪器（Phase6C1 结论） ──────────────────────────────────────
   旧仪器 = 「冻结 Cesium + lens off/on 逐像素 Δ」。实测它有两个致命缺陷：
     · 冻结后本层永远不进合成（on/off Δ 恒 0；连 visibility 切换 Δ 也 0）；
     · 冻结后若补一次 v.render() 才出数，但那一次重绘把整幅底图换掉 → centerMax 164 污染。
   于是「干净 Δ」与「层能上屏」互斥，Phase6C 1.2h 的参数扫描全程测的是一块**没上屏的空层**。

   ── 新仪器（三路互证，A/B 不依赖冻结） ─────────────────────────────────
   A) 平坦灰底解析合成（主判据）：`__gevEdge.testBg(true,8,128)` 让 shader 采样一张纯 128 灰
      纹理 → 输出与地图无关、完全确定；再垫一层同色 128 静态底色（#pc-under，z-index 1，
      位于 Cesium(z0) 之上、卡片(z110) 之下）。此时「屏幕截图 on/off Δ」= 折射层自身贡献，
      噪声恒 0，且 Cesium **不冻结**（走运行时真实合成路径）。
   B) 画布自读（交叉验证）：同一状态下 `#gev-edge-lens.toDataURL()`，按 premultiplied over 128
      解出「合成到 128 底上的可见 |Δlum|」，逐像素核对四边剖面。
   C) 实时区分器（回答「层是不是画了但不可见」）：撤掉灰底与测试纹理、恢复真地图、**不冻结**，
      on/off 各拍一张 → 边缘带 Δ 均值 ÷ 卡片中心 Δ 均值。中心没有透镜（shader 在 depth>band
      处 discard），中心 Δ 只能是地图自身运动噪声；层不可见则比值 ≈1，可见则边缘 ≫ 中心。

   用法: node scripts/lc/phase6c-gate-v2.mjs [tag]
   产物: .gev-logs/lc/phase6c/gate2[-tag].json + *.png
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] ? '-' + process.argv[2] : '';
const W = 1348, H = 774;
const OUT = '.gev-logs/lc/phase6c';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const rec = (name, ok, detail, skip) => {
  R.push({ name, ok: !!ok, skip: !!skip, detail });
  console.log(`${skip ? 'INFO' : ok ? 'PASS' : 'FAIL'}  ${name}${ok || skip ? '' : '  <- ' + JSON.stringify(detail).slice(0, 520)}`);
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

/* ── 1) FPS（先测；后面要注入测量底衬） ─────────────────────────── */
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
const edgeStats0 = await page.evaluate(() => { const s = window.__gevEdge.stats(); return { fps: s.fps, drawFps: s.drawFps, frames: s.frames, err: s.err }; });

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

/* ── 3) 页内测量内核（只装一次） ──────────────────────────────────── */
await page.evaluate(() => {
  const dec = async (b64) => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
  };
  const metrics = (A, B, rect, edgePx, axis, bandCss, dir) => {
    dir = dir || 1;
    const x0 = Math.round(rect.x + rect.w * 0.3), x1 = Math.round(rect.x + rect.w * 0.7);
    const y0 = Math.round(rect.y + rect.h * 0.3), y1 = Math.round(rect.y + rect.h * 0.7);
    const edge = Math.round(edgePx);
    const prof = [], dprof = [];
    for (let k = -3; k <= 18; k++) {
      const aa = edge + k * dir, bb = aa + dir;
      let s = 0, n = 0, chd = 0;
      for (let t = Math.max(0, Math.min(aa, bb)); t < Math.min(axis === 'y' ? A.h : A.w, Math.max(aa, bb)); t++) {
        for (let u = axis === 'y' ? x0 : y0; u < Math.min(axis === 'y' ? x1 : y1, axis === 'y' ? A.w : A.h); u++) {
          const i = axis === 'y' ? (t * A.w + u) * 4 : (u * A.w + t) * 4;
          const dr = A.d[i] - B.d[i], dg = A.d[i + 1] - B.d[i + 1], db = A.d[i + 2] - B.d[i + 2];
          s += Math.abs(0.2126 * dr + 0.7152 * dg + 0.0722 * db); n++;
          chd = Math.max(chd, Math.abs(dr - db));
        }
      }
      prof.push(n ? +(s / n).toFixed(1) : 0);
      dprof.push(n ? chd : 0);
    }
    const at = (k) => prof[k + 3] || 0;
    const bd = Math.round(bandCss);
    let peak = 0, peakK = -1;
    for (let k = 0; k < bd; k++) if (at(k) > peak) { peak = at(k); peakK = k; }
    let peaks = 0;
    for (let k = 1; k < bd - 1; k++) if (at(k) >= at(k - 1) && at(k) >= at(k + 1) && at(k) > 3) peaks++;
    let cMax = 0, cSum = 0, cN = 0;
    for (let y = Math.round(rect.y + rect.h * 0.4); y < Math.round(rect.y + rect.h * 0.6); y++) {
      for (let x = Math.round(rect.x + rect.w * 0.35); x < Math.round(rect.x + rect.w * 0.65); x++) {
        const i = (y * A.w + x) * 4;
        const dv = Math.abs(0.2126 * (A.d[i] - B.d[i]) + 0.7152 * (A.d[i + 1] - B.d[i + 1]) + 0.0722 * (A.d[i + 2] - B.d[i + 2]));
        cMax = Math.max(cMax, Math.abs(A.d[i] - B.d[i]), Math.abs(A.d[i + 1] - B.d[i + 1]), Math.abs(A.d[i + 2] - B.d[i + 2]));
        cSum += dv; cN++;
      }
    }
    const bs = prof.slice(4, 12);           // k = 1..8
    const bandMean = bs.reduce((a, b) => a + b, 0) / (bs.length || 1);
    return {
      peak, peakK, peaks, bandMean: +bandMean.toFixed(2), prof,
      dprof: dprof.slice(0, 18),
      centerMax: cMax, centerMean: +(cSum / Math.max(1, cN)).toFixed(2), centerN: cN,
    };
  };
  const canvasMetrics = (img, rect, edgePx, axis, bandCss, base, dir) => {
    dir = dir || 1;
    const x0 = Math.round(rect.x + rect.w * 0.3), x1 = Math.round(rect.x + rect.w * 0.7);
    const y0 = Math.round(rect.y + rect.h * 0.3), y1 = Math.round(rect.y + rect.h * 0.7);
    const edge = Math.round(edgePx);
    const contrib = (i) => {
      const a = img.d[i + 3] / 255;
      const lum = 0.2126 * img.d[i] + 0.7152 * img.d[i + 1] + 0.0722 * img.d[i + 2];
      return a * (lum - base);
    };
    const prof = [], aprof = [];
    for (let k = -3; k <= 18; k++) {
      const aa = edge + k * dir, bb = aa + dir;
      let s = 0, n = 0, am = 0;
      for (let t = Math.max(0, Math.min(aa, bb)); t < Math.min(axis === 'y' ? img.h : img.w, Math.max(aa, bb)); t++) {
        for (let u = axis === 'y' ? x0 : y0; u < Math.min(axis === 'y' ? x1 : y1, axis === 'y' ? img.w : img.h); u++) {
          const i = axis === 'y' ? (t * img.w + u) * 4 : (u * img.w + t) * 4;
          s += Math.abs(contrib(i)); am = Math.max(am, img.d[i + 3]); n++;
        }
      }
      prof.push(n ? +(s / n).toFixed(1) : 0);
      aprof.push(n ? am : 0);
    }
    const at = (k) => prof[k + 3] || 0;
    const bd = Math.round(bandCss);
    let peak = 0, peakK = -1;
    for (let k = 0; k < bd; k++) if (at(k) > peak) { peak = at(k); peakK = k; }
    let peaks = 0;
    for (let k = 1; k < bd - 1; k++) if (at(k) >= at(k - 1) && at(k) >= at(k + 1) && at(k) > 3) peaks++;
    const bs = prof.slice(4, 12);
    return { peak, peakK, peaks, bandMean: +(bs.reduce((a, b) => a + b, 0) / (bs.length || 1)).toFixed(2), prof, aprof };
  };
  window.__pc = { dec, metrics, canvasMetrics };
});

const measureOnOff = async (onB64, offB64, rS, bandS) => page.evaluate(async (onB64, offB64, r, band) => {
  const A = await window.__pc.dec(onB64), B = await window.__pc.dec(offB64);
  let max = 0, s = 0;
  for (let i = 0; i < A.d.length; i += 4) { const d = Math.abs(A.d[i] - B.d[i]); if (d > max) max = d; s += d; }
  return {
    size: [A.w, A.h],
    top: window.__pc.metrics(A, B, r, r.y, 'y', band),
    left: window.__pc.metrics(A, B, r, r.x, 'x', band),
    bot: window.__pc.metrics(A, B, r, r.y + r.h, 'y', band, -1),
    right: window.__pc.metrics(A, B, r, r.x + r.w, 'x', band, -1),
    noise: { max, mean: +(s / (A.d.length / 4)).toFixed(3) },
  };
}, onB64, offB64, rS, bandS);

const measureCanvas = async (rS, bandS) => page.evaluate(async (r, band) => {
  const cv = document.getElementById('gev-edge-lens');
  if (!cv) return { err: 'no-canvas' };
  const url = cv.toDataURL('image/png');
  const img = await window.__pc.dec(url.split(',')[1]);
  const k = img.w / innerWidth;
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) {
    if (img.d[(y * img.w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  /* 画布坐标空间 = 画布位图 px；用画布自身 scale 换算到 CSS px */
  const rr = { x: r.x / k, y: r.y / k, w: r.w / k, h: r.h / k };
  const bb = band / k;
  return {
    canvas: [img.w, img.h], k, bbox: x1 < 0 ? null : [x0, y0, x1, y1],
    top: window.__pc.canvasMetrics(img, rr, rr.y, 'y', bb, 128),
    left: window.__pc.canvasMetrics(img, rr, rr.x, 'x', bb, 128),
    bot: window.__pc.canvasMetrics(img, rr, rr.y + rr.h, 'y', bb, 128, -1),
    right: window.__pc.canvasMetrics(img, rr, rr.x + rr.w, 'x', bb, 128, -1),
  };
}, rS, bandS);

/* ── 4) 测量期注入：隐藏卡内内容 ──────────────────────────────────── */
await page.evaluate(() => {
  const s = document.createElement('style');
  s.id = 'pc-blank';
  s.textContent = '#data-panel > *{visibility:hidden!important}';
  document.head.appendChild(s);
});
await sleep(500);

const stacking = await page.evaluate((r) => {
  const z = (id) => { const e = document.getElementById(id); return e ? getComputedStyle(e).zIndex : null; };
  const at = (x, y) => { const e = document.elementFromPoint(x, y); return e ? (e.id || e.className || e.tagName) : null; };
  return {
    cesium: z('cesiumContainer'), lens: z('gev-edge-lens'), panel: z('data-panel'),
    atEdgeTop: at(Math.round(r.x + r.w / 2), Math.round(r.y + 1)),
    atCenter: at(Math.round(r.x + r.w / 2), Math.round(r.y + r.h / 2)),
  };
}, r);

/* ── 状态 A：未冻结 + 平坦 128 采样源 + 平坦 128 底衬（主判据） ─────── */
await page.evaluate(() => {
  const d = document.createElement('div');
  d.id = 'pc-under';
  d.style.cssText = 'position:fixed;inset:0;background:#808080;z-index:1;pointer-events:none';
  document.body.appendChild(d);
  window.__gevEdge.testBg(true, 8, 128);
});
await sleep(1500);
const A_on1 = await shot1x();
/* 截图实际像素 = CSS × k（本机 1685×968 对应 1348×774 → k=1.25）。
   旧的 phase6c-gate 直接用 CSS 坐标索引截图 → 全部剖面错位 1.25 倍，
   这才是「左/下/右全 0、顶沿只有 0.4」的直接原因。 */
const K = await page.evaluate(async (b64) => (await window.__pc.dec(b64)).w / innerWidth, A_on1);
const rS = { x: r.x * K, y: r.y * K, w: r.w * K, h: r.h * K };
const bandS = band * K;
console.log('screenshot scale K =', K, 'rect(css)', JSON.stringify(r), '→(px)', JSON.stringify(rS));
await sleep(300);
const A_on2 = await shot1x();
await page.evaluate(() => window.__gevEdge.off());
await sleep(600);
const A_off = await shot1x();
await page.evaluate(() => window.__gevEdge.on());
await sleep(900);
const canvasA = await measureCanvas(r, band);

/* ── 状态 B：冻结 Cesium，同仪器（回答「地图空闲时层是否消失」） ──── */
const frozen = await page.evaluate(() => {
  const v = (window.__godsEyeView && window.__godsEyeView.viewer) || window.__gevViewer || null;
  if (!v || !('useDefaultRenderLoop' in v)) return false;
  v.useDefaultRenderLoop = false;
  return true;
});
rec('C2 Cesium 渲染循环已停止（仅状态 B 用，不参与 A 判据）', frozen === true, { frozen });
await sleep(1200);
const B_on = await shot1x();
await page.evaluate(() => window.__gevEdge.off());
await sleep(600);
const B_off = await shot1x();
await page.evaluate(() => window.__gevEdge.on());
await sleep(900);
const B_on2 = await shot1x();
const canvasB = await measureCanvas(r, band);

const A = await measureOnOff(A_on1, A_off, rS, bandS);
const Anoise = await measureOnOff(A_on1, A_on2, rS, bandS);
const Bm = await measureOnOff(B_on, B_off, rS, bandS);
const Bnoise = await measureOnOff(B_on, B_on2, rS, bandS);

/* ── 状态 C：真地图 + 未冻结（区分器：层可见 vs 层没上屏） ──────────── */
await page.evaluate(() => {
  const v = (window.__godsEyeView && window.__godsEyeView.viewer) || window.__gevViewer || null;
  if (v && 'useDefaultRenderLoop' in v) v.useDefaultRenderLoop = true;
  const d = document.getElementById('pc-under'); if (d) d.remove();
  window.__gevEdge.testBg(false);
});
await sleep(1600);
const C_on = await shot1x();
await page.evaluate(() => window.__gevEdge.off());
await sleep(600);
const C_off = await shot1x();
await page.evaluate(() => window.__gevEdge.on());
await sleep(900);
const C_on2 = await shot1x();
const Cm = await measureOnOff(C_on, C_off, rS, bandS);
const Cnoise = await measureOnOff(C_on, C_on2, rS, bandS);
const edgeBandMean = (m) => (m.top.bandMean + m.left.bandMean + m.bot.bandMean + m.right.bandMean) / 4;
const C_edge = edgeBandMean(Cm);
const C_center = (Cm.top.centerMean + Cm.left.centerMean + Cm.bot.centerMean + Cm.right.centerMean) / 4;
const C_ratio = +(C_edge / Math.max(0.35, C_center)).toFixed(2);

/* ── 截图产物 ─────────────────────────────────────────────────────── */
writeFileSync(`${OUT}/gate2${TAG}-A-on-1x.png`, Buffer.from(A_on1, 'base64'));
writeFileSync(`${OUT}/gate2${TAG}-A-off-1x.png`, Buffer.from(A_off, 'base64'));
writeFileSync(`${OUT}/gate2${TAG}-C-on-1x.png`, Buffer.from(C_on, 'base64'));
const crops = await page.evaluate(async (b64, rect) => {
  const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
  const bmp = await createImageBitmap(blob);
  const out = {};
  const box = (name, x, y, w, h) => {
    const cv = document.createElement('canvas'); cv.width = w * 8; cv.height = h * 8;
    const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false;
    cx.drawImage(bmp, Math.round(x), Math.round(y), w, h, 0, 0, w * 8, h * 8);
    out[name] = cv.toDataURL('image/png');
  };
  const u = 44 * (rect.w / 320) / 44; // 已是 px 空间
  box('tl', rect.x - 6 * (rect.w / 320), rect.y - 6 * (rect.w / 320), 44 * (rect.w / 320), 36 * (rect.w / 320));
  box('tr', rect.x + rect.w - 38 * (rect.w / 320), rect.y - 6 * (rect.w / 320), 44 * (rect.w / 320), 36 * (rect.w / 320));
  box('bl', rect.x - 6 * (rect.w / 320), rect.y + rect.h - 30 * (rect.w / 320), 44 * (rect.w / 320), 36 * (rect.w / 320));
  box('br', rect.x + rect.w - 38 * (rect.w / 320), rect.y + rect.h - 30 * (rect.w / 320), 44 * (rect.w / 320), 36 * (rect.w / 320));
  box('top', rect.x + rect.w * 0.5 - 22 * (rect.w / 320), rect.y - 8 * (rect.w / 320), 44 * (rect.w / 320), 40 * (rect.w / 320));
  return out;
}, A_on1, rS);
for (const k of Object.keys(crops)) writeFileSync(`${OUT}/gate2${TAG}-A-${k}-8x.png`, Buffer.from(String(crops[k]).split(',')[1], 'base64'));

/* ── 单层玻璃 / 无描边 ────────────────────────────────────────────── */
const style = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const cs = getComputedStyle(el);
  const inner = [...el.querySelectorAll('*')].filter((x) => {
    const s = getComputedStyle(x);
    return s.backdropFilter && s.backdropFilter !== 'none';
  });
  return { bg: cs.backgroundColor, bf: cs.backdropFilter, border: cs.borderTopWidth, outline: cs.outlineWidth,
    filter: cs.filter, shadowRaw: String(cs.boxShadow).slice(0, 160),
    shadowLayers: (function () {
      var s = String(cs.boxShadow), d = 0, n = 0;
      if (s === 'none') return 0;
      for (var i = 0; i < s.length; i++) { var c = s[i]; if (c === '(') d++; else if (c === ')') d--; else if (c === ',' && !d) n++; }
      return n + 1;
    })(), innerBackdrop: inner.length };
});
await page.evaluate(() => { const s = document.getElementById('pc-blank'); if (s) s.remove(); });
const edgeStats = await page.evaluate(() => { const s = window.__gevEdge.stats(); return { fps: s.fps, drawFps: s.drawFps, frames: s.frames, err: s.err }; });

/* ── 断言 ─────────────────────────────────────────────────────────── */
const dispMax = Math.max.apply(null, A.top.dprof.slice(0, 12));
rec('T1 顶沿高光可见（未冻结实时合成 Δ 峰值 ≥ 30 灰阶，位于最外 4px）',
  A.top.peak >= 30 && A.top.peakK <= 4, { peak: A.top.peak, peakK: A.top.peakK, prof: A.top.prof.slice(0, 8) });
rec('T2 边缘整段有折射（第 1–8px Δ 均值 ≥ 8 灰阶）', A.top.bandMean >= 8, { bandMean: A.top.bandMean, prof: A.top.prof.slice(0, 14) });
rec('T3 单峰剖面（band 内 ≤1 个局部极大 → 无外圈+内圈双线）', A.top.peaks <= 1, { peaks: A.top.peaks, prof: A.top.prof.slice(0, 14) });
rec('T4 四条边都有折射（左/下/右 Δ 峰值 ≥ 4）', A.left.peak >= 4 && A.bot.peak >= 4 && A.right.peak >= 4,
  { left: A.left.peak, bot: A.bot.peak, right: A.right.peak });
rec('T5 卡片中心 100% 不受折射影响（Δ 恒 0）', A.top.centerMax === 0, { centerMax: A.top.centerMax, px: A.top.centerN });
rec('T6 色散可见但克制（band 内 max|ΔR−ΔB| 6–45；本卡只记录，C2 负责）', dispMax >= 6 && dispMax <= 45,
  { dispMax, dprof: A.top.dprof.slice(0, 12) }, true);
rec('T6b 画布自读四边都在画（合成到 128 灰底的 |Δlum| 峰值 > 0）',
  canvasA.top.peak > 0 && canvasA.left.peak > 0 && canvasA.bot.peak > 0 && canvasA.right.peak > 0,
  { top: canvasA.top.peak, left: canvasA.left.peak, bot: canvasA.bot.peak, right: canvasA.right.peak, bbox: canvasA.bbox });
rec('T6c 仪器噪声：同状态连拍 Δ = 0（未冻结 / 冻结 两态）',
  Anoise.noise.max === 0 && Bnoise.noise.max === 0, { A: Anoise.noise, B: Bnoise.noise });
rec('T6d 实时可用（未冻结、真底图）：边缘 Δ ÷ 中心 Δ ≥ 2 → 层真的合成上屏',
  C_ratio >= 2, { edgeMean: +C_edge.toFixed(2), centerMean: +C_center.toFixed(2), ratio: C_ratio,
    pageNoise: Cnoise.noise, top: Cm.top.prof.slice(0, 10) });
rec('T7 单层玻璃：0 border / 0 outline / 0 backdrop-filter / 卡内 0 第二层玻璃',
  style.border === '0px' && style.outline === '0px' && (!style.bf || style.bf === 'none') && style.innerBackdrop === 0, style);
rec('T8 FPS ≥ 50（idle，rAF p50）', fpsIdle.fps >= 50, fpsIdle);
rec('T9 FPS ≥ 50（hover 真指针）', fpsHover.fps >= 50, fpsHover);
rec('T10 无长帧冻结（worst ≤ 100ms）', fpsIdle.worstMs <= 100 && fpsHover.worstMs <= 100, { idle: fpsIdle.worstMs, hover: fpsHover.worstMs });
rec('T11 渲染无 JS 报错', errs.filter((e) => !/Failed to load resource|favicon/i.test(e)).length === 0, errs.slice(0, 4));

writeFileSync(`${OUT}/gate2${TAG}.json`, JSON.stringify({
  instrument: 'v2 · 平坦灰底解析合成（A 未冻结 / B 冻结）+ 画布自读 + 实时区分器（C）',
  gpu, rect: r, band, stacking,
  stateA_unfrozen: A, stateA_noise: Anoise.noise, stateA_canvas: canvasA,
  stateB_frozen: Bm, stateB_noise: Bnoise.noise, stateB_canvas: canvasB,
  stateC_liveMap: { delta: Cm, noise: Cnoise.noise, edgeBandMean: +C_edge.toFixed(2), centerMean: +C_center.toFixed(2), ratio: C_ratio },
  style, fps: { fpsIdle, fpsHover }, edgeStats, edgeStats0, errs, results: R,
}, null, 1));

console.log('A(未冻结) top peak', A.top.peak, 'k', A.top.peakK, 'bandMean', A.top.bandMean, 'prof', JSON.stringify(A.top.prof));
console.log('A left/bot/right peak', A.left.peak, A.bot.peak, A.right.peak, 'centerMax', A.top.centerMax);
console.log('B(冻结)   top peak', Bm.top.peak, 'left/bot/right', Bm.left.peak, Bm.bot.peak, Bm.right.peak, 'centerMax', Bm.top.centerMax);
console.log('C(真地图) edge/center', C_edge.toFixed(2), '/', C_center.toFixed(2), 'ratio', C_ratio, 'top', JSON.stringify(Cm.top.prof.slice(0, 8)));
const counted = R.filter((x) => !x.skip);
const pass = counted.filter((x) => x.ok).length;
console.log('\n' + pass + '/' + counted.length + ' PASS   (json: ' + OUT + '/gate2' + TAG + '.json)');
await browser.close();
process.exit(pass === counted.length ? 0 : 1);
