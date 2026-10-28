#!/usr/bin/env node
/**
 * _final-material-px3.mjs —— 像素级证据：卡中心透明 / 无磨砂（1536×730，真实页面）
 *
 * 判定模型（不需要人造底图，也不动 Cesium）：
 *   同一位置连拍三张：A（卡可见）→ A2（卡仍可见，隔 ~200ms）→ B（卡 visibility:hidden）。
 *     · baseline = |A - A2|  ← 底图（卫星/大气/时间）自身的噪声/动画
 *     · card     = |A - B|   ← 卡自己画了多少东西
 *   若卡壳是「完全透明」的，card 只应多出卡内文字/控件那一小部分，
 *   其余像素与 baseline 同量级 ⇒ 卡没有给背景加暗底、也没有 backdrop blur
 *   （有 blur 会把整块背景抹一遍，card 差分会远大于 baseline）。
 *
 * 产物：.gev-logs/final/<tag>/material.json + card-<id>.png（真实地图下的 1:1 裁切）
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith('--' + k + '='));
  return a ? a.split('=')[1] : d;
};
const TAG = arg('tag', 'px3');
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

/* Cesium 偶发 WebGL shader 编译失败会弹一个占满屏幕的错误面板（吞掉所有点击）。
   它不是被测对象：先点掉它再继续，保证点击打到卡上。 */
const dismissCesiumError = async () => {
  const ok = await page.evaluate(() => {
    const panel = document.querySelector('.cesium-widget-errorPanel');
    if (!panel) return false;
    const btn = [...panel.querySelectorAll('button')].find((b) => /ok|确定/i.test(b.textContent || '')) || panel.querySelector('button');
    if (btn) btn.click();
    else panel.remove();
    return true;
  });
  if (ok) {
    console.log('[dismiss] cesium error panel closed');
    await sleep(400);
  }
  return ok;
};

const diff = (a, b, rect) =>
  page.evaluate(
    async (A, B, R) => {
      const load = (b64) =>
        new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = () => rej(new Error('decode'));
          i.src = 'data:image/png;base64,' + b64;
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
          ds.push(Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2])));
        }
      ds.sort((p, q) => p - q);
      const q = (f) => ds[Math.min(ds.length - 1, Math.floor(ds.length * f))] || 0;
      return {
        px: ds.length,
        mean: +(ds.reduce((s, v) => s + v, 0) / (ds.length || 1)).toFixed(2),
        p50: q(0.5),
        p90: q(0.9),
        p99: q(0.99),
        max: ds[ds.length - 1],
        unchangedFrac: +(ds.filter((d) => d <= 2).length / (ds.length || 1)).toFixed(3),
      };
    },
    a,
    b,
    rect
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

const testCard = async (id, note) => {
  const rect = await rectOf(id);
  if (!rect) return { id, note, skipped: 'zero rect' };
  const box = await rectOf(id, 3);
  const A = await page.screenshot({ encoding: 'base64' });
  await sleep(200);
  const A2 = await page.screenshot({ encoding: 'base64' });
  await page.evaluate((i) => document.getElementById(i).style.setProperty('visibility', 'hidden', 'important'), id);
  await sleep(200);
  const B = await page.screenshot({ encoding: 'base64' });
  await page.evaluate((i) => document.getElementById(i).style.removeProperty('visibility'), id);
  await sleep(160);
  const baseline = await diff(A, A2, rect);
  const card = await diff(A, B, rect);
  // 四角 8×8 小块（圆形 FAB 的四角在圆外 = 纯背景，最能证明"没有实心底"）
  const corners = {};
  if (box) {
    const [bx, by, bw, bh] = box;
    const cs = {
      tl: [bx, by, 8, 8],
      tr: [bx + bw - 8, by, 8, 8],
      bl: [bx, by + bh - 8, 8, 8],
      br: [bx + bw - 8, by + bh - 8, 8, 8],
    };
    for (const [k, r] of Object.entries(cs)) corners[k] = (await diff(A, B, r)).mean;
  }
  return { id, note, rect, baseline, card, cornerMeanDiff: corners };
};

const report = { tag: TAG, viewport: [W, H], method: 'A/A2 baseline vs A/B card diff over card interior (inset 12px)', mini: [], expanded: [], consoleErrors: [] };

/* ① mini */
await settle(400);
for (const id of IDS) {
  const r = await testCard(id, 'mini');
  report.mini.push(r);
  if (!r.skipped) console.log('mini', id, JSON.stringify({ base: r.baseline.mean, card: r.card.mean, keep: r.card.unchangedFrac, p99: r.card.p99 }));
}

/* ② 展开态：真实点击 → 测量 → 裁切 */
for (const [id, hsel] of HEADERS) {
  await page.evaluate(() => ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'].forEach((i) => window.__gevLc.close(i)));
  await settle(600);
  const pt = await page.evaluate((s) => {
    const h = document.querySelector(s);
    if (!h) return null;
    const b = h.getBoundingClientRect();
    return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)];
  }, hsel);
  if (!pt) continue;
  await dismissCesiumError();
  await page.mouse.move(pt[0], pt[1]);
  await page.mouse.down();
  await sleep(45);
  await page.mouse.up();
  await settle(1100);
  let st = await page.evaluate((i) => {
    const el = document.getElementById(i);
    return { floating: el.classList.contains('gev-lc-floating'), collapsed: el.classList.contains('collapsed') };
  }, id);
  if (!st.floating && (await dismissCesiumError())) {
    // 错误面板刚被点掉 → 再点一次
    await page.mouse.move(pt[0], pt[1]);
    await page.mouse.down();
    await sleep(45);
    await page.mouse.up();
    await settle(1100);
    st = await page.evaluate((i) => {
      const el = document.getElementById(i);
      return { floating: el.classList.contains('gev-lc-floating'), collapsed: el.classList.contains('collapsed') };
    }, id);
  }
  if (!st.floating) {
    console.log('FAILED TO OPEN', id, JSON.stringify(st));
    report.expanded.push({ id, failedToOpen: st });
    continue;
  }
  const r = await testCard(id, 'expanded');
  report.expanded.push({ ...r, opened: st });
  console.log('expanded', id, JSON.stringify({ base: r.baseline.mean, card: r.card.mean, keep: r.card.unchangedFrac, p99: r.card.p99 }));
  const b = r.rect;
  await page.screenshot({ path: path.join(OUT, 'card-' + id + '.png'), clip: { x: Math.max(0, b[0] - 12), y: Math.max(0, b[1] - 12), width: Math.min(W - Math.max(0, b[0] - 12), b[2] + 24), height: Math.min(H - Math.max(0, b[1] - 12), b[3] + 24) } });
  await page.screenshot({ path: path.join(OUT, 'edge-' + id + '.png'), clip: { x: Math.max(0, b[0] - 14), y: Math.max(0, b[1] - 14), width: Math.min(160, b[2] + 28), height: Math.min(160, b[3] + 28) } });
}

report.consoleErrors = errs.slice(0, 8);
fs.writeFileSync(path.join(OUT, 'material.json'), JSON.stringify(report, null, 1));
console.log('OUT', OUT);
await browser.close();
