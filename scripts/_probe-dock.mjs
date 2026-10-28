#!/usr/bin/env node
/** _probe-dock.mjs —— 定位 dock 卡（location-bar）两次展开几何差异的来源 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1560,860', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.removeItem('gev-liquid-cards:v2'); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(11000);

const snapDock = () => page.evaluate(() => {
  const ids = ['location-bar', 'control-panel', 'gev-voice-control', 'gev-perf-wrap', 'gev-lang-toggle', 'gev-locate-btn', 'key-setup-chip', 'style-indicator', 'gev-gfx-fab'];
  const o = {};
  for (const id of ids) {
    const e = document.getElementById(id);
    if (!e) continue;
    const b = e.getBoundingClientRect();
    o[id] = [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
  }
  const st = window.__gevLc.state();
  const nat = {};
  for (const k of ['location-bar', 'control-panel', 'gev-voice-control']) {
    const n = st[k] && st[k].nat;
    nat[k] = n ? [Math.round(n.left), Math.round(n.top), Math.round(n.width), Math.round(n.height)] : null;
  }
  return { rects: o, nat, float: window.__gevLc._ids(), lb: window.__gevLc.info('location-bar') };
});

const clickHeader = async (id) => {
  const p = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const h = el.querySelector('.location-toolbar,.location-bar-toggle,.panel-header,.dock-tray-toggle');
    const r = h.getBoundingClientRect();
    return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.5), hr: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
  }, id);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
  await sleep(800);
  return p;
};

for (let run = 1; run <= 3; run++) {
  const before = await snapDock();
  const p = await clickHeader('location-bar');
  const after = await snapDock();
  console.log('RUN', run);
  console.log('  hdrPoint', JSON.stringify(p));
  console.log('  before', JSON.stringify(before.rects), 'float', before.float);
  console.log('  after ', JSON.stringify(after.rects), 'float', after.float, 'lb', JSON.stringify(after.lb));
  await page.keyboard.press('Escape');
  await sleep(700);
  const closed = await snapDock();
  console.log('  closed', JSON.stringify(closed.rects['location-bar']), 'float', closed.float);
}
await browser.close();
