#!/usr/bin/env node
/* Phase8E2 取证（探测）：启动期访问面 + 后置注册时序 + 首屏/图层 chunk 时序。
   用法：node scripts/lc/_8e2-probe.mjs <url> <out.json> [extraWaitMs] */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const URL_ARG = process.argv[2] || 'http://127.0.0.1:4183/';
const OUT = process.argv[3] || '.gev-logs/lc/phase8e2/probe.json';
const EXTRA = Number(process.argv[4] || 3000);
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
await page.goto(URL_ARG, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__gevBoot && window.__gevBoot.state === 'interactive'), { timeout: 120000 }).catch(() => {});
const bootInteractiveMs = Date.now() - t0;
await page.waitForFunction(() => {
  const el = document.querySelector('#loading-screen');
  return !el || el.classList.contains('hidden') || getComputedStyle(el).display === 'none' || Number(getComputedStyle(el).opacity) < 0.05;
}, { timeout: 90000 }).catch(() => {});
const maskGoneMs = Date.now() - t0;
await page.waitForFunction(() => globalThis.__gevCatalogHydration?.doneAt != null, { timeout: 60000 }).catch(() => {});
const hydratedMs = Date.now() - t0;
await sleep(EXTRA);

const facts = await page.evaluate(() => {
  const tl = globalThis.__bootTimeline;
  const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]));
  const res = performance.getEntriesByType('resource')
    .filter((e) => /catalogFactories/.test(e.name))
    .map((e) => ({ name: e.name.split('/').pop(), start: Math.round(e.startTime), dur: Math.round(e.duration) }))
    .sort((a, b) => a.start - b.start);
  return {
    paint,
    marks: (tl?.snapshot?.()?.marks || []).map((m) => ({ name: m.name, t: m.t })),
    timeline: tl?.snapshot?.() || null,
    boot: globalThis.__gevBoot?.snapshot?.() || null,
    layerRes: res,
    hydration: globalThis.__gevCatalogHydration || null,
    pendingAccesses: (globalThis.__gevPendingLayerAccesses || []).slice(0, 60),
    pendingAccessCount: (globalThis.__gevPendingLayerAccesses || []).length,
    rows: document.querySelectorAll('#data-toggles .pp-toggle-btn, #data-toggles [data-layer-id]').length,
  };
});

writeFileSync(OUT, JSON.stringify({ url: URL_ARG, bootInteractiveMs, maskGoneMs, hydratedMs, errors: errors.slice(0, 8), ...facts }, null, 1));
console.log(JSON.stringify({
  url: URL_ARG, bootInteractiveMs, maskGoneMs, hydratedMs,
  paint: facts.paint,
  layerRes: facts.layerRes,
  hydration: facts.hydration,
  pendingAccessCount: facts.pendingAccessCount,
  pendingAccesses: facts.pendingAccesses.slice(0, 12),
  rows: facts.rows,
  marks: facts.marks,
  errors: errors.slice(0, 5),
}, null, 1));
await browser.close();
