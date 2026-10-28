#!/usr/bin/env node
/**
 * phase2-capture-bg.mjs —— Phase 2 视觉候选的「同背景 + 同布局」取样
 *
 * 做什么：
 *  1) 打开正式页面 http://127.0.0.1:4173（1536×730, dsf=1），等加载幕消失；
 *  2) 读 9 张卡 / dock 托盘 / 芯片的真实 rect + visibility（写成 layout.json，候选页照此摆版）；
 *  3) 注入一次性隐藏样式（不改任何源码），截一张「纯地图」1536×730 → map-bg.png；
 *     再解除隐藏，截一张「带卡」对照页 app-ref.png（证明候选用的是同一背景/同一尺寸）。
 *
 * 用法: node scripts/phase2-capture-bg.mjs [--headful]
 * 产物: .gev-logs/phase2/{map-bg.png,app-ref.png,layout.json,probe.json}
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('.gev-logs/phase2');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: !process.argv.includes('--headful'),
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox',
    '--enable-gpu',
    '--use-angle=d3d11',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--window-size=1560,860',
    '--window-position=1900,40',
    '--hide-scrollbars',
  ],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
  } catch (e) {}
});
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await page.waitForFunction(
  () => {
    const ls = document.getElementById('loading-screen');
    const op = ls ? parseFloat(getComputedStyle(ls).opacity) : 0;
    return !ls || op < 0.05;
  },
  { timeout: 60000, polling: 200 },
);
await sleep(2500);

// ---- 1) 真实布局 ----
const layout = await page.evaluate(() => {
  const ids = [
    'data-panel',
    'scene-panel',
    'pp-toggles',
    'cctv-panel',
    'global-context-panel',
    'location-bar',
    'control-panel',
    'gev-voice-control',
    'gev-gfx-fab',
  ];
  const rows = [];
  for (const id of ids) {
    const e = document.getElementById(id);
    if (!e) {
      rows.push({ id, missing: true });
      continue;
    }
    const r = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    rows.push({
      id,
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      cls: String(e.className || ''),
      disp: s.display,
      vis: s.visibility,
      op: s.opacity,
      bg: s.backgroundColor,
      radius: s.borderRadius,
      title: (e.querySelector('[data-title],.panel-title,.gev-lc-title,h3,h2,.dock-title') || {}).textContent || null,
    });
  }
  const extra = [];
  for (const sel of ['#command-dock', '.dock-popover-content', '#gev-clear-chip', '.gev-chip-row', '#gev-gfx-fab']) {
    const e = document.querySelector(sel);
    if (!e) continue;
    const r = e.getBoundingClientRect();
    extra.push({ sel, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
  }
  return { cards: rows, extra, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio };
});

await page.screenshot({ path: path.join(OUT, 'app-ref.png') });
const refBuf = fs.readFileSync(path.join(OUT, 'app-ref.png'));

// ---- 2) 纯地图背景（一次性隐藏所有玻璃层，不落盘任何源码改动）----
const hidden = await page.evaluate(() => {
  // 纯地图：只保留包含地图 canvas 的那一支 DOM，其余 body 直接子节点全部隐藏。
  const canvas = document.querySelector('canvas');
  let mapRoot = canvas;
  while (mapRoot && mapRoot.parentElement && mapRoot.parentElement !== document.body) mapRoot = mapRoot.parentElement;
  const keep = new Set([mapRoot, canvas].filter(Boolean));
  const killed = [];
  for (const el of Array.from(document.body.children)) {
    if (keep.has(el) || (el.contains && el.contains(canvas))) continue;
    el.style.setProperty('display', 'none', 'important');
    killed.push(el.id || el.className || el.tagName);
  }
  // 浮层卡内被 App 强制 visibility:visible 的元素：一律 display:none 收口
  const extra = document.createElement('style');
  extra.textContent =
    '.data-toggle-row,.panel-title,#gev-voice-button,input,label,button{visibility:hidden !important;}';
  document.head.appendChild(extra);
  // 地图容器自身的 HUD（Cesium 内的按钮/版权）也藏掉
  const st = document.createElement('style');
  st.id = '__phase2_hide';
  st.textContent =
    '.cesium-widget-credits,.cesium-viewer-bottom,.cesium-viewer-toolbar,.cesium-viewer-animationContainer,.cesium-viewer-timelineContainer{visibility:hidden !important;}';
  document.head.appendChild(st);
  // 找出仍然遮挡画面中心的「不透明大块」，避免背景里残留 HUD
  const cx = innerWidth / 2,
    cy = innerHeight / 2;
  const probe = [];
  for (let y = 80; y < innerHeight - 40; y += 120) {
    for (let x = 80; x < innerWidth - 40; x += 220) {
      const el = document.elementFromPoint(x, y);
      if (!el) continue;
      probe.push({ x, y, el: el.tagName + (el.id ? '#' + el.id : '') + '.' + String(el.className || '').slice(0, 40) });
    }
  }
  const counts = {};
  for (const p of probe) counts[p.el] = (counts[p.el] || 0) + 1;
  return { counts, removed: true, cx, cy, killed };
});
await sleep(600);
await page.screenshot({ path: path.join(OUT, 'map-bg.png') });

// ---- 3) 尺寸校验 ----
const sharp = (await import('sharp')).default;
const bgMeta = await sharp(path.join(OUT, 'map-bg.png')).metadata();
const refMeta = await sharp(refBuf).metadata();
const probe = {
  capturedAt: new Date().toISOString(),
  viewport: layout.viewport,
  mapBg: { w: bgMeta.width, h: bgMeta.height, bytes: fs.statSync(path.join(OUT, 'map-bg.png')).size },
  appRef: { w: refMeta.width, h: refMeta.height, bytes: refBuf.length },
  sameSize: bgMeta.width === refMeta.width && bgMeta.height === refMeta.height,
  elementFromPointAfterHide: hidden.counts,
  errors: errs,
};
fs.writeFileSync(path.join(OUT, 'layout.json'), JSON.stringify(layout, null, 1));
fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify(probe, null, 1));
console.log(JSON.stringify(probe, null, 1));
console.log(JSON.stringify(layout, null, 1));
await browser.close();
