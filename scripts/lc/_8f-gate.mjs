#!/usr/bin/env node
/* Phase8F Gate 运行态取证（只读；不改产品代码、不改阈值）
   量：renderer / 启动可点 / 一层玻璃 / lens cfg / FPS 8s + 长帧 / 真实鼠标开合 /
       reload 后黑帧（中心区 std/uniq 四点采样）/ 控制台错误
   出：1x 全图 + 卡 1x/4x/8x（LANCZOS/NEAREST 放大）+ gate JSON
   用法: node scripts/lc/_8f-gate.mjs <url> <outPrefix> */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';

const URL = process.argv[2] || 'http://localhost:4175/?welcome=0';
const OUT = process.argv[3] || '.gev-logs/lc/phase8f/gate';
mkdirSync('.gev-logs/lc/phase8f', { recursive: true });
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
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__gevBoot && window.__gevBoot.state === 'interactive'), { timeout: 120000 }).catch(() => {});
const bootInteractiveMs = Date.now() - t0;
await page.waitForFunction(() => !!(window.__lc && window.__lc.api && window.__lc.api.mounted), { timeout: 120000 }).catch(() => {});
const lcMountedMs = Date.now() - t0;
await page.waitForFunction(() => {
  const el = document.querySelector('#loading-screen');
  return !el || el.classList.contains('hidden') || getComputedStyle(el).display === 'none' || Number(getComputedStyle(el).opacity) < 0.05;
}, { timeout: 90000 }).catch(() => {});
const maskGoneMs = Date.now() - t0;
await sleep(9000);

const facts = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a';
  const cards = [...document.querySelectorAll('.gev-lc')];
  const innerBackdrop = cards.reduce((n, card) => n + [...card.querySelectorAll('*')].filter((el) => {
    const cs = getComputedStyle(el);
    return (cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none');
  }).length, 0);
  const cardBackdrop = cards.map((c) => getComputedStyle(c).backdropFilter || getComputedStyle(c).webkitBackdropFilter);
  const edge = globalThis.__gevEdge && globalThis.__gevEdge.stats ? globalThis.__gevEdge.stats() : null;
  const paints = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
  const res = performance.getEntriesByType('resource').filter((e) => /\/assets\/.+\.js$/.test(e.name))
    .map((e) => ({ name: e.name.split('/').pop(), start: Math.round(e.startTime), bytes: e.transferSize }))
    .sort((a, b) => a.start - b.start);
  const pp = document.querySelector('#pp-toggles');
  return {
    renderer,
    cards: cards.length,
    innerBackdrop,
    cardBackdrop,
    edgeCfg: edge?.cfg || null,
    edgeEff: edge?.eff || null,
    lookKeys: edge?.look ? Object.keys(edge.look) : null,
    paints,
    layerChunks: res.filter((r) => /catalogFactories/.test(r.name)),
    layerRows: document.querySelectorAll('#data-toggles [data-layer-id], #data-toggles .pp-toggle-btn').length,
    ppRows: pp ? pp.querySelectorAll('*').length : null,
    glassState: globalThis.__lc?.glass?.state ? globalThis.__lc.glass.state() : null,
    photoreal: !!globalThis.__gevPhotoreal?.ready,
    lc: { mounted: !!globalThis.__lc?.api?.mounted },
  };
});

const fps = await page.evaluate(async () => {
  const frames = [];
  let last = performance.now();
  const end = last + 8000;
  await new Promise((done) => {
    const tick = (t) => { frames.push(t - last); last = t; if (t >= end) done(); else requestAnimationFrame(tick); };
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
    long100: frames.filter((f) => f > 100).length,
    under30: frames.filter((f) => f > 33.4).length,
  };
});

/* 真实鼠标开合（不做 element.click） */
const header = await page.evaluate(() => {
  const el = document.querySelector('#data-panel .panel-header') || document.querySelector('#data-panel');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, hit: (document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) || {}).className || '' };
});
let click = { did: false };
if (header) {
  await page.mouse.move(header.x, header.y); await sleep(160);
  await page.mouse.down(); await sleep(50); await page.mouse.up(); await sleep(1000);
  const opened = await page.evaluate(() => [...document.querySelectorAll('.gev-lc')].some((c) => c.dataset.lcPhase && c.dataset.lcPhase !== 'mini'));
  await page.screenshot({ path: `${OUT}-open.png` });
  await page.mouse.down(); await sleep(50); await page.mouse.up(); await sleep(1000);
  const closed = await page.evaluate(() => [...document.querySelectorAll('.gev-lc')].every((c) => c.dataset.lcPhase === 'mini'));
  click = { did: true, hit: header.hit, opened, closed };
}

