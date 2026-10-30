#!/usr/bin/env node
/* Phase6C 探针：真 Chrome + RTX3060，客观量「边缘透镜/镜面/色散」。

   仪器（为什么必须这样量）：
     · 折射层的采样纹理 = Cesium 画布（GPU→GPU），DOM 改不了它；
       但它**合成**在页面之上，直接截图 = 折射层 ⊕ 底图，材质与地图分不开。
     · 所以在 lens 画布(z-index:4)之下、地图之上插一块纯黑(0)遮板：
       屏上结果 = a · col —— 直接是 shader 自己的输出。
     · 再把采样纹理换成合成底（__gevEdge.testBg）：
         testBg(true, 8, 100)  → 平坦 100 灰：band 内亮度 = 斜面/镜面增益
         testBg(true, 8, null) → 8px 黑白条纹（R=G=B）：band 内通道极差 = 色散
     · 中心：lens 开/关 同一区域逐像素比较（应 100% 相同：depth>band 处 discard）。

   用法: node scripts/lc/_diag/phase6c-probe.mjs <tag>
   产物: .gev-logs/lc/phase6c/<tag>-<case>-*.png + <tag>.json */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] || 'probe';
const W = 1348, H = 774;
const OUT = '.gev-logs/lc/phase6c';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 参数扫描（name → __gevEdge.set 补丁）；{} = 源码默认值 */
const CASES = [
  { name: 'A_default', params: {} },
  { name: 'B_strong', params: { gain: 1.9, thick: 11 } },
  { name: 'C_soft', params: { gain: 1.25, thick: 8 } },
  { name: 'D_norim', params: { rimAmt: 0.55 } },
];

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
await sleep(5000);
await page.mouse.move(4, 400);
const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
console.log('GPU', JSON.stringify(gpu && { renderer: gpu.renderer, software: gpu.software }));
const cdp = await page.createCDPSession();

