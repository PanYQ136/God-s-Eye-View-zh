#!/usr/bin/env node
/** _app-probe.mjs —— 最小探针：加载应用，报告 Cesium 是否报错 + 卡片几何 */
import puppeteer from 'puppeteer';

const headful = process.argv.includes('--headful');
const extra = (process.argv.find((a) => a.startsWith('--args=')) || '').slice(7);
const args = [
  '--no-sandbox',
  ...(extra ? extra.split(',') : ['--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']),
  '--window-size=1600,900',
  '--window-position=1900,40',
  '--hide-scrollbars',
];
const browser = await puppeteer.launch({
  headless: !headful,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args,
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('[c] ' + m.text().slice(0, 200)); });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.removeItem('gev-liquid-cards:v2');
    localStorage.removeItem('gev-liquid-cards:v2:last');
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
  } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?probe=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 120000 });
let tLoad = -1;
for (let i = 0; i < 60; i++) {
  const gone = await page.evaluate(() => {
    const l = document.querySelector('#loading-screen');
    return !l || parseFloat(getComputedStyle(l).opacity || '1') < 0.05;
  }).catch(() => false);
  if (gone) { tLoad = i * 500; break; }
  await new Promise((r) => setTimeout(r, 500));
}
await new Promise((r) => setTimeout(r, 7000));
const info = await page.evaluate(() => {
  const errPanel = document.querySelector('.cesium-widget-errorPanel');
  const cards = {};
  for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
    const e = document.getElementById(id);
    if (!e) { cards[id] = null; continue; }
    const b = e.getBoundingClientRect();
    cards[id] = { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), floating: e.classList.contains('gev-lc-floating') };
  }
  return { errPanel: !!errPanel, errText: errPanel ? errPanel.textContent.slice(0, 200) : null, cards, xClose: document.querySelectorAll('.gev-lc-close').length, vw: innerWidth, vh: innerHeight };
});
console.log(JSON.stringify({ headful, tLoad, errs: errs.slice(0, 5), info }, null, 1));
await page.screenshot({ path: '.gev-logs/phase1fix/probe-app.png' }).catch(() => {});
await browser.close();
