#!/usr/bin/env node
/**
 * review-lg-probe8.mjs —— 第二轮复核（reviewer 独立度量，第二轮）
 *  A. 色散：edgeSharp=0 + 中性条纹，同通道 ON vs OFF 的配准位移 → 逐通道 lag 差 = R/B 分离
 *  B. 亮背景：直接清空 Cesium canvas 为纯白（pdb 已开，画面保留）→ 真实最坏亮底下的标题对比度
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

const grab = async (x, y, w, h, tag) => {
  const buf = await page.screenshot({ clip: { x, y, width: w, height: h } });
  if (tag) fs.writeFileSync(path.join(OUT, tag + '.png'), buf);
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
};

await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 1000));
const lc0 = await page.evaluate(() => window.__gevLc.info('data-panel'));
out.cardRect = lc0;

/* ── A. 色散隔离：edgeSharp=0（斜面只采中性条纹，全图无色差来源） ── */
await page.evaluate(() => { window.__gevGlSet({ edgeSharp: 0 }); window.__gevGlTestBg(true, 16); });
await new Promise((r) => setTimeout(r, 1200));
const cx = Math.round(lc0.x - 2), cy = Math.round(lc0.y + 8), cw = 22, chh = Math.max(10, lc0.h - 16);
const ON = await grab(cx, cy, cw, chh, 'p8-disp-on');
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.52, etaHi: 1.52 }));
await new Promise((r) => setTimeout(r, 800));
const OFF = await grab(cx, cy, cw, chh, 'p8-disp-off');
await page.evaluate(() => { window.__gevGlSet({ etaLo: 1.48, etaHi: 1.56, edgeSharp: 0.65 }); window.__gevGlTestBg(false); });
await new Promise((r) => setTimeout(r, 600));

function chanLag(A, B, ch) {          // B 相对 A 的位移（device px）
  const lags = [];
  for (let y = 1; y < A.h - 1; y++) {
    const a = [], b = [];
    for (let x = 0; x < A.w; x++) { a.push(A.data[(y * A.w + x) * A.ch + ch]); b.push(B.data[(y * B.w + x) * B.ch + ch]); }
    let best = 0, bv = Infinity;
    for (let lag = -10; lag <= 10; lag++) {
      let s = 0, n = 0;
      for (let x = 12; x < A.w - 12; x++) { s += Math.abs(a[x] - b[x + lag]); n++; }
      const v = s / n; if (v < bv) { bv = v; best = lag; }
    }
    lags.push(best);
  }
  lags.sort((x, y) => x - y);
  const med = lags[Math.floor(lags.length / 2)];
  return { med, mean: +(lags.reduce((s, v) => s + v, 0) / lags.length).toFixed(2), hist: lags.reduce((m, v) => ((m[v] = (m[v] || 0) + 1), m), {}) };
}
const lR = chanLag(ON, OFF, 0), lG = chanLag(ON, OFF, 1), lB = chanLag(ON, OFF, 2);
out.tests.dispIsolated = {
  lagR: lR, lagG: lG, lagB: lB,
  lagDev_R_minus_B: lR.med - lB.med,
  lagCss_R_minus_B: +((lR.med - lB.med) / 2).toFixed(2),
  note: 'edgeSharp=0（斜面只采中性 16px 条纹）；同通道 ON vs OFF 配准，地图色度差被抵消',
};
console.log('A_DISP ' + JSON.stringify(out.tests.dispIsolated));

/* 原实现参数下的通道分离强度（对照实现者的 max/mean 说法） */
let fr = { on: 0, off: 0 };
{
  const W = ON.w, H = ON.h, ch = ON.ch;
  let mOn = 0, mOff = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * ch;
    mOn = Math.max(mOn, Math.abs(ON.data[i] - ON.data[i + 2]));
    mOff = Math.max(mOff, Math.abs(OFF.data[i] - OFF.data[i + 2]));
  }
  fr = { maxRB_on: mOn, maxRB_off: mOff };
}
out.tests.dispMaxRB = fr;

/* ── B. 纯白地图模拟：清空 Cesium canvas 为白（pdb 保留最后一帧） ── */
out.clearWhite = await page.evaluate(() => {
  try {
    const cands = [...document.querySelectorAll('canvas')].filter((c) => c.id !== 'gev-gl-glass');
    const mapCv = cands.sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const gl2 = mapCv.getContext('webgl2'), gl1 = gl2 ? null : mapCv.getContext('webgl');
    const gl = gl2 || gl1;
    if (!gl) return { ok: false, err: 'no gl ctx', canvases: cands.map((c) => [c.id, c.className, c.width, c.height]) };
    const prev = gl.getParameter(gl.COLOR_CLEAR_VALUE);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    return { ok: true, type: gl2 ? 'webgl2' : 'webgl', size: [mapCv.width, mapCv.height], prevClear: Array.from(prev) };
  } catch (e) { return { ok: false, err: String(e && e.message) }; }
});
await new Promise((r) => setTimeout(r, 1800));

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const wcagOf = async (clip, tag) => {
  const buf = await page.screenshot({ clip });
  if (tag) fs.writeFileSync(path.join(OUT, tag + '.png'), buf);
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = [];
  for (let i = 0; i < data.length; i += info.channels) L.push(0.2126 * lin(data[i]) + 0.7152 * lin(data[i + 1]) + 0.0722 * lin(data[i + 2]));
  L.sort((x, y) => x - y);
  const q = (p) => L[Math.min(L.length - 1, Math.floor(p * L.length))];
  const bg = q(0.5), fg = q(0.97);
  return { bg: +bg.toFixed(3), fg: +fg.toFixed(3), ratio: +(((fg + 0.05) / (bg + 0.05))).toFixed(2) };
};
out.tests.whiteSim = {
  mapPatch: await wcagOf({ x: 640, y: 640, width: 120, height: 60 }, 'p8-white-mappatch'),
};
const cardsToTest = ['data-panel', 'pp-toggles', 'display-panel', 'scene-panel', 'cctv-panel'];
out.tests.whiteSim.cards = {};
for (const id of cardsToTest) {
  const info = await page.evaluate((cid) => window.__gevLc.info(cid), id);
  if (!info) continue;
  const clip = { x: info.x + 6, y: info.y + 6, width: Math.max(20, info.w - 12), height: Math.min(26, info.h - 12) };
  const w = await wcagOf(clip, 'p8-white-' + id);
  const st = await page.evaluate((cid) => {
    const el = document.getElementById(cid);
    const shell = el.closest('.gev-lc') || el;
    const t = el.querySelector('.panel-title') || el.querySelector('h2,h3') || el.querySelector('.pp-title');
    const cs = t ? getComputedStyle(t) : null;
    return { dataLum: el.getAttribute('data-gev-lum') || shell.getAttribute('data-gev-lum'), color: cs && cs.color, lum: (window.__gevGlStats().surfaces.find((s) => s.id === cid) || {}).lum };
  }, id);
  out.tests.whiteSim.cards[id] = { ...w, ...st, rect: info };
}
await page.screenshot({ path: path.join(OUT, 'p8-white-full.png') });

/* 亮底 dim / clear 变体目视证据 */
out.tests.whiteSim.htmlLum = await page.evaluate(() => document.documentElement.dataset.gevGlassLum);
out.errors = out.errors.slice(0, 8);
fs.writeFileSync(path.join(OUT, 'review-probe8.json'), JSON.stringify(out, null, 1));
console.log('B_WHITE ' + JSON.stringify(out.tests.whiteSim, null, 1));
console.log('errors=' + JSON.stringify(out.errors));
await browser.close();
