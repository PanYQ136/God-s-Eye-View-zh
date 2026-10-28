#!/usr/bin/env node
/** _probe-raintime.mjs — 记录右栏 top 的初始沉降时间线（判断 189.8→93.8 是 init settle 还是抖动） */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
});
const t0 = Date.now();
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 60000 });
const rows = [];
for (let i = 0; i < 60; i++) {
  const s = await page.evaluate(() => {
    const rail = document.getElementById('right-context-rail');
    const pp = document.getElementById('pp-toggles');
    const loading = document.getElementById('loading-screen');
    return {
      railY: rail ? +rail.getBoundingClientRect().y.toFixed(1) : null,
      ppY: pp ? +pp.getBoundingClientRect().y.toFixed(1) : null,
      safeTop: rail ? rail.dataset.safeTop || '' : '',
      loading: loading ? getComputedStyle(loading).display !== 'none' && +getComputedStyle(loading).opacity > 0.05 : false,
    };
  });
  rows.push({ t: Date.now() - t0, ...s });
  await sleep(250);
}
let prev = null;
for (const r of rows) {
  const k = JSON.stringify([r.railY, r.ppY, r.safeTop, r.loading]);
  if (k !== prev) console.log(`${r.t}ms railY=${r.railY} ppY=${r.ppY} safeTop=${r.safeTop} loading=${r.loading}`);
  prev = k;
}
await browser.close();
