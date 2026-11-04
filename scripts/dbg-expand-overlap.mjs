#!/usr/bin/env node
/** dbg-expand-overlap.mjs —— 诊断：展开避让为什么没生效（control vs 右栏卡） */
import puppeteer from 'puppeteer';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VW = 1536, VH = 730;

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization', '--window-size=1536,820', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: VW, height: VH, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.removeItem('gev-liquid-cards:v2');
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
    localStorage.setItem('gev.gfx', JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'default' }));
  } catch (e) {}
});
page.on('console', (m) => { const t = m.text(); if (/error|Error/.test(t)) console.log('[console]', t.slice(0, 200)); });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 120000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(2000);

const rects = () => page.evaluate(() => {
  const out = {};
  for (const id of ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']) {
    const e = document.getElementById(id);
    if (!e) { out[id] = null; continue; }
    const b = e.getBoundingClientRect();
    const s = getComputedStyle(e);
    out[id] = { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height), disp: s.display, vis: s.visibility, op: s.opacity, cls: e.className };
  }
  return out;
});

console.log('== baseline ==');
console.log(JSON.stringify(await rects(), null, 0));

// 打开 pp-toggles
await page.evaluate(() => window.__gevLc.open('pp-toggles'));
await sleep(1200);
console.log('== after open pp ==');
console.log(JSON.stringify(await rects(), null, 0));

// 诊断：control 的障碍表（不跳过任何）
const diag = await page.evaluate(() => {
  const obs = window.__gevLc._obs('control-panel', []);
  const place = window.__gevLc._place('control-panel', []);
  const CARDS = window.__gevLc.cards;
  const ids = Object.keys(CARDS);
  const raw = ids.map((id) => {
    const e = document.getElementById(id);
    if (!e) return [id, 'no-el'];
    const b = e.getBoundingClientRect();
    return [id, Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height), getComputedStyle(e).display, getComputedStyle(e).visibility, getComputedStyle(e).opacity];
  });
  return { obs, place, raw };
});
console.log('== diag obs(control) ==');
console.log(JSON.stringify(diag.obs));
console.log('== diag raw cards ==');
console.log(JSON.stringify(diag.raw));
console.log('== diag _place(control) ==');
console.log(JSON.stringify(diag.place));

// 真打开 control
await page.evaluate(() => window.__gevLc.open('control-panel'));
await sleep(1400);
console.log('== after open control ==');
console.log(JSON.stringify(await rects(), null, 0));

await page.screenshot({ path: 'evidence/_collab/t_f8d97c1c/dbg-combo.png' }).catch(() => {});
await browser.close();
