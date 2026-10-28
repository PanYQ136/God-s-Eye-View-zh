#!/usr/bin/env node
/**
 * review-lg-probe32.mjs —— 第六轮复核 · Contract lens（reviewer 专用、只读）
 *  目标：独立验证 §3.3「输出 alpha：regular 0.86–0.92 / clear 0.70–0.80，禁止内部 alpha=1」
 *  两条互相独立的度量，都不复用实现者的 __gevGlAlphaProbe 钩子：
 *  A) 合成方程法（纯 DOM/CSS + 截图，物理层面）：
 *     把玻璃画布下方铺色板，取 G 通道，色板 0 → 255，得 ΔG_on = (1-sA)·(1-α)·255
 *     再把 #gev-gl-glass display:none 同法复测 → ΔG_off = (1-sA)·255
 *     α_eff = 1 - ΔG_on / ΔG_off   （α=1 时 ΔG_on=0；旧「不透明拷贝」必然读数 ≈1.00）
 *  B) 自己的 rAF 内 gl.readPixels（不用实现者钩子，坐标与算法均由本脚本给出）
 *     + A/B：interiorRegular 0.86 / 0.90 / 0.92、interiorClear 0.70 / 0.75 / 0.80 三档线性
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r6rev';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--window-size=1536,730']
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await sleep(13000);
await page.evaluate(() => { const x = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (x) x.click(); });
await sleep(2500);
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await sleep(800);

const surfaces = await page.evaluate(() => window.__gevGlStats().surfaces.map((s) => ({ id: s.id, variant: s.variant, interior: s.interior, rect: s.rect })));

/* ─────────── A) 合成方程法 ─────────── */
await page.evaluate(() => {
  if (document.getElementById('__revPlate')) return;
  const d = document.createElement('div');
  d.id = '__revPlate';
  d.style.cssText = 'position:fixed;inset:0;background:#000;z-index:3;pointer-events:none';
  document.body.appendChild(d);
});
// 取样区：卡内右侧 72%–86% 宽、竖向 38%–52%（避开标题/图标/芯片），取中位数
const sampleRects = surfaces.filter((s) => s.id !== 'gev-gfx-fab').map((s) => {
  const [x, y, w, h] = s.rect;
  return { id: s.id, x: x + w * 0.72, y: y + h * 0.38, w: Math.max(6, w * 0.14), h: Math.max(6, h * 0.14) };
});

async function shotG(rects) {
  const { data, info } = await sharp(await page.screenshot({ omitBackground: true })).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, ch = info.channels, out = {};
  for (const r of rects) {
    const x0 = Math.round(r.x * 2), y0 = Math.round(r.y * 2);
    const x1 = Math.min(W, x0 + Math.round(r.w * 2)), y1 = Math.min(H, y0 + Math.round(r.h * 2));
    const gs = [];
    for (let rr = y0; rr < y1; rr++) for (let cc = x0; cc < x1; cc++) gs.push(data[(rr * W + cc) * ch + 1]);
    gs.sort((a, b) => a - b);
    out[r.id] = gs.length ? gs[Math.floor(gs.length / 2)] : null;
  }
  return out;
}
async function pair(tag) {
  await page.evaluate(() => { document.getElementById('__revPlate').style.background = '#000000'; });
  await sleep(260);
  const g0 = await shotG(sampleRects);
  await page.evaluate(() => { document.getElementById('__revPlate').style.background = '#00ff00'; });
  await sleep(260);
  const g1 = await shotG(sampleRects);
  return { tag, g0, g1 };
}
const onPair = await pair('glass-on');
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = 'none'; });
await sleep(400);
const offPair = await pair('glass-off');
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = ''; });
await sleep(400);
await page.evaluate(() => { const p = document.getElementById('__revPlate'); p.style.background = '#000000'; p.style.display = 'none'; });
await sleep(200);

const compose = sampleRects.map((r) => {
  const dOn = onPair.g1[r.id] - onPair.g0[r.id];
  const dOff = offPair.g1[r.id] - offPair.g0[r.id];
  const v = surfaces.find((s) => s.id === r.id);
  return {
    id: r.id, variant: v.variant, uniformInterior: v.interior,
    dG_on: dOn, dG_off: dOff,
    alphaEff: dOff > 4 ? +(1 - dOn / dOff).toFixed(3) : null
  };
});

