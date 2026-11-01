#!/usr/bin/env node
/* Phase8E2 验收（t_1ad4e981）：生产构建 dist-8e2 + 真实 Chrome。
   断言「首屏（FCP）时 0 个图层 chunk」+ 波次 2 在首帧后空闲水合 + 全部图层到齐 +
   控制台 0 error。
   用法：node scripts/lc/_8e2-accept2.mjs <url> <out.json> [--serve=<dir>]
   --serve 时脚本自带静态服务器（避免另起后台进程）。 */
import puppeteer from 'puppeteer';
import { writeFileSync, createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const URL_ARG = process.argv[2] || 'http://127.0.0.1:4187/?welcome=0';
const OUT = process.argv[3] || '.gev-logs/lc/phase8e2/accept.json';
const serveArg = process.argv.find((a) => a.startsWith('--serve='));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.geojsonl': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.wasm': 'application/wasm', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
};

let server = null;
if (serveArg) {
  const root = serveArg.slice('--serve='.length);
  const port = Number(new URL(URL_ARG).port || 80);
  server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(root, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(normalize(root))) { res.writeHead(403).end(); return; }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
    if (!existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  console.log(`[serve] ${root} on ${port}`);
}

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
await page.goto(URL_ARG, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__gevBoot && window.__gevBoot.state === 'interactive'), { timeout: 120000 }).catch(() => {});
const bootInteractiveMs = Date.now() - t0;
await page.waitForFunction(() => {
  const el = document.querySelector('#loading-screen');
  return !el || el.classList.contains('hidden') || getComputedStyle(el).display === 'none' || Number(getComputedStyle(el).opacity) < 0.05;
}, { timeout: 90000 }).catch(() => {});
const maskGoneMs = Date.now() - t0;
// 等后置注册完成（最多 60s），再多留 3s 让图层订阅/首轮数据落地
await page.waitForFunction(
  () => globalThis.__gevCatalogHydration && globalThis.__gevCatalogHydration.ok === true,
  { timeout: 60000 },
).catch(() => {});
const hydratedMs = Date.now() - t0;
await sleep(3000);

const facts = await page.evaluate(() => {
  const round = (v) => Math.round(v);
  const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, round(p.startTime)]));
  const nav = performance.getEntriesByType('navigation')[0];
  const res = performance.getEntriesByType('resource')
    .filter((e) => /\/assets\/.+\.js$/.test(e.name))
    .map((e) => ({ name: e.name.split('/').pop(), start: round(e.startTime), dur: round(e.duration), bytes: e.transferSize }))
    .sort((a, b) => a.start - b.start);
  const layerChunks = res.filter((r) => /catalogFactories/.test(r.name));
  const fcp = paint['first-contentful-paint'] ?? null;
  const accesses = globalThis.__gevPendingLayerAccesses || [];
  const byProp = {};
  for (const a of accesses) byProp[a.prop] = (byProp[a.prop] || 0) + 1;
  return {
    paint,
    fcp,
    layerChunksBeforeFcp: fcp == null ? null : layerChunks.filter((c) => c.start <= fcp).length,
    layerChunks,
    firstLayerChunkAt: layerChunks.length ? layerChunks[0].start : null,
    hydration: globalThis.__gevCatalogHydration || null,
    pendingAccessCount: accesses.length,
    pendingAccessProps: byProp,
    layerRows: document.querySelectorAll('#data-toggles [data-layer-id], #data-toggles .pp-toggle-btn').length,
    domContentLoaded: round(nav?.domContentLoadedEventEnd || 0),
    loadEnd: round(nav?.loadEventEnd || 0),
    cards: document.querySelectorAll('.gev-lc').length,
    innerBackdrop: [...document.querySelectorAll('.gev-lc')].reduce((n, card) => n + [...card.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      return (cs.backdropFilter && cs.backdropFilter !== 'none') || (cs.webkitBackdropFilter && cs.webkitBackdropFilter !== 'none');
    }).length, 0),
  };
});

const check = {
  zeroLayerChunksBeforeFcp: facts.layerChunksBeforeFcp === 0,
  restRequestedAfterFirstPaint: facts.layerChunks.filter((c) => /Rest/.test(c.name)).every((c) => c.start > (facts.fcp ?? 0)),
  restRequestedAfterInteractive: facts.layerChunks.filter((c) => /Rest/.test(c.name)).every((c) => c.start > bootInteractiveMs),
  hydratedPendingZero: facts.hydration?.ok === true && facts.hydration?.pendingAfter === 0,
  pendingBefore: facts.hydration?.pendingBefore ?? null,
  noConsoleErrors: errors.length === 0,
  layerRows: facts.layerRows,
};

const record = { url: URL_ARG, bootInteractiveMs, maskGoneMs, hydratedMs, ...facts, errors: errors.slice(0, 8), check };
writeFileSync(OUT, JSON.stringify(record, null, 1));
console.log(JSON.stringify(record, null, 1));
await browser.close();
if (server) await new Promise((r) => server.close(r));
