#!/usr/bin/env node
/* review-lg-probe26.mjs —— 第五轮复核 · Contract lens（reviewer 专用、只读，不改实现文件）
   逐条对照强制规范 §3.3 / §3.4 / §3.5 / §3.6 / §5.2 / §5.3 / §5.4：
   A) 材质合同：interior alpha 0.86–0.92(regular) / 0.7–0.8(clear)、tint≤0.02、dim 0.35、变体分布
   B) 玻璃画布真实 alpha：readPixels 中心 vs 边缘（正则 interior / clear）
   C) 圆角 concentric：外层 16，内层 = 外 - padding；只一圈边（border 与 inset shadow 不同时存在）
   D) 展开动效：实测时长 350–450ms；透镜调制定量（uAnim=1 时折射带变宽）；非 opacity 淡入
   E) 指针 specular 跟随（边缘 vs 远处，rim 峰值高度与位置）
   F) 离屏裁剪：把卡移出视口后 surfaces 数下降
   G) prefers-reduced-motion：取消 morph，但材质保留
   H) 卡内溢出 / 可见滚动条 / 纯黑字
   运行：node scripts/review-lg-probe26.mjs http://127.0.0.1:4173/
*/
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r5';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await sleep(13000);
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (b) b.click(); });
await sleep(2500);

const out = { probe: 'review-lg-probe26', url: URL, ts: new Date().toISOString() };

/* ───────── A + B + C + H：材质合同 / alpha / 圆角 / 结构 ───────── */
const A = await page.evaluate(() => {
  const S = window.__gevGlStats();
  const parseR = (s) => { const v = parseFloat(s); return Number.isFinite(v) ? v : (s === '50%' ? -1 : null); };
  const rings = (cs) => {
    let n = 0;
    if (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none') n++;
    const sh = cs.boxShadow && cs.boxShadow !== 'none' ? cs.boxShadow : '';
    // 统计 "0 0 0 1px" 形式的 inset 描边层
    const inset = sh.split(/,(?![^(]*\))/).filter((x) => /inset/.test(x) && /(^|\s)0(px)?\s+0(px)?\s+0(px)?\s+[0-9.]+px/.test(x));
    n += inset.length;
    return { count: n, border: cs.borderTopWidth + ' ' + cs.borderTopStyle, shadowInsetLayers: inset.length, shadow: sh.slice(0, 200) };
  };
  const cards = [...document.querySelectorAll('.gev-lc')].map((el) => {
    const cs = getComputedStyle(el);
    const b = el.getBoundingClientRect();
    const inner = el.querySelector('.pp-panel-body, .panel-inner, .panel-body, .gev-lc-body');
    const ics = inner ? getComputedStyle(inner) : null;
    const ib = inner ? inner.getBoundingClientRect() : null;
    return {
      id: el.id,
      variant: el.dataset.gevVariant || el.getAttribute('data-gev-variant') || '(css)',
      lum: el.dataset.gevLum,
      radiusOuter: cs.borderTopLeftRadius, radiusInner: ics ? ics.borderTopLeftRadius : null,
      padL: parseFloat(cs.paddingLeft) || 0, padT: parseFloat(cs.paddingTop) || 0,
      innerOffsetX: ib ? +(ib.left - b.left).toFixed(1) : null,
      innerOffsetY: ib ? +(ib.top - b.top).toFixed(1) : null,
      ring: rings(cs),
      backdrop: cs.backdropFilter,
      bg: cs.backgroundColor,
      rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)],
    };
  });
  /* H) 卡内溢出 / 可见滚动条 */
  const overflow = cards.map((c) => {
    const el = document.getElementById(c.id);
    const cand = [...el.querySelectorAll('*')].filter((n) => {
      const s = getComputedStyle(n);
      return /(auto|scroll)/.test(s.overflowY + s.overflowX) && n.offsetParent;
    });
    const bad = cand.filter((n) => n.scrollHeight > n.clientHeight + 2 && (n.offsetWidth - n.clientWidth) > 1).map((n) => ({ cls: String(n.className).slice(0, 50), dh: n.scrollHeight - n.clientHeight, dw: n.offsetWidth - n.clientWidth }));
    return { id: c.id, scrollers: cand.length, visibleScrollbars: bad };
  });
  /* 纯黑字 */
  const blackText = [...document.querySelectorAll('.gev-lc *')].filter((n) => {
    if (!n.textContent || !n.textContent.trim() || !n.offsetParent) return false;
    const s = getComputedStyle(n);
    if (s.visibility === 'hidden' || parseFloat(s.opacity) < 0.15) return false;
    if (![...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) return false;
    const m = s.color.match(/rgba?\(([^)]+)\)/);
    if (!m) return false;
    const [r, g, b] = m[1].split(',').map(Number);
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.02;
  }).map((n) => ({ tag: n.tagName, cls: String(n.className).slice(0, 50), color: getComputedStyle(n).color }));
  return { config: S.config, count: S.count, devicePx: S.devicePx, dpr: S.dpr, scale: S.scale, max: S.max, surfaces: S.surfaces.map((s) => ({ id: s.id, variant: s.variant, lum: s.lum, bezel: s.bezel, interior: s.interior, dim: s.dim, radius: s.radius, rect: s.rect })), cards, overflow, blackText };
});
out.A_material = A;

