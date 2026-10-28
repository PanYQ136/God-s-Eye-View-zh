#!/usr/bin/env node
/* S0 基线取证：真实浏览器读 7 卡 mini 槽位 / header / dock / 轨道 / 保护区。
   只读，不改任何代码。输出 .gev-logs/lc/baseline.json */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const W = 1536,
  H = 730;
const OUT = path.resolve('.gev-logs/lc');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = [
  'data-panel',
  'scene-panel',
  'pp-toggles',
  'cctv-panel',
  'global-context-panel',
  'location-bar',
  'control-panel',
  'gev-voice-control',
];

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox',
    `--window-size=${W + 24},${H + 160}`,
    '--hide-scrollbars',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
  ],
  protocolTimeout: 600000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.clear();
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
    localStorage.setItem(
      'gev.gfx',
      JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'high-performance' }),
    );
  } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) {
  const gone = await page
    .evaluate(() => {
      const l = document.querySelector('#loading-screen');
      return !l || parseFloat(getComputedStyle(l).opacity || '1') < 0.05;
    })
    .catch(() => false);
  if (gone) break;
  await sleep(400);
}
await sleep(6000);

const snap = await page.evaluate((IDS) => {
  const r = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom), right: Math.round(b.right) };
  };
  const cards = {};
  for (const id of IDS) {
    const e = document.getElementById(id);
    cards[id] = {
      found: !!e,
      rect: r(e),
      parent: e ? e.parentElement && (e.parentElement.id || e.parentElement.className || e.parentElement.tagName) : null,
      collapsed: e ? e.classList.contains('collapsed') : null,
      display: e ? getComputedStyle(e).display : null,
      order: e ? getComputedStyle(e).order : null,
      transform: e ? getComputedStyle(e).transform : null,
      header: e ? r(e.querySelector('.panel-header,.pp-header-row,.dock-tray-toggle,.location-bar-toggle,.gev-voice-heading')) : null,
      scrollH: e ? e.scrollHeight : null,
      clientH: e ? e.clientHeight : null,
      visible: e ? !!(e.offsetWidth || e.offsetHeight) : false,
    };
  }
  const rails = {};
  for (const sel of ['#left-rail', '#right-rail', '#right-context-rail', '.left-panel-rail', '.right-panel-rail', '#command-dock'])
    rails[sel] = r(document.querySelector(sel));
  const protect = {};
  for (const id of ['gev-gfx-fab', 'style-indicator', 'top-center-actions', 'gev-perf-wrap', 'gev-voice-recess'])
    protect[id] = r(document.getElementById(id));
  return {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    cards,
    rails,
    protect,
    overlays: {
      stage: !!document.getElementById('lc-stage'),
      edgeLens: !!document.getElementById('gev-edge-lens'),
      warps: document.querySelectorAll('.gev-lg-warp').length,
      placeholders: document.querySelectorAll('.gev-lc-placeholder').length,
      ghost: document.querySelectorAll('.gev-lc-ghost').length,
      liquidClass: document.querySelectorAll('.gev-lc').length,
    },
    gpu: window.__gevGpu ? window.__gevGpu.probe() : null,
  };
}, IDS);

fs.writeFileSync(path.join(OUT, 'baseline.json'), JSON.stringify(snap, null, 1));
// mini 卡横向/纵向槽位关系（供布局引擎核对）
const ids = IDS;
const lines = ids.map((id) => {
  const c = snap.cards[id];
  return `${id.padEnd(22)} ${JSON.stringify(c.rect)} hdr=${JSON.stringify(c.header)} parent=${c.parent} collapsed=${c.collapsed} order=${c.order}`;
});
console.log(lines.join('\n'));
console.log('rails:', JSON.stringify(snap.rails, null, 0));
console.log('protect:', JSON.stringify(snap.protect, null, 0));
console.log('overlays:', JSON.stringify(snap.overlays));
console.log('gpu:', JSON.stringify(snap.gpu && { renderer: snap.gpu.renderer, tier: snap.gpu.tier, granted: snap.gpu.granted }));
await browser.close();
