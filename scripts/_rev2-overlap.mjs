#!/usr/bin/env node
/** _rev2-overlap.mjs — 检查「dock 卡展开后，右栏 mini 卡 header 是否被 dock/voice 层压住」 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('.gev-logs/rev2-accept');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IDS = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'gev-voice-control', 'gev-gfx-fab', 'command-dock', 'gev-voice-button'];
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(8500);

const snap = () => page.evaluate((IDS) => {
  const o = {};
  for (const id of IDS) {
    const e = document.getElementById(id);
    if (!e) { o[id] = null; continue; }
    const r = e.getBoundingClientRect();
    o[id] = { rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)],
      cls: String(e.className).slice(0, 40), open: !e.classList.contains('collapsed') };
  }
  // 右栏三张 mini 卡 header 中心的命中者
  const hits = {};
  for (const id of ['pp-toggles', 'cctv-panel', 'global-context-panel']) {
    const e = document.getElementById(id);
    const h = e.querySelector('.panel-header, .pp-header-row') || e;
    const r = h.getBoundingClientRect();
    const el = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2));
    const own = el && el.closest ? el.closest('[id]') : null;
    hits[id] = { at: [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)],
      hit: el ? el.tagName + '.' + String(el.className || '').slice(0, 26) : null, owner: own ? own.id : null,
      onOwnHeader: !!(el && h.contains(el)) };
  }
  return { cards: o, hits };
}, IDS);

const clickHeader = async (id) => {
  const p = await page.evaluate((id) => {
    const e = document.getElementById(id);
    const h = e.querySelector('.panel-header, .pp-header-row, .dock-header, .location-toolbar-label') || e;
    const r = h.getBoundingClientRect();
    return { x: Math.round(r.x + r.width * 0.35), y: Math.round(r.y + r.height / 2) };
  }, id);
  await page.mouse.move(p.x, p.y); await sleep(60); await page.mouse.down(); await sleep(45); await page.mouse.up();
  await sleep(1300);
  return p;
};

const out = {};
out.baseline = await snap();
await page.screenshot({ path: path.join(OUT, 'ov-baseline.png') });
for (const id of ['location-bar', 'control-panel', 'pp-toggles']) {
  const at = await clickHeader(id);
  out['after_' + id] = { at, ...(await snap()) };
  await page.screenshot({ path: path.join(OUT, 'ov-' + id + '.png') });
  await clickHeader(id);
  await sleep(1200);
}
console.log(JSON.stringify(out, null, 1));
fs.writeFileSync(path.join(OUT, 'overlap.json'), JSON.stringify(out, null, 1));
await browser.close();