/* B) 画布真实 alpha：中心 vs 边缘 */
out.B_alpha = await page.evaluate(() => {
  const S = window.__gevGlStats();
  return S.surfaces.map((s) => {
    const [x, y, w, h] = s.rect;
    const cy = y + Math.round(h / 2);
    const cx = x + Math.round(w / 2);
    const edge = window.__gevGlReadPixel(x + 2, cy);
    const mid = window.__gevGlReadPixel(x + Math.round(Math.min(w, h) * 0.35), cy);
    const center = window.__gevGlReadPixel(cx, cy);
    return { id: s.id, variant: s.variant, interior: s.interior, alphaEdge: edge && edge[3], alphaMid: mid && mid[3], alphaCenter: center && center[3], expect: Math.round(s.interior * 255) };
  });
});

/* D) 展开动效：实测时长 + 透镜调制 */
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await sleep(600);
const bandWidth = async (rect, animOn) => {
  const clip = { x: Math.max(0, rect[0] - 6), y: rect[1] + 18, width: 44, height: 56 };
  const shot = async (gain) => {
    await page.evaluate((g) => window.__gevGlSet({ gain: g }), gain);
    await sleep(400);
    const buf = await page.screenshot({ clip });
    const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, info };
  };
  if (animOn) await page.evaluate(() => { window.__gevGlassAnim = { t0: performance.now() - 50000, dur: 100000 }; });
  else await page.evaluate(() => { window.__gevGlassAnim = null; });
  await sleep(300);
  const a = await shot(0.9);
  const b = await shot(0);
  const cols = a.info.width, rows = a.info.height;
  const prof = [];
  for (let c = 0; c < cols; c++) {
    let s = 0;
    for (let r = 0; r < rows; r++) {
      const i = (r * cols + c) * a.info.channels;
      for (let k = 0; k < 3; k++) s += Math.abs(a.data[i + k] - b.data[i + k]);
    }
    prof.push(s / (rows * 3));
  }
  // 带宽 = 从卡片边缘（clip 内 6 CSS px 处）向内，prof > 2(0-255) 的连续列数，折算 CSS px
  const startCol = Math.round(6 * (cols / 44));
  let last = -1;
  for (let c = startCol; c < cols; c++) if (prof[c] > 2) last = c;
  const bandCss = last < 0 ? 0 : +((last - startCol) / (cols / 44)).toFixed(1);
  await page.evaluate((g) => window.__gevGlSet({ gain: g }), 0.9);
  await page.evaluate(() => { window.__gevGlassAnim = null; });
  return { bandCss, prof: prof.slice(startCol, startCol + 40).map((v) => +v.toFixed(1)) };
};
const dp = await page.evaluate(() => { const r = document.querySelector('#data-panel').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; });
out.D_band_anim0 = await bandWidth(dp, false);
out.D_band_anim1 = await bandWidth(dp, true);