await page.mouse.move(700, 400); await sleep(600);
await page.screenshot({ path: `${OUT}-full-1x.png` });
const box = await page.evaluate(() => {
  const el = document.querySelector('#control-panel') || document.querySelector('.gev-lc');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.max(0, Math.round(r.x - 10)), y: Math.max(0, Math.round(r.y - 10)), w: Math.min(Math.round(r.width + 20), innerWidth), h: Math.min(Math.round(r.height + 20), innerHeight) };
});
let cardPaths = [];
if (box) {
  await page.screenshot({ path: `${OUT}-card-1x.png`, clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
  const buf = await sharp(`${OUT}-card-1x.png`).resize(box.w * 4, box.h * 4, { kernel: 'lanczos3' }).png().toBuffer();
  writeFileSync(`${OUT}-card-4x.png`, buf);
  const buf8 = await sharp(`${OUT}-card-1x.png`).resize(box.w * 8, box.h * 8, { kernel: 'nearest' }).png().toBuffer();
  writeFileSync(`${OUT}-card-8x.png`, buf8);
  cardPaths = [`${OUT}-card-1x.png`, `${OUT}-card-4x.png`, `${OUT}-card-8x.png`];
}

/* reload 黑帧：photoreal ready 后 reload，四点采样中心区 */
async function centerStats() {
  const b = await page.screenshot({ path: `${OUT}-reload.png` });
  const img = await sharp(b).extract({ left: 354, top: 177, width: 640, height: 420 }).raw().toBuffer({ resolveWithObject: true });
  const d = img.data; let sum = 0, sum2 = 0, n = 0; const set = new Set();
  for (let i = 0; i < d.length; i += img.info.channels) {
    const v = d[i]; sum += v; sum2 += v * v; n++; if (set.size < 60000) set.add(d[i] * 65536 + d[i + 1] * 256 + d[i + 2]);
  }
  const mean = sum / n;
  return { mean: +mean.toFixed(2), std: +Math.sqrt(sum2 / n - mean * mean).toFixed(2), uniq: set.size };
}
let reload = { did: false };
try {
  await page.waitForFunction(() => !!(window.__gevPhotoreal && window.__gevPhotoreal.ready), { timeout: 60000 });
  await sleep(3000);
  const before = await centerStats();
  await page.reload({ waitUntil: 'domcontentloaded' });
  const t1 = Date.now();
  await page.waitForFunction(() => !!(window.__gevPhotoreal && window.__gevPhotoreal.ready), { timeout: 90000 }).catch(() => {});
  const readyMs = Date.now() - t1;
  await sleep(100);
  const p100 = await centerStats();
  await sleep(1000);
  const p1s = await centerStats();
  await sleep(3000);
  const p4s = await centerStats();
  await sleep(4000);
  const p8s = await centerStats();
  reload = { did: true, before, readyMs, p100, p1s, p4s, p8s };
} catch (e) { reload = { did: false, err: String(e).slice(0, 200) }; }

const out = { url: URL, renderer: facts.renderer, bootInteractiveMs, lcMountedMs, maskGoneMs, facts, fps, click, cardPaths, reload, errors };
writeFileSync('.gev-logs/lc/phase8f/gate.json', JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  renderer: out.renderer, bootInteractiveMs, lcMountedMs, maskGoneMs,
  cards: facts.cards, innerBackdrop: facts.innerBackdrop, cardBackdrop: facts.cardBackdrop,
  edgeCfg: facts.edgeCfg, edgeEff: facts.edgeEff, lookKeys: facts.lookKeys,
  paints: facts.paints, layerChunks: facts.layerChunks, layerRows: facts.layerRows,
  fps, click, reload, errors: errors.slice(0, 8),
}, null, 1));
await browser.close();
