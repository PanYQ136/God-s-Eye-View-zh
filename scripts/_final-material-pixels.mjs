#!/usr/bin/env node
/**
 * _final-material-pixels.mjs —— 像素级证据：卡中心到底透不透明（1536×730）
 *
 * 做法（不靠 computed style 自证）：同一位置拍两张全屏图 —— 卡可见 / 卡 visibility:hidden，
 * 再在「卡自己是命中元素」的空白采样点（即该处只有卡壳背景，没有按钮/文字）上比像素。
 * 若中心还有暗底或磨砂，这些点的 R/G/B 会整体偏移或丢失底图细节。
 *
 * 产物：.gev-logs/final/<tag>/material.json + 若干 edge-*.png（卡角 1:1 放大裁切）
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith('--' + k + '='));
  return a ? a.split('=')[1] : d;
};
const TAG = arg('tag', 'm1');
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
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console-error]', m.text().slice(0, 160));
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.querySelectorAll('.gev-lc').length >= 9, { timeout: 120000 });
await sleep(9000);

const settle = async (ms = 900) => {
  await sleep(ms);
  try {
    await page.waitForFunction(() => [...document.querySelectorAll('.gev-lc')].every((e) => e.getAnimations().every((a) => a.playState !== 'running')), { timeout: 2500 });
  } catch (e) {}
  await sleep(150);
};

// 在页面里解码两张 PNG 并给出采样点处的像素差
const pixelDiff = (b64a, b64b, points) =>
  page.evaluate(
    async (A, B, pts) => {
      const load = (b64) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
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
      const outp = pts.map(([x, y]) => {
        const i = (y * c.width + x) * 4;
        const a = [da[i], da[i + 1], da[i + 2]];
        const b = [db[i], db[i + 1], db[i + 2]];
        return { x, y, visible: a, hidden: b, d: Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])) };
      });
      const ds = outp.map((o) => o.d);
      const mean = ds.reduce((s, v) => s + v, 0) / (ds.length || 1);
      return { n: ds.length, max: Math.max(...ds), mean: +mean.toFixed(2), over8: ds.filter((d) => d > 8).length, pts: outp };
    },
    b64a,
    b64b,
    points
  );

async function measureCard(id) {
  const info = await page.evaluate((i) => {
    const el = document.getElementById(i);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const pts = [];
    // 在卡内取「命中元素就是卡壳本身」的点（只有卡壳背景，没有按钮/文字）
    for (let gy = 0.12; gy <= 0.92 && pts.length < 18; gy += 0.1) {
      for (let gx = 0.06; gx <= 0.96 && pts.length < 18; gx += 0.08) {
        const x = Math.round(b.left + b.width * gx);
        const y = Math.round(b.top + b.height * gy);
        if (x < 2 || y < 2 || x > innerWidth - 3 || y > innerHeight - 3) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit === el) pts.push([x, y]);
      }
    }
    return { rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], pts };
  }, id);
  if (!info || !info.pts.length) return { id, skipped: 'no empty sample points', info };
  const a = await page.screenshot({ encoding: 'base64' });
  await page.evaluate((i) => document.getElementById(i).style.setProperty('visibility', 'hidden', 'important'), id);
  await sleep(160);
  const b = await page.screenshot({ encoding: 'base64' });
  await page.evaluate((i) => document.getElementById(i).style.removeProperty('visibility'), id);
  await sleep(120);
  const d = await pixelDiff(a, b, info.pts);
  return { id, rect: info.rect, samples: d.n, meanDiff: d.mean, maxDiff: d.max, over8: d.over8, worst: d.pts.sort((x, y) => y.d - x.d).slice(0, 3) };
}

const report = { tag: TAG, viewport: [W, H], mini: [], expanded: [], edges: [] };

// ① mini 全卡
await settle(600);
for (const id of IDS) {
  const r = await measureCard(id);
  report.mini.push(r);
  console.log('mini', id, JSON.stringify({ mean: r.meanDiff, max: r.maxDiff, over8: r.over8, n: r.samples }));
}

// ② 每张展开态（同组互斥：开之前全关）
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
  await page.mouse.click(pt[0], pt[1]);
  await settle(1100);
  const st = await page.evaluate((i) => {
    const el = document.getElementById(i);
    return { floating: el.classList.contains('gev-lc-floating'), collapsed: el.classList.contains('collapsed') };
  }, id);
  if (!st.floating) {
    console.log('FAILED TO OPEN', id);
    continue;
  }
  const r = await measureCard(id);
  report.expanded.push({ ...r, opened: st });
  console.log('expanded', id, JSON.stringify({ mean: r.meanDiff, max: r.maxDiff, over8: r.over8, n: r.samples }));
  // 卡角 1:1 裁切（看边缘折射/伪影）
  const b = r.rect;
  const corner = { x: Math.max(0, b[0] - 6), y: Math.max(0, b[1] - 6), width: 90, height: 90 };
  const p = path.join(OUT, 'edge-' + id + '.png');
  await page.screenshot({ path: p, clip: corner });
  report.edges.push(p);
}

fs.writeFileSync(path.join(OUT, 'material.json'), JSON.stringify(report, null, 1));
console.log('OUT', OUT);
await browser.close();
