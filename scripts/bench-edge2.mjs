#!/usr/bin/env node
/**
 * bench-edge2.mjs —— 边缘折射环性能/正确性取证
 * 依次加载 ?gevEdge=0 / 2 / 1，每次测「折叠 + 展开」两态帧率并截图。
 * 用法：node scripts/bench-edge2.mjs [base-url]
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.argv[2] || 'http://localhost:4173/';
const W = 1536, H = 730;
const OUT = 'evidence/_collab/t_9739e3a7';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--window-position=1900,40', '--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--window-size=1536,820'],
  protocolTimeout: 600000,
});

async function openPage(q) {
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  const logs = [];
  page.on('console', (m) => { const t = m.text(); if (/gev-edge|ERR|Error|shader|WebGL/i.test(t)) logs.push(t.slice(0, 240)); });
  page.on('pageerror', (e) => logs.push('PAGEERR ' + String(e).slice(0, 240)));
  await page.goto(BASE + q, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
  await sleep(9000);
  await page.keyboard.press('Escape');
  await sleep(1500);
  page.__logs = logs;
  return page;
}
async function fps(page, label, ms = 2600) {
  const r = await page.evaluate(async (ms) => {
    const t = []; const t0 = performance.now();
    while (performance.now() - t0 < ms) { const a = performance.now(); await new Promise((res) => requestAnimationFrame(res)); t.push(performance.now() - a); }
    t.sort((x, y) => x - y); const p = (q) => +t[Math.floor(t.length * q)].toFixed(2);
    return { p50: p(0.5), p90: p(0.9), p99: p(0.99), fps50: +(1000 / p(0.5)).toFixed(1), fps90: +(1000 / p(0.9)).toFixed(1) };
  }, ms);
  console.log('  ' + label.padEnd(28), JSON.stringify(r));
  return r;
}
async function expand(page) {
  await page.evaluate(() => {
    const el = document.getElementById('data-panel'); const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 30, clientY: r.top + 20 }));
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + 30, clientY: r.top + 20 }));
  });
  await sleep(1300);
}
const result = {};
for (const [mode, q] of [['0-baseline', '?gevEdge=0'], ['2-pdb', '?gevEdge=2'], ['1-edge', '?gevEdge=1']]) {
  console.log('\n== mode', mode);
  const page = await openPage(q);
  const st0 = await page.evaluate(() => (window.__gevEdge ? window.__gevEdge.stats() : null));
  const collapsed = await fps(page, 'collapsed');
  await page.screenshot({ path: `${OUT}/edge-${mode}-collapsed.png` });
  await expand(page);
  const expanded = await fps(page, 'expanded');
  await page.screenshot({ path: `${OUT}/edge-${mode}-expanded.png` });
  const st1 = await page.evaluate(() => (window.__gevEdge ? window.__gevEdge.stats() : null));
  const oneCard = mode === '1-edge'
    ? await (async () => {
      await page.evaluate(() => { window.__gevEdge.only(['data-panel']); });
      await sleep(500);
      const r = await fps(page, 'only data-panel');
      await page.screenshot({ path: `${OUT}/edge-1-only.png` });
      return r;
    })()
    : null;
  result[mode] = { q, collapsed, expanded, oneCard, st0, st1, logs: page.__logs.slice(-12) };
  await page.close();
}
fs.writeFileSync(`${OUT}/bench-edge2.json`, JSON.stringify(result, null, 1));
console.log('\n' + JSON.stringify(Object.fromEntries(Object.entries(result).map(([k, v]) => [k, { collapsed: v.collapsed.fps50, expanded: v.expanded.fps50, tex: v.st1 && v.st1.tex, err: v.st1 && v.st1.err, count: v.st1 && v.st1.count, one: v.oneCard && v.oneCard.fps50 }])), null, 1));
await browser.close();