/* D2) 实测展开时长（rAF 采样卡壳高度 + uAnim 信号帧数） */
await page.evaluate(() => {
  const el = document.querySelector('#data-panel');
  window.__T = { s: [], t0: performance.now() };
  const tick = () => {
    const r = el.getBoundingClientRect();
    window.__T.s.push([Math.round(performance.now() - window.__T.t0), +r.height.toFixed(1), +r.width.toFixed(1), window.__gevGlassAnim ? 1 : 0, +getComputedStyle(el).opacity]);
    if (performance.now() - window.__T.t0 < 1000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.evaluate(() => { const b = document.querySelector('#data-panel .panel-header, #data-panel .data-toggle-btn'); if (b) b.click(); });
await sleep(1100);
const T = await page.evaluate(() => window.__T.s);
const h0 = T[0][1];
const hEnd = Math.max(...T.map((x) => x[1]));
const settle = T.find((x) => Math.abs(x[1] - hEnd) < 0.6);
const animFrames = T.filter((x) => x[3] === 1).length;
const opacMin = Math.min(...T.map((x) => x[4]));
out.D_expand = { heightFrom: h0, heightTo: hEnd, settleMs: settle ? settle[0] : null, animFrames, totalFrames: T.length, opacityMin: opacMin, sample: T.filter((_, i) => i % 4 === 0).slice(0, 26) };
await sleep(700);
await page.evaluate(() => { const b = document.querySelector('#data-panel .panel-header, #data-panel .data-toggle-btn'); if (b) b.click(); });
await sleep(900);

/* E) 指针 specular 跟随 */
const dpr2 = await page.evaluate(() => { const r = document.querySelector('#data-panel').getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
const rimSample = async () => {
  const clip = { x: dpr2.l - 2, y: dpr2.t + 4, width: 14, height: Math.max(30, dpr2.h - 10) };
  const buf = await page.screenshot({ clip });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rows = [];
  for (let r = 0; r < info.height; r++) {
    let mx = 0;
    for (let c = 0; c < 6; c++) {
      const i = (r * info.width + c) * info.channels;
      mx = Math.max(mx, 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    }
    rows.push(mx);
  }
  const m = Math.max(...rows);
  const at = rows.indexOf(m);
  return { max: +m.toFixed(1), peakRowCss: +(at / 2).toFixed(1), mean: +(rows.reduce((a, b) => a + b, 0) / rows.length).toFixed(1) };
};
await page.mouse.move(700, 400);
await sleep(500);
const rimFar = await rimSample();
await page.mouse.move(dpr2.l + 2, dpr2.t + Math.round(dpr2.h * 0.72));
await sleep(500);
const rimNearBottom = await rimSample();
await page.mouse.move(dpr2.l + 2, dpr2.t + Math.round(dpr2.h * 0.18));
await sleep(500);
const rimNearTop = await rimSample();
out.E_specular = { far: rimFar, nearBottom: rimNearBottom, nearTop: rimNearTop };

/* F) 离屏裁剪 */
out.F_cull = await page.evaluate(async () => {
  const S0 = window.__gevGlStats();
  const before = { count: S0.count, ids: S0.surfaces.map((s) => s.id) };
  const el = document.querySelector('#scene-panel');
  const prev = el.getAttribute('style') || '';
  el.setAttribute('data-prev-style', prev);
  el.style.position = 'fixed'; el.style.left = '-2200px'; el.style.top = '20px'; el.style.transform = 'none';
  await new Promise((r) => setTimeout(r, 700));
  const S1 = window.__gevGlStats();
  const off = { count: S1.count, ids: S1.surfaces.map((s) => s.id) };
  el.setAttribute('style', prev);
  await new Promise((r) => setTimeout(r, 700));
  const S2 = window.__gevGlStats();
  const back = { count: S2.count, ids: S2.surfaces.map((s) => s.id) };
  return { before, off, back, culled: before.count - off.count, restored: back.count === before.count };
});

/* G) prefers-reduced-motion */
const cdp = await page.createCDPSession();
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await sleep(600);
out.G_reduced_motion = await page.evaluate(async () => {
  const el = document.querySelector('#data-panel');
  const h0 = el.getBoundingClientRect().height;
  const t0 = performance.now();
  document.querySelector('#data-panel .panel-header, #data-panel .data-toggle-btn')?.click();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const h1 = el.getBoundingClientRect().height;
  const anim = !!window.__gevGlassAnim;
  const glass = document.getElementById('gev-gl-glass');
  const gcs = glass ? getComputedStyle(glass) : null;
  return { h0: +h0.toFixed(1), h1_after2frames: +h1.toFixed(1), jumpedIn2Frames: Math.abs(h1 - h0) > 8, animSignal: anim, glassDisplay: gcs ? gcs.display : null, msTo2Frames: +(performance.now() - t0).toFixed(1) };
});
await cdp.send('Emulation.setEmulatedMedia', { features: [] });
await sleep(500);
await page.evaluate(() => { const el = document.querySelector('#data-panel'); if (el && !el.classList.contains('collapsed')) document.querySelector('#data-panel .panel-header, #data-panel .data-toggle-btn')?.click(); });
await sleep(700);

/* 收尾：截图 + console error */
const shot = `${OUT}/p26-final-1536.png`;
await page.screenshot({ path: shot });
out.screenshot = shot;
out.consoleErrors = errs;
out.gpu = await page.evaluate(() => { const S = window.__gevGlStats(); return { scale: S.scale, devicePx: S.devicePx, dpr: S.dpr, count: S.count, fps: S.fps }; });
fs.writeFileSync(`${OUT}/probe26.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
