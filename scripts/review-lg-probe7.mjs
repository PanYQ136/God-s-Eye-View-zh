#!/usr/bin/env node
/**
 * review-lg-probe7.mjs —— 第二轮复核（reviewer 独立脚本，不复用实现者度量）
 *  A. 中性条纹背景上 R/B 轮廓横向偏移（互不相关通道的 SAD 配准，单位 device px → CSS px）
 *  B. 真实亮背景（盐湖）下的卡片标题文字对比度 + 背景实际亮度核验
 *  C. 按下时的玻璃外壳内缩（沿边缘的亮度阶跃位移）
 *  D. 展开/兄弟卡 morph + 单层玻璃/滚动条/黑字 DOM 审计 + console error
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

// 关掉首次启动弹窗（否则遮住中部卡片）
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button,a,div')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent);
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 1500));
out.modal = await page.evaluate(() => {
  const t = document.body.innerText;
  return { stillThere: /选择你的第一视角/.test(t) };
});

const grab = async (x, y, w, h, tag) => {
  const buf = await page.screenshot({ clip: { x, y, width: w, height: h } });
  if (tag) fs.writeFileSync(path.join(OUT, tag + '.png'), buf);
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
};

out.globals = await page.evaluate(() => ({
  viewer: !!window.__gevViewer, Cesium: !!window.Cesium, CESIUM: !!window.__CESIUM__,
  stats: !!window.__gevGlStats, set: !!window.__gevGlSet, testBg: !!window.__gevGlTestBg,
}));

/* ───────── A. 中性条纹背景：R/B 横向偏移 ───────── */
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 1200));
const lc0 = await page.evaluate(() => window.__gevLc.info('data-panel'));
out.cardRect = lc0;

await page.evaluate(() => window.__gevGlTestBg(true, 16));
await new Promise((r) => setTimeout(r, 1200));
const clipX = Math.round(lc0.x - 2), clipW = 22;
const clipY = Math.round(lc0.y + 8), clipH = Math.max(10, lc0.h - 16);
const ON = await grab(clipX, clipY, clipW, clipH, 'p7-stripes-disp-on');
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.52, etaHi: 1.52 }));   // dispGate=0 → 无色散
await new Promise((r) => setTimeout(r, 700));
const OFF = await grab(clipX, clipY, clipW, clipH, 'p7-stripes-disp-off');
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.48, etaHi: 1.56 }));
await new Promise((r) => setTimeout(r, 700));

function lagRB(img, chR, chB) {
  const W = img.w, H = img.h, ch = img.ch;
  const lags = [];
  const fringe = [];
  for (let y = 1; y < H - 1; y++) {
    const R = [], B = [];
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * ch;
      R.push(img.data[i + chR]); B.push(img.data[i + chB]);
    }
    let best = 0, bestV = Infinity;
    for (let lag = -8; lag <= 8; lag++) {
      let s = 0, n = 0;
      for (let x = 8; x < W - 8; x++) { s += Math.abs(R[x] - B[x + lag]); n++; }
      const v = s / n;
      if (v < bestV) { bestV = v; best = lag; }
    }
    lags.push(best);
    // 同一行内最大 |R-B|（可见彩边强度）
    let mx = 0;
    for (let x = 0; x < W; x++) mx = Math.max(mx, Math.abs(R[x] - B[x]));
    fringe.push(mx);
  }
  const ls = lags.slice().sort((a, b) => a - b);
  const med = ls[Math.floor(ls.length / 2)];
  const mean = lags.reduce((s, l) => s + l, 0) / lags.length;
  const fr = fringe.slice().sort((a, b) => a - b);
  return {
    medianLagDevicePx: med, meanLagDevicePx: +mean.toFixed(2),
    medianLagCssPx: +(med / 2).toFixed(2),
    lagHistogram: ls.reduce((m, v) => ((m[v] = (m[v] || 0) + 1), m), {}),
    rowsAtNonZeroLag: ls.filter((v) => v !== 0).length, rows: ls.length,
    maxRBperRow: { med: fr[Math.floor(fr.length / 2)], p90: fr[Math.floor(fr.length * 0.9)], max: fr[fr.length - 1] },
  };
}
out.tests.dispLag = { on: lagRB(ON, 0, 2), off: lagRB(OFF, 0, 2), onGR: lagRB(ON, 1, 0), onGB: lagRB(ON, 1, 2) };

/* ───────── C. 按下内缩（在条纹背景上做，边缘阶跃最干净） ───────── */
console.log('A_DISPERSION ' + JSON.stringify(out.tests.dispLag));
const edgeProfile = (img, x0, y0, w, h) => {
  const cols = [];
  for (let cx = 0; cx < w; cx++) {
    let s = 0, n = 0;
    for (let y = 0; y < img.h; y++) {
      const i = (y * img.w + Math.min(img.w - 1, cx * 2 + 1)) * img.ch;
      s += 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
      n++;
    }
    cols.push(s / n);
  }
  return cols;
};
const prePress = await grab(clipX, clipY, clipW, clipH, 'p7-press-before');
out.press = await page.evaluate(() => (window.__gevGlPress ? window.__gevGlPress() : 'no-hook'));
await new Promise((r) => setTimeout(r, 90));
const inPress = await grab(clipX, clipY, clipW, clipH, 'p7-press-after');
await new Promise((r) => setTimeout(r, 400));
const a = edgeProfile(prePress), b = edgeProfile(inPress);
const argmaxJump = (p) => { let bi = 0, bv = -1; for (let i = 1; i < p.length; i++) { const d = Math.abs(p[i] - p[i - 1]); if (d > bv) { bv = d; bi = i; } } return { at: bi, v: +bv.toFixed(1) }; };
out.tests.press = { before: argmaxJump(a), during: argmaxJump(b), insetDevicePx: argmaxJump(b).at - argmaxJump(a).at, hook: out.press };
await page.evaluate(() => window.__gevGlTestBg(false));
await new Promise((r) => setTimeout(r, 700));

