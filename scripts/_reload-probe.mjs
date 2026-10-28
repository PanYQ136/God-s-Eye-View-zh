#!/usr/bin/env node
/** _reload-probe.mjs —— 单独验证「刷新恢复上次卡」：真实点击打开一张卡 → reload → 看恢复的是哪张 */
import puppeteer from 'puppeteer';
const CARD = process.argv[2] || 'location-bar';
const SEL = { 'location-bar': '#location-bar-toggle', 'control-panel': '#control-panel-toggle', 'cctv-panel': '#cctv-panel .panel-title' }[CARD];

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1560,860', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  if ((window.name || '').indexOf('keep') < 0) {
    try {
      localStorage.removeItem('gev-liquid-cards:v2');
      localStorage.removeItem('gev-liquid-cards:v2:last');
    } catch (e) {}
  }
  localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
});
const st = () => page.evaluate(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
  const fl = ids.filter((id) => { const e = document.getElementById(id); return e && e.classList.contains('gev-lc-floating'); });
  let store = null;
  try { store = JSON.parse(localStorage.getItem('gev-liquid-cards:v2') || '{}'); } catch (e) {}
  const last = localStorage.getItem('gev-liquid-cards:v2:last');
  const slim = {};
  for (const k of Object.keys(store || {})) slim[k] = { x: store[k].x, y: store[k].y, floating: store[k].floating, vw: store[k].vw };
  return { floating: fl, last, store: slim };
});
const boot = async () => {
  await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
  for (let i = 0; i < 80; i++) {
    const ok = await page.evaluate(() => {
      const l = document.querySelector('#loading-screen');
      return !l || parseFloat(getComputedStyle(l).opacity || '1') < 0.05;
    }).catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 9000));
};
await page.goto('http://127.0.0.1:4173/?rp=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 120000 });
await boot();
console.log('initial', JSON.stringify(await st()));
const p = await page.evaluate((s) => {
  const e = document.querySelector(s);
  const b = e.getBoundingClientRect();
  return { x: Math.round(b.x + Math.min(40, b.width / 2)), y: Math.round(b.y + b.height / 2) };
}, SEL);
await page.mouse.click(p.x, p.y, { delay: 30 });
await new Promise((r) => setTimeout(r, 1500));
const afterClick = await st();
console.log('afterClick', CARD, JSON.stringify(afterClick));
await page.evaluate(() => (window.name = 'keep'));
await page.reload({ waitUntil: 'domcontentloaded' });
await boot();
console.log('afterReload', JSON.stringify(await st()));
await browser.close();
