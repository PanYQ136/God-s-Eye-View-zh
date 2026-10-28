#!/usr/bin/env node
/**
 * _final-material-px2.mjs —— 像素级证据：卡中心透明、无磨砂、无暗底（1536×730）
 *
 * 底图确定性化：把 Cesium canvas 藏起来，body 铺 24px 黑白棋盘（纯黑/纯白两块）。
 * 单张截图即可判定：
 *   · 卡是「透明」的 ⇒ 卡内棋盘仍是纯黑/纯白，purityFrac 与卡外参考区几乎一致
 *   · 卡有暗底/tint ⇒ 纯黑被抬成灰、纯白被压暗 ⇒ purityFrac 明显下降、meanLum 偏移
 *   · 卡有 backdrop blur ⇒ 8→24px 的方格边缘被糊开 ⇒ 中灰像素大量出现（midFrac 上升）
 * 同时对每张卡输出 1:1 裁切（card-*.png / edge-*.png）供人眼复核边缘折射与伪影。
 *
 * 产物：.gev-logs/final/<tag>/material.json + 各 png
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith('--' + k + '='));
  return a ? a.split('=')[1] : d;
};
const TAG = arg('tag', 'p1');
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
const errs = [];
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 160));
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

const checkerOn = () =>
  page.evaluate(() => {
    if (document.getElementById('__qa_checker')) return;
    const st = document.createElement('style');
    st.id = '__qa_checker';
    st.textContent = `
      canvas { visibility: hidden !important; }
      body { background:
        repeating-conic-gradient(#000 0 25%, #fff 0 50%) 0 0 / 24px 24px,
        #808080 !important; }
    `;
    document.head.appendChild(st);
  });
const checkerOff = () => page.evaluate(() => document.getElementById('__qa_checker')?.remove());

// 单张截图 → 指定矩形的亮度统计（在页面里用 canvas 读像素）
const regionStats = (b64, rects) =>
  page.evaluate(
    async (B, RS) => {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('decode'));
        i.src = 'data:image/png;base64,' + B;
      });
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height).data;
      const out = {};
      for (const [name, r] of Object.entries(RS)) {
        const [x0, y0, w, h] = r;
        let dark = 0,
          light = 0,
          mid = 0,
          sum = 0,
          n = 0;
        for (let y = Math.max(0, y0); y < Math.min(c.height, y0 + h); y++)
          for (let x = Math.max(0, x0); x < Math.min(c.width, x0 + w); x++) {
            const i = (y * c.width + x) * 4;
            const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
            sum += lum;
            n++;
            if (lum <= 18) dark++;
            else if (lum >= 237) light++;
            else mid++;
          }
        out[name] = {
          px: n,
          meanLum: +(sum / (n || 1)).toFixed(1),
          darkFrac: +(dark / (n || 1)).toFixed(3),
          lightFrac: +(light / (n || 1)).toFixed(3),
          midFrac: +(mid / (n || 1)).toFixed(3),
        };
      }
      return out;
    },
    b64,
    rects
  );

const rectOf = (id, inset = 12) =>
  page.evaluate(
    (i, ins) => {
      const el = document.getElementById(i);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      if (b.width < 6 || b.height < 6) return null;
      return [Math.round(b.left + ins), Math.round(b.top + ins), Math.max(4, Math.round(b.width - 2 * ins)), Math.max(4, Math.round(b.height - 2 * ins))];
    },
    id,
    inset
  );

const report = { tag: TAG, viewport: [W, H], backdrop: '24px pure black/white checkerboard, Cesium canvas hidden', reference: null, mini: [], expanded: [], consoleErrors: [] };

// ── 参考区：屏幕正中偏下、没有任何卡的一块（860..1100 × 300..440）
const REF = [620, 250, 320, 160];

/* ① mini 全卡 */
await settle(400);
await checkerOn();
await sleep(500);
let shot = await page.screenshot({ encoding: 'base64' });
const miniRects = {};
for (const id of IDS) {
  const r = await rectOf(id);
  if (r) miniRects[id] = r;
}
miniRects.__ref = REF;
const miniStats = await regionStats(shot, miniRects);
report.reference = { mini: miniStats.__ref };
for (const id of Object.keys(miniRects)) {
  if (id === '__ref') continue;
  report.mini.push({ id, rect: miniRects[id], ...miniStats[id] });
  console.log('mini', id, JSON.stringify({ mean: miniStats[id].meanLum, purity: +(miniStats[id].darkFrac + miniStats[id].lightFrac).toFixed(3), mid: miniStats[id].midFrac }));
}
console.log('mini REF    ', JSON.stringify({ mean: miniStats.__ref.meanLum, purity: +(miniStats.__ref.darkFrac + miniStats.__ref.lightFrac).toFixed(3), mid: miniStats.__ref.midFrac }));
await page.screenshot({ path: path.join(OUT, 'checker-mini.png') });
await checkerOff();
await sleep(300);

/* ② 每张展开态：先用真实鼠标点开（页面正常状态），再铺棋盘量 */
for (const [id, hsel] of HEADERS) {
  await page.evaluate(() => ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'].forEach((i) => window.__gevLc.close(i)));
  await settle(600);
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
    return { floating: el.classList.contains('gev-lc-floating'), collapsed: el.classList.contains('collapsed') };
  }, id);
  if (!st.floating) {
    console.log('FAILED TO OPEN', id, JSON.stringify(st));
    report.expanded.push({ id, failedToOpen: st });
    continue;
  }
  await checkerOn();
  await sleep(450);
  shot = await page.screenshot({ encoding: 'base64' });
  const r = await rectOf(id);
  const stats = await regionStats(shot, { card: r, __ref: REF });
  report.expanded.push({ id, rect: r, ...stats.card, ref: stats.__ref, opened: st });
  console.log('expanded', id, JSON.stringify({ mean: stats.card.meanLum, purity: +(stats.card.darkFrac + stats.card.lightFrac).toFixed(3), mid: stats.card.midFrac, refPurity: +(stats.__ref.darkFrac + stats.__ref.lightFrac).toFixed(3) }));
  await page.screenshot({ path: path.join(OUT, 'card-' + id + '.png'), clip: { x: Math.max(0, r[0] - 12), y: Math.max(0, r[1] - 12), width: r[2] + 24, height: r[3] + 24 } });
  await page.screenshot({ path: path.join(OUT, 'edge-' + id + '.png'), clip: { x: Math.max(0, r[0] - 14), y: Math.max(0, r[1] - 14), width: Math.min(150, r[2] + 28), height: Math.min(150, r[3] + 28) } });
  await checkerOff();
  await settle(300);
}

report.consoleErrors = errs.slice(0, 8);
fs.writeFileSync(path.join(OUT, 'material.json'), JSON.stringify(report, null, 1));
console.log('OUT', OUT);
await browser.close();