/* ─────────── B) 自己的 rAF readPixels ─────────── */
async function fbAlpha(patch) {
  if (patch) await page.evaluate((p) => window.__gevGlSet(p), patch);
  await sleep(500);
  const res = await page.evaluate(async (surf) => {
    const cv = document.getElementById('gev-gl-glass');
    if (!cv) return { err: 'no glass canvas' };
    let gl = null;
    try { gl = cv.getContext('webgl2'); } catch (e) {}
    if (!gl) return { err: 'no gl' };
    const st = window.__gevGlStats();
    const scale = st.scale, H = cv.height;
    const pts = [], meta = [];
    for (const s of surf) {
      const [x, y, w, h] = s.rect;
      const list = [];
      for (const fx of [0.25, 0.35, 0.45, 0.55, 0.65, 0.75]) for (const fy of [0.25, 0.45, 0.65]) list.push([x + w * fx, y + h * fy]);
      const innerN = list.length;
      for (const d of [1, 2, 3, 4, 6, 10, 16, 24]) list.push([x + w * 0.5, y + d]);
      meta.push({ id: s.id, variant: s.variant, uniform: s.interior, innerN });
      list.forEach((p) => pts.push(p));
    }
    // 自己的 rAF：glass 的 frame() 在上一帧末尾已 re-register，因此本回调在其后、合成前执行
    const buf = new Uint8Array(4);
    const read = () => pts.map((p) => { gl.readPixels(Math.round(p[0] * scale), Math.round(H - p[1] * scale), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf); return [buf[3], buf[0], buf[1], buf[2]]; });
    let vals = null;
    await new Promise((r) => requestAnimationFrame(() => { vals = read(); r(); }));
    if (!vals || vals.every((v) => v[0] === 0)) {
      // 兜底：连续两帧内读
      await new Promise((r) => requestAnimationFrame(() => { vals = read(); r(); }));
    }
    const rows = [];
    let k = 0;
    for (const m of meta) {
      const seg = vals.slice(k, k + m.innerN + 8); k += m.innerN + 8;
      const inner = seg.slice(0, m.innerN).map((v) => v[0]).sort((a, b) => a - b);
      rows.push({
        id: m.id, variant: m.variant, uniform: m.uniform,
        innerP50: inner[Math.floor(inner.length / 2)], innerMin: inner[0], innerMax: inner[inner.length - 1],
        edgeRamp: seg.slice(m.innerN).map((v) => v[0])
      });
    }
    return { scale, canvas: [cv.width, cv.height], rows };
  }, surfaces);
  return res;
}

const fb = {};
fb['0.90/0.75'] = await fbAlpha({ interiorRegular: 0.90, interiorClear: 0.75 });
fb['0.86/0.70'] = await fbAlpha({ interiorRegular: 0.86, interiorClear: 0.70 });
fb['0.92/0.80'] = await fbAlpha({ interiorRegular: 0.92, interiorClear: 0.80 });
await page.evaluate(() => window.__gevGlSet({ interiorRegular: 0.90, interiorClear: 0.75 }));
await sleep(300);

/* ─────────── C) 结构快照（与 alpha 同轮） ─────────── */
const struct = await page.evaluate(() => {
  const cv = document.getElementById('gev-gl-glass');
  const st = window.__gevGlStats();
  return {
    scale: st.scale, canvas: [cv.width, cv.height], dpr: st.dpr, surfaces: st.count,
    interiorCfg: st.config.interiorRegular + '/' + st.config.interiorClear,
    canvasCss: getComputedStyle(cv).opacity + '|' + getComputedStyle(cv).mixBlendMode
  };
});

const out = { probe: 'review-lg-probe32', url: URL, struct, compose, fb, consoleErrors: errs };
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(`${OUT}/probe32-alpha.json`, JSON.stringify(out, null, 1));
await page.screenshot({ path: `${OUT}/probe32-page.png` });
await browser.close();
