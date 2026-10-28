#!/usr/bin/env node
/**
 * review-lg-probe9.mjs —— 决策性复核
 * A. 色散：edgeSharp=0、中性条纹（多周期），同一帧内 R/B 通道轮廓的横向配准位移（device px → CSS px）
 * B. 纯白地图 + 逐卡"文字元素矩形"裁切，量亮底最坏情况对比度（9 卡 + 顶栏芯片 + 语音标签）
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(OUT, { recursive: true });
const out = { url, errors: [], tests: {} };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => out.errors.push('pageerror: ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 12000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => {
  const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent);
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 900));

const grab = async (x, y, w, h, tag, scaleUp) => {
  let buf = await page.screenshot({ clip: { x, y, width: w, height: h } });
  if (scaleUp) buf = await sharp(buf).resize({ width: Math.round(w * 2 * scaleUp), kernel: 'nearest' }).png().toBuffer();
  if (tag) fs.writeFileSync(path.join(OUT, tag + '.png'), buf);
  const raw = await page.screenshot({ clip: { x, y, width: w, height: h } });
  const { data, info } = await sharp(raw).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
};

/* ── A. 色散：同帧 R vs B 配准 ── */
const lc0 = await page.evaluate(() => window.__gevLc.info('data-panel'));
out.cardRect = lc0;
await page.evaluate(() => window.__gevGlSet({ edgeSharp: 0 }));
const perPeriod = [];
for (const period of [24, 48, 64]) {
  await page.evaluate((p) => window.__gevGlTestBg(true, p), period);
  await new Promise((r) => setTimeout(r, 1100));
  const img = await grab(Math.round(lc0.x - 2), Math.round(lc0.y + 6), 24, Math.max(10, lc0.h - 12), 'p9-stripes-' + period, period === 48 ? 4 : 0);
  const W = img.w, H = img.h, ch = img.ch;
  // 每行：R、G、B 三条轮廓做 SAD 配准（R vs B、G vs B）
  const lagOf = (ca, cb) => {
    const res = [];
    for (let y = 2; y < H - 2; y++) {
      const a = [], b = [];
      for (let x = 0; x < W; x++) {
        a.push(img.data[(y * W + x) * ch + ca]);
        b.push(img.data[(y * W + x) * ch + cb]);
      }
      let best = 0, bv = Infinity;
      for (let lag = -12; lag <= 12; lag++) {
        let s = 0, n = 0;
        for (let x = 12; x < W - 12; x++) { s += Math.abs(a[x] - b[x + lag]); n++; }
        const v = s / n; if (v < bv) { bv = v; best = lag; }
      }
      res.push(best);
    }
    res.sort((x, y) => x - y);
    return { med: res[Math.floor(res.length / 2)], mean: +(res.reduce((s, v) => s + v, 0) / res.length).toFixed(2), hist: res.reduce((m, v) => ((m[v] = (m[v] || 0) + 1), m), {}) };
  };
  perPeriod.push({ period, R_vs_B: lagOf(0, 2), G_vs_B: lagOf(1, 2), R_vs_G: lagOf(0, 1) });
}
await page.evaluate(() => { window.__gevGlSet({ edgeSharp: 0.65 }); window.__gevGlTestBg(false); });
await new Promise((r) => setTimeout(r, 500));
out.tests.disp = perPeriod;
console.log('A_DISP ' + JSON.stringify(perPeriod));

/* ── B. 纯白地图 + 逐卡文字矩形对比度 ── */
out.clearWhite = await page.evaluate(() => {
  const cands = [...document.querySelectorAll('canvas')].filter((c) => c.id !== 'gev-gl-glass');
  const mapCv = cands.sort((a, b) => b.width * b.height - a.width * a.height)[0];
  const gl2 = mapCv.getContext('webgl2'), gl = gl2 || mapCv.getContext('webgl');
  if (!gl) return { ok: false };
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  return { ok: true, size: [mapCv.width, mapCv.height] };
});
await new Promise((r) => setTimeout(r, 1800));

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const contrastOf = async (clip, tag) => {
  const buf = await page.screenshot({ clip });
  if (tag) fs.writeFileSync(path.join(OUT, tag + '.png'), buf);
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = [];
  for (let i = 0; i < data.length; i += info.channels) L.push(0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]));
  L.sort((x, y) => x - y);
  const q = (p) => L[Math.min(L.length - 1, Math.floor(p * L.length))];
  const bg = q(0.5), fg = q(0.985);
  return { bg: +bg.toFixed(3), fg: +fg.toFixed(3), ratio: +(((fg + 0.05) / (bg + 0.05))).toFixed(2), p99: +q(0.99).toFixed(3), max: +L[L.length - 1].toFixed(3) };
};

// 收集每张卡的"文字元素"矩形（标题 / 首个文本节点父元素）
const texts = await page.evaluate(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'gev-gfx-fab', 'control-panel', 'gev-voice-control'];
  const res = [];
  for (const id of ids) {
    const root = document.getElementById(id) || document.querySelector('#' + id);
    if (!root) { res.push({ id, missing: true }); continue; }
    const cands = [...root.querySelectorAll('*')].filter((e) => {
      const t = (e.textContent || '').trim();
      if (!t || t.length > 12) return false;
      if (e.children.length) return false;
      const r = e.getBoundingClientRect();
      return r.width > 8 && r.height > 6 && e.offsetParent;
    });
    // 取面积最大（最像标题）的一个
    cands.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return rb.width * rb.height - ra.width * ra.height; });
    const e = cands[0];
    if (!e) { res.push({ id, noText: true }); continue; }
    const r = e.getBoundingClientRect();
    res.push({ id, text: (e.textContent || '').trim(), cls: e.className, color: getComputedStyle(e).color, rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) } });
  }
  return res;
});
out.tests.white = {};
out.tests.white.cards = {};
for (const t of texts) {
  if (!t.rect) { out.tests.white.cards[t.id] = t; continue; }
  const clip = { x: Math.max(0, t.rect.x - 1), y: Math.max(0, t.rect.y - 1), width: Math.max(6, t.rect.w + 2), height: Math.max(6, t.rect.h + 2) };
  const c = await contrastOf(clip, 'p9-white-' + t.id);
  out.tests.white.cards[t.id] = { ...c, text: t.text, color: t.color, cls: t.cls, rect: t.rect };
}
// 顶栏芯片
out.tests.white.chips = {};
for (const [label, sel] of [['定位', '#top-center-actions'], ['fps', '#perf-hud']]) {
  const r = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; }, sel);
  if (r && r.w > 4) out.tests.white.chips[label] = { ...(await contrastOf({ x: r.x, y: r.y, width: r.w, height: r.h }, 'p9-white-chip-' + label)), rect: r };
}
out.tests.white.htmlLum = await page.evaluate(() => document.documentElement.dataset.gevGlassLum);
out.tests.white.faceLum = await page.evaluate(() => window.__gevGlStats().surfaces.map((s) => [s.id, +(+s.lum).toFixed(2)]));
await page.screenshot({ path: path.join(OUT, 'p9-white-full.png') });
out.errors = out.errors.slice(0, 8);
fs.writeFileSync(path.join(OUT, 'review-probe9.json'), JSON.stringify(out, null, 1));
console.log('B_WHITE ' + JSON.stringify(out.tests.white, null, 1));
console.log('errors=' + JSON.stringify(out.errors));
await browser.close();
