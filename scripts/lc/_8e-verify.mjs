#!/usr/bin/env node
/* Phase8E 验收（#14/#16/#18/#21）：真实 Chrome + RTX3060 + 生产构建 dist-8e。
   量：renderer / pageerror / 启动就绪 / 首屏与图层 chunk 的时序 / FPS 8s /
       真实点击开合卡 / 一层玻璃（卡内 backdrop-filter 计数）/ edge-lens cfg 未降级
   出：1x 全图 + 目标裁剪（--dsf 4 时同一裁剪是 4x 像素）
   用法：node scripts/lc/_8e-verify.mjs <url> <outPrefix> <dsf> */
import puppeteer from 'puppeteer';

const URL = process.argv[2] || 'http://127.0.0.1:4175/';
const OUT = process.argv[3] || '.gev-logs/lc/phase8e/8e';
const DSF = Number(process.argv[4] || 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion',
  ],
  protocolTimeout: 900000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: DSF },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__gevBoot && window.__gevBoot.state === 'interactive'), { timeout: 90000 }).catch(() => {});
const bootInteractiveMs = Date.now() - t0;
await page.waitForFunction(() => !!(window.__lc && window.__lc.api && window.__lc.api.mounted), { timeout: 90000 }).catch(() => {});
const lcMountedMs = Date.now() - t0;
// 等遮罩消失（视觉可交互），最多 60s
await page.waitForFunction(() => {
  const el = document.querySelector('#loading-screen');
  return !el || el.classList.contains('hidden') || getComputedStyle(el).display === 'none' || Number(getComputedStyle(el).opacity) < 0.05;
}, { timeout: 60000 }).catch(() => {});
const maskGoneMs = Date.now() - t0;
await sleep(9000); // 稳态 + photoreal 收敛

const facts = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a';
  const res = performance.getEntriesByType('resource')
    .filter((e) => /\/assets\/.+\.js$/.test(e.name))
    .map((e) => ({ name: e.name.split('/').pop(), start: Math.round(e.startTime), dur: Math.round(e.duration), bytes: e.transferSize }))
    .sort((a, b) => a.start - b.start);
  const paints = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
  const nav = performance.getEntriesByType('navigation')[0];
  const layerChunks = res.filter((r) => /catalogFactories/.test(r.name));
  const cards = [...document.querySelectorAll('.gev-lc')];
  const innerBackdrop = cards.reduce((n, card) => n + [...card.querySelectorAll('*')].filter((el) => {
    const cs = getComputedStyle(el);
    return (cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none');
  }).length, 0);
  const edge = globalThis.__gevEdge && globalThis.__gevEdge.stats ? globalThis.__gevEdge.stats() : null;
  const toggles = [...document.querySelectorAll('#data-toggles [data-layer-id], #data-toggles .pp-toggle-btn')].length;
  return {
    renderer,
    resources: res,
    layerChunks,
    paints,
    domContentLoaded: Math.round(nav?.domContentLoadedEventEnd || 0),
    loadEnd: Math.round(nav?.loadEventEnd || 0),
    cards: cards.length,
    innerBackdrop,
    edgeCfg: edge?.cfg || null,
    layerRows: toggles,
    lc: { mounted: !!globalThis.__lc?.api?.mounted, phase: [...document.querySelectorAll('.gev-lc')].map((c) => c.dataset.lcPhase || null) },
  };
});

/* FPS 8 秒（页面 rAF 口径） */
const fps = await page.evaluate(async () => {
  const frames = [];
  let last = performance.now();
  const end = last + 8000;
  await new Promise((done) => {
    const tick = (t) => {
      frames.push(t - last);
      last = t;
      if (t >= end) done();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  frames.shift();
  const mean = frames.reduce((a, b) => a + b, 0) / frames.length;
  const sorted = [...frames].sort((a, b) => a - b);
  return {
    samples: frames.length,
    fps: +(1000 / mean).toFixed(1),
    p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
    worst: +sorted[sorted.length - 1].toFixed(1),
    long: frames.filter((f) => f > 100).length,
  };
});

/* 真实鼠标开合一张卡（不用 element.click / __gevLc.open） */
const header = await page.evaluate(() => {
  const el = document.querySelector('#data-panel .panel-header') || document.querySelector('#data-panel');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  return { x, y, hit: (document.elementFromPoint(x, y) || {}).className || '' };
});
let click = { did: false };
if (header) {
  await page.mouse.move(header.x, header.y);
  await sleep(140);
  await page.mouse.down(); await sleep(40); await page.mouse.up();
  await sleep(900);
  const opened = await page.evaluate(() => [...document.querySelectorAll('.gev-lc')].some((c) => c.dataset.lcPhase && c.dataset.lcPhase !== 'mini'));
  await page.screenshot({ path: `${OUT}-open.png` });
  await page.mouse.down(); await sleep(40); await page.mouse.up();
  await sleep(900);
  const closed = await page.evaluate(() => [...document.querySelectorAll('.gev-lc')].every((c) => c.dataset.lcPhase === 'mini'));
  click = { did: true, hit: header.hit, opened, closed };
}

/* 截图：1x 全图 + 目标裁剪（DSF=4 时即 4x 像素） */
await page.mouse.move(700, 400);
await sleep(500);
await page.screenshot({ path: `${OUT}-full.png` });
const box = await page.evaluate(() => {
  const el = document.querySelector('#control-panel') || document.querySelector('.gev-lc');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), w: Math.min(r.width + 16, innerWidth), h: Math.min(r.height + 16, innerHeight) };
});
if (box) await page.screenshot({ path: `${OUT}-card.png`, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
const dpr = await page.evaluate(() => ({ dpr: devicePixelRatio, w: innerWidth, h: innerHeight }));

console.log(JSON.stringify({
  url: URL, dsf: DSF, dpr, bootInteractiveMs, lcMountedMs, maskGoneMs,
  click, fps, errors: errors.slice(0, 6), ...facts, shots: [`${OUT}-full.png`, `${OUT}-card.png`, `${OUT}-open.png`],
}, null, 1));
await browser.close();
