#!/usr/bin/env node
/** dbg-place.mjs —— 展开单卡时打印所有卡片的 rect/可见/hid，定位避让来源 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const id = process.argv[2] || 'control-panel';
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--window-size=1536,820'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(1000);
await page.evaluate((id) => window.__gevLc.open(id), id);
await sleep(900);
const out = await page.evaluate((ids) => {
  const R = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const rows = [];
  ids.forEach((i) => {
    const el = document.getElementById(i); if (!el) return;
    const cs = getComputedStyle(el);
    rows.push({ id: i, rect: R(el), vis: cs.visibility, op: cs.opacity, hid: el.classList.contains('gev-lc-hid'), collapsed: el.classList.contains('collapsed'), floating: el.classList.contains('gev-lc-floating') });
  });
  ['gev-voice-control', 'gev-gfx-fab', 'key-setup-chip', 'style-indicator', 'gev-perf-wrap', 'gev-lang-toggle', 'gev-locate-btn', 'top-center-actions', 'command-dock', 'location-bar-toggle', 'control-panel-toggle'].forEach((i) => {
    const el = document.getElementById(i); if (!el) return;
    const cs = getComputedStyle(el);
    rows.push({ id: i, rect: R(el), vis: cs.visibility, op: cs.opacity });
  });
  return rows;
}, ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel']);
console.log('open=' + id);
out.forEach((r) => console.log(r.id.padEnd(24), JSON.stringify(r.rect), 'vis=' + r.vis, 'op=' + r.op, r.hid ? 'HID' : '', r.collapsed ? 'collapsed' : '', r.floating ? 'FLOATING' : ''));
await page.screenshot({ path: 'evidence/_collab/t_8cf06356/dbg-' + id + '.png' });
await browser.close();