/* ───────── B. 真实亮背景：盐湖 ───────── */
const cam = await page.evaluate(() => {
  try {
    const v = window.__gevViewer;
    const el = v.scene.globe.ellipsoid;
    const carto = { longitude: (-67.5 * Math.PI) / 180, latitude: (-20.13 * Math.PI) / 180, height: 0 };
    const dest = el.cartographicToCartesian(carto);
    v.useDefaultRenderLoop = true;
    v.camera.setView({ destination: dest, orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
    return { ok: true, dest: [dest.x, dest.y, dest.z].map((n) => Math.round(n)) };
  } catch (e) { return { ok: false, err: String(e && e.message) }; }
});
out.camToSalt = cam;
await new Promise((r) => setTimeout(r, 16000));
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await new Promise((r) => setTimeout(r, 1500));

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
  return { bg: +bg.toFixed(3), fg: +fg.toFixed(3), ratio: +(((fg + 0.05) / (bg + 0.05))).toFixed(2), p10: +q(0.1).toFixed(3), p90: +q(0.9).toFixed(3) };
};
// 背景亮度核验：卡片之间的一小块“纯地图”区域
const mapPatch = await wcagOf({ x: 640, y: 640, width: 120, height: 60 }, 'p7-salt-mappatch');
const panelHeader = await wcagOf({ x: lc0.x + 6, y: lc0.y + 6, width: lc0.w - 12, height: Math.min(30, lc0.h - 12) }, 'p7-salt-header');
out.tests.bright = { mapPatch, panelHeader };
out.brightCardState = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const t = el.querySelector('.panel-title') || el.querySelector('h2,h3');
  const shell = el.closest('.gev-lc') || el;
  const cs = getComputedStyle(t), sh = getComputedStyle(shell);
  return {
    dataLum: el.getAttribute('data-gev-lum') || shell.getAttribute('data-gev-lum'),
    htmlLum: document.documentElement.dataset.gevGlassLum,
    titleColor: cs.color, shadow: cs.textShadow,
    shellBg: sh.backgroundColor,
    glassLumStat: (window.__gevGlStats().surfaces.find((s) => s.id === 'data-panel') || {}).lum,
  };
});
await page.screenshot({ path: path.join(OUT, 'p7-salt-full.png') });

/* ───────── D. morph / DOM 审计 ───────── */
const audit = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.gev-lc')];
  const ids = cards.map((c) => c.id || (c.querySelector('[id]') || {}).id || '?');
  // 单层玻璃：卡片内部不得再出现 backdrop-filter
  let innerBlur = 0, innerGlassCls = 0;
  cards.forEach((c) => {
    c.querySelectorAll('*').forEach((e) => {
      const cs = getComputedStyle(e);
      if ((cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none')) innerBlur++;
      if (/glass|gev-gl/.test(e.className || '')) innerGlassCls++;
    });
  });
  // 滚动条
  let scrolling = 0, scrollbarStyled = 0;
  document.querySelectorAll('*').forEach((e) => {
    const cs = getComputedStyle(e);
    if (e.scrollHeight > e.clientHeight + 2 && /auto|scroll/.test(cs.overflowY)) scrolling++;
  });
  // 黑字
  let blackText = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const black = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (!n.textContent.trim()) continue;
    const p = n.parentElement; if (!p) continue;
    const cs = getComputedStyle(p);
    const m = cs.color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) continue;
    const L = 0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3];
    if (L < 40 && p.offsetParent) { blackText++; if (black.length < 5) black.push((p.className || p.tagName) + ':' + cs.color); }
  }
  return { cards: cards.length, ids, innerBlur, innerGlassCls, scrollingBoxes: scrolling, blackText, blackSample: black };
});
out.tests.audit = audit;
out.surfacesBefore = await page.evaluate(() => window.__gevGlStats().count);
out.morph = await page.evaluate(async () => {
  const lc = window.__gevLc;
  const target = 'data-panel';
  const sibs = ['scene-panel', 'display-panel', 'monitor-panel'];
  lc.open(target);
  await new Promise((r) => setTimeout(r, 700));
  const st = window.__gevGlStats();
  const sibInfo = sibs.slice(0, 3).map((id) => {
    const e = document.getElementById(id === 'gear-fab' ? 'gear-fab' : id) || document.querySelector('#' + id);
    const el = e || document.getElementById(id + '-panel');
    const info = lc.info(id);
    const cs = el ? getComputedStyle(el) : null;
    return { id, info, display: cs && cs.display, visibility: cs && cs.visibility, opacity: cs && cs.opacity, h: info && info.h };
  });
  const cv = document.getElementById('gev-gl-glass');
  return { surfacesOpen: st.count, canvas: [cv.width, cv.height], sibInfo };
});
await page.screenshot({ path: path.join(OUT, 'p7-expanded.png') });
out.errors = out.errors.slice(0, 8);
fs.writeFileSync(path.join(OUT, 'review-probe7.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