/* 页面内解码 + 沿边剖面（每 CSS px 一行/一列） */
const analyse = (b64, clip, edgePx, axis, bandCss) => page.evaluate(async (b64, clip, edgePx, axis, bandCss) => {
  const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
  const bmp = await createImageBitmap(blob);
  const cv = document.createElement('canvas');
  cv.width = bmp.width; cv.height = bmp.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  const f = axis === 'y' ? bmp.width / clip.width : bmp.height / clip.height;
  const lines = [], chroma = [];
  if (axis === 'y') {
    const x0 = Math.round(bmp.width * 0.3), x1 = Math.round(bmp.width * 0.7);
    for (let y = 0; y < bmp.height; y++) {
      let sr = 0, sg = 0, sb = 0, cM = 0;
      for (let x = x0; x < x1; x++) {
        const i = (y * bmp.width + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
        sr += r; sg += g; sb += b; cM = Math.max(cM, Math.max(r, g, b) - Math.min(r, g, b));
      }
      const n = x1 - x0;
      lines.push([sr / n, sg / n, sb / n]); chroma.push(cM);
    }
  } else {
    const y0 = Math.round(bmp.height * 0.3), y1 = Math.round(bmp.height * 0.7);
    for (let x = 0; x < bmp.width; x++) {
      let sr = 0, sg = 0, sb = 0, cM = 0;
      for (let y = y0; y < y1; y++) {
        const i = (y * bmp.width + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
        sr += r; sg += g; sb += b; cM = Math.max(cM, Math.max(r, g, b) - Math.min(r, g, b));
      }
      const n = y1 - y0;
      lines.push([sr / n, sg / n, sb / n]); chroma.push(cM);
    }
  }
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const edgeIdx = Math.round((axis === 'y' ? edgePx - clip.y : edgePx - clip.x) * f);
  const prof = [], cprof = [];
  for (let k = -3; k <= 18; k++) {
    const a = edgeIdx + Math.round(k * f), b = edgeIdx + Math.round((k + 1) * f);
    const seg = [], cseg = [];
    for (let i = Math.max(0, a); i < Math.min(lines.length, Math.max(b, a + 1)); i++) { seg.push(lum(lines[i])); cseg.push(chroma[i]); }
    prof.push(seg.length ? +(seg.reduce((x, y) => x + y) / seg.length).toFixed(1) : null);
    cprof.push(cseg.length ? Math.max(...cseg) : null);
  }
  const at = (k) => prof[k + 3];
  const band = Math.round(bandCss);
  const outBase = Math.max(at(-3) ?? 0, at(-2) ?? 0, at(-1) ?? 0);
  let peak = -1, peakK = -1;
  for (let k = 0; k < band; k++) { const v = at(k); if (v != null && v > peak) { peak = v; peakK = k; } }
  const coverArr = [];
  for (let k = 2; k <= Math.max(2, band - 3); k++) { const v = at(k); if (v != null) coverArr.push(v); }
  const cover = coverArr.length ? coverArr.reduce((x, y) => x + y) / coverArr.length : 0;
  let step = 0;
  for (let k = band - 3; k <= band + 3; k++) { const x = at(k), y = at(k + 1); if (x != null && y != null) step = Math.max(step, Math.abs(y - x)); }
  let chromaMax = 0;
  for (let k = 1; k <= band - 1; k++) { const v = cprof[k + 3]; if (v != null) chromaMax = Math.max(chromaMax, v); }
  return {
    f: +f.toFixed(2), outBase: +outBase.toFixed(1), peak: +peak.toFixed(1), peakK, cover: +cover.toFixed(1),
    specAmp: +(peak - outBase).toFixed(1), coverAmp: +(cover - outBase).toFixed(1), innerStep: +step.toFixed(1),
    chromaMax, prof, cprof,
  };
}, b64, clip, edgePx, axis, bandCss);

const shot = async (name, rect, pad, scale) => {
  /* CDP 要求 clip 的数值是 double（整数会被序列化成 int 而报 deserialize 错误）*/
  const clip = { x: rect.x - pad + 0.01, y: rect.y - pad + 0.01, width: rect.w + pad * 2 + 0.02, height: rect.h + pad * 2 + 0.02, scale: scale + 0.0001 };
  const b64 = await page.screenshot({ clip, captureBeyondViewport: true, encoding: 'base64', type: 'png', optimizeForSpeed: true, fromSurface: true });
  const data = b64;
  writeFileSync(`${OUT}/${TAG}-${name}-${scale}x.png`, Buffer.from(data, 'base64'));
  return { data, clip };
};
const rectOf = (id) => page.evaluate((id) => {
  const b = document.getElementById(id).getBoundingClientRect();
  /* 不取整：整数会被 CDP 当 int 序列化 → clip 反序列化报 "double value expected" */
  const f = (v) => Math.round(v * 1000) / 1000 + 0.0001;
  return { x: f(b.x), y: f(b.y), w: f(b.width), h: f(b.height) };
}, id);
const setLayer = (text) => page.evaluate((t) => {
  let s = document.getElementById('pc-probe');
  if (!t) { if (s) s.remove(); return; }
  if (!s) { s = document.createElement('style'); s.id = 'pc-probe'; document.head.appendChild(s); }
  s.textContent = t;
}, text);
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
  await sleep(1100);
};

const results = [];
for (const c of CASES) {
  await page.evaluate((p) => window.__gevEdge.set(p), c.params);
  await page.evaluate(() => { window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }); });
  await sleep(600);
  const phase = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
  if (phase !== 'open') { await clickHeader('data-panel'); await sleep(700); }
  await sleep(500);
  const r = await rectOf('data-panel');
  const band = await page.evaluate(() => (window.__gevEdge.stats().surfaces.find((s) => s.id === 'data-panel') || {}).band || 12);
  const row = { case: c.name, params: c.params, rect: r, band };
  /* ① 真地图 · 内容可见 · 1x / 8x 角（肉眼） */
  await shot(`${c.name}-real`, r, 14, 1);
  await shot(`${c.name}-real-tl`, { x: r.x, y: r.y, w: 44, h: 36 }, 8, 8);
  /* ② 材质隔离：黑遮板 + 隐藏卡内内容 */
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'pc-black';
    d.style.cssText = 'position:fixed;inset:0;z-index:3;background:#000;pointer-events:none';
    document.body.appendChild(d);
  });
  await setLayer('#data-panel > *{visibility:hidden!important}');
  await sleep(700);
  /* 2a 平坦灰（100）纹理 → 斜面/镜面增益 */
  await page.evaluate(() => window.__gevEdge.testBg(true, 8, 100));
  await sleep(900);
  const clipTop = { x: r.x - 3, y: r.y - 3, width: 120, height: 34 };
  const clipLeft = { x: r.x - 3, y: r.y + 14, width: 34, height: 60 };
  const clipBot = { x: r.x - 3, y: r.y + r.h - 30, width: 120, height: 30 };
  row.flat = {
    top4: await analyse((await shot(`${c.name}-flat-top`, { x: r.x, y: r.y, w: 120, h: 34 }, 3, 4)).data, clipTop, r.y, 'y', band),
    top8: await analyse((await shot(`${c.name}-flat-top8`, { x: r.x, y: r.y, w: 60, h: 20 }, 3, 8)).data, { x: r.x - 3, y: r.y - 3, width: 66, height: 26 }, r.y, 'y', band),
    left4: await analyse((await shot(`${c.name}-flat-left`, { x: r.x, y: r.y + 14, w: 34, h: 60 }, 3, 4)).data, clipLeft, r.x, 'x', band),
    bot4: await analyse((await shot(`${c.name}-flat-bot`, { x: r.x, y: r.y + r.h - 30, w: 120, h: 30 }, 3, 4)).data, clipBot, r.y + r.h, 'y', band),
  };
  /* 2b 条纹底（R=G=B）→ 色散 */
  await page.evaluate(() => window.__gevEdge.testBg(true, 8, null));
  await sleep(900);
  row.disp = {
    top4: await analyse((await shot(`${c.name}-disp-top`, { x: r.x, y: r.y, w: 120, h: 34 }, 3, 4)).data, clipTop, r.y, 'y', band),
    top8: await analyse((await shot(`${c.name}-disp-top8`, { x: r.x, y: r.y, w: 60, h: 20 }, 3, 8)).data, { x: r.x - 3, y: r.y - 3, width: 66, height: 26 }, r.y, 'y', band),
  };
  await page.evaluate(() => window.__gevEdge.testBg(false, 8, null));
  await sleep(500);
  /* 2c 中心：lens 开/关 必须逐像素相同 */
  const cClip = { x: r.x + Math.round(r.w * 0.35), y: r.y + Math.round(r.h * 0.4), width: 40, height: 30 };
  const cOn = await shot(`${c.name}-center-on`, cClip, 0, 4);
  await page.evaluate(() => window.__gevEdge.off());
  await sleep(400);
  const cOff = await shot(`${c.name}-center-off`, cClip, 0, 4);
  await page.evaluate(() => window.__gevEdge.on());
  await sleep(400);
  row.center = await page.evaluate(async (a, b) => {
    const dec = async (s) => {
      const blob = await (await fetch('data:image/png;base64,' + s)).blob();
      const bmp = await createImageBitmap(blob);
      const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
      const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
      return cx.getImageData(0, 0, bmp.width, bmp.height).data;
    };
    const A = await dec(a), B = await dec(b);
    let max = 0, changed = 0;
    for (let i = 0; i < A.length; i += 4) {
      const dd = Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2]));
      if (dd > 2) changed++;
      max = Math.max(max, dd);
    }
    return { max, changedPx: changed };
  }, cOn.data, cOff.data);
  /* 清理 */
  await page.evaluate(() => { const d = document.getElementById('pc-black'); if (d) d.remove(); });
  await setLayer('');
  await sleep(300);
  const st = await page.evaluate(() => window.__gevEdge.stats());
  row.stats = { band: st.band, dispPx: st.dispPx, gain: st.gain, bandAlpha: st.bandAlpha, rimAmt: st.rimAmt, count: st.count, drawFps: st.drawFps, fps: st.fps };
  results.push(row);
  const g = (o) => ({ peak: o.peak, peakK: o.peakK, cover: o.cover, spec: o.specAmp, coverAmp: o.coverAmp, step: o.innerStep, chroma: o.chromaMax, prof: o.prof.slice(0, 17) });
  console.log(c.name, JSON.stringify({
    band, flatTop4: g(row.flat.top4), flatTop8: g(row.flat.top8), flatLeft4: g(row.flat.left4), flatBot4: g(row.flat.bot4),
    disp4: { chroma: row.disp.top4.chromaMax, cprof: row.disp.top4.cprof.slice(0, 15) },
    center: row.center, stats: row.stats,
  }));
}
writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(results, null, 1));
console.log('written', `${OUT}/${TAG}.json`);
await browser.close();
