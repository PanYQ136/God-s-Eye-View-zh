#!/usr/bin/env node
/**
 * _final-material-px.mjs —— 像素级证据：卡中心到底透不透明（1536×730）
 *
 * 为什么不用 computed style 自证：需求是"看得到的每一处中心都没有暗底/磨砂"。
 * 做法：把 Cesium 画布藏起来，body 铺一张 8px 黑白棋盘（确定性底图，零动画噪声），
 *       同一位置拍两张全屏图 —— 卡可见 / 卡 visibility:hidden，逐像素比：
 *         · meanDiff 小、unchangedFrac 高  ⇒ 卡只有控件/文字在画，卡壳没有底、没有磨砂
 *         · 若中心有暗底或 backdrop blur，棋盘每个像素都会被改（meanDiff 大 / 高频细节丢失）
 * 另附每张卡的 1:1 边缘裁切图，供人眼核对边缘折射/伪影。
 *
 * 产物：.gev-logs/final/<tag>/material.json + edge-<id>.png + card-<id>.png
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith('--' + k + '='));
  return a ? a.split('=')[1] : d;
};
const TAG = arg('tag', 'm2');
const W = +arg('w', 1536);
const H = +arg('h', 730);
const OUT = path.resolve('.gev-logs/final', TAG);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab'];
const HEADERS = [
  ['data-panel', '#data-panel .panel-header'],
  ['scene-panel', '#scene-panel .panel-header'],
  ['pp-toggles', '#pp-toggles .pp-header-row'],
  ['cctv-panel', '#cctv-panel .panel-header'],
  ['global-context-panel', '#global-context-panel .panel-header'],
  ['location-bar', '#location-bar .dock-tray-toggle, #location-bar-toggle'],
  ['control-panel', '#control-panel .dock-tray-toggle, #control-panel-toggle'],
];

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', `--window-size=${W + 24},${H + 130}`, '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  localStorage.removeItem('gev-liquid-cards:v2');
  localStorage.removeItem('gev-liquid-cards:v2:last');
  localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.querySelectorAll('.gev-lc').length >= 9, { timeout: 120000 });
await sleep(9000);

const diag = await page.evaluate(() => ({
  cards: document.querySelectorAll('.gev-lc').length,
  api: !!window.__gevLc,
  canvases: document.querySelectorAll('canvas').length,
}));
console.log('diag', JSON.stringify(diag));

// —— 确定性底图：藏画布 + 棋盘 ——
await page.evaluate(() => {
  const st = document.createElement('style');
  st.id = '__qa_checker';
  st.textContent = `
    canvas { visibility: hidden !important; }
    body { background: repeating-conic-gradient(#000 0 25%, #fff 0 50%) 0 0 / 8px 8px !important; }
    #hud-loading, .welcome-overlay, #welcome-overlay { display: none !important; }
  `;
  document.head.appendChild(st);
});
await sleep(500);

const settle = async (ms = 900) => {
  await sleep(ms);
  try {
    await page.waitForFunction(() => [...document.querySelectorAll('.gev-lc')].every((e) => e.getAnimations().every((a) => a.playState !== 'running')), { timeout: 2500 });
  } catch (e) {}
  await sleep(150);
};

const diffStats = (b64a, b64b, rect) =>
  page.evaluate(
    async (A, B, R) => {
      const load = (b64) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = () => rej(new Error('decode'));
          img.src = 'data:image/png;base64,' + b64;
        });
      const [ia, ib] = await Promise.all([load(A), load(B)]);
      const c = document.createElement('canvas');
      c.width = ia.width;
      c.height = ia.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(ia, 0, 0);
      const da = g.getImageData(0, 0, c.width, c.height).data;
      g.clearRect(0, 0, c.width, c.height);
      g.drawImage(ib, 0, 0);
      const db = g.getImageData(0, 0, c.width, c.height).data;
      const [x0, y0, w, h] = R;
      const ds = [];
      for (let y = y0; y < y0 + h; y++)
        for (let x = x0; x < x0 + w; x++) {
          const i = (y * c.width + x) * 4;
          const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
          ds.push(d);
        }
      ds.sort((p, q) => p - q);
      const q = (f) => ds[Math.min(ds.length - 1, Math.floor(ds.length * f))] || 0;
      const mean = ds.reduce((s, v) => s + v, 0) / (ds.length || 1);
      let s2 = 0,
        n2 = 0;
      for (let y = y0; y < y0 + h; y++)
        for (let x = x0; x < x0 + w - 1; x++) {
          const i = (y * c.width + x) * 4;
          s2 += Math.abs(da[i] - da[i + 4]);
          n2++;
        }
      return {
        n: ds.length,
        meanDiff: +mean.toFixed(2),
        p50: q(0.5),
        p90: q(0.9),
        p99: q(0.99),
        maxDiff: ds[ds.length - 1],
        unchangedFrac: +(ds.filter((d) => d <= 2).length / (ds.length || 1)).toFixed(3),
        checkerEdgeContrast: n2 ? +(s2 / n2).toFixed(1) : 0,
      };
    },
    b64a,
    b64b,
    rect
  );

async function measureCard(id, note) {
  const rect = await page.evaluate(
    (i) => {
      const el = document.getElementById(i);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
    },
    id
  );
  if (!rect || rect[2] < 6 || rect[3] < 6) return { id, note, skipped: 'zero rect' };
  const inset = 12;
  const clipRect = [rect[0] + inset, rect[1] + inset, Math.max(4, rect[2] - 2 * inset), Math.max(4, rect[3] - 2 * inset)];
  const a = await page.screenshot({ encoding: 'base64' });
  await page.evaluate((i) => document.getElementById(i).style.setProperty('visibility', 'hidden', 'important'), id);
  await sleep(180);
  const b = await page.screenshot({ encoding: 'base64' });
  await page.evaluate((i) => document.getElementById(i).style.removeProperty('visibility'), id);
  await sleep(140);
  const s = await diffStats(a, b, clipRect);
  return { id, note, rect, sampleRect: clipRect, ...s };
}

const report = { tag: TAG, viewport: [W, H], backdrop: '8px checkerboard, Cesium canvas hidden', mini: [], expanded: [] };

// ① mini 全卡
await settle(600);
await page.screenshot({ path: path.join(OUT, 'checker-initial.png') });
for (const id of IDS) {
  const r = await measureCard(id, 'mini');
  report.mini.push(r);
  console.log('mini', id, JSON.stringify({ mean: r.meanDiff, p99: r.p99, keep: r.unchangedFrac, contrast: r.checkerEdgeContrast }));
}

// ② 每张展开态
for (const [id, hsel] of HEADERS) {
  await page.evaluate(() => ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'].forEach((i) => window.__gevLc.close(i)));
  await settle(500);
  const pt = await page.evaluate((s) => {
    const h = document.querySelector(s);
    if (!h) return null;
    const b = h.getBoundingClientRect();
    return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)];
  }, hsel);
  if (!pt) {
    console.log('no header', id);
    continue;
  }
  await page.mouse.move(pt[0], pt[1]);
  await page.mouse.down();
  await sleep(45);
  await page.mouse.up();
  await settle(1100);
  const st = await page.evaluate((i) => {
    const el = document.getElementById(i);
    if (!el) return null;
    return { floating: el.classList.contains('gev-lc-floating'), collapsed: el.classList.contains('collapsed') };
  }, id);
  if (!st || !st.floating) {
    console.log('FAILED TO OPEN', id, JSON.stringify(st));
    report.expanded.push({ id, failedToOpen: st });
    continue;
  }
  const r = await measureCard(id, 'expanded');
  report.expanded.push({ ...r, opened: st });
  console.log('expanded', id, JSON.stringify({ mean: r.meanDiff, p99: r.p99, keep: r.unchangedFrac, contrast: r.checkerEdgeContrast }));
  const b = r.rect;
  await page.screenshot({ path: path.join(OUT, 'edge-' + id + '.png'), clip: { x: Math.max(0, b[0] - 4), y: Math.max(0, b[1] - 4), width: Math.min(120, b[2] + 8), height: Math.min(120, b[3] + 8) } });
  await page.screenshot({ path: path.join(OUT, 'card-' + id + '.png'), clip: { x: Math.max(0, b[0]), y: Math.max(0, b[1]), width: b[2], height: b[3] } });
}

fs.writeFileSync(path.join(OUT, 'material.json'), JSON.stringify(report, null, 1));
console.log('OUT', OUT);
await browser.close();
