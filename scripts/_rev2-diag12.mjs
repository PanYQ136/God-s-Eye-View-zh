#!/usr/bin/env node
/** _rev2-diag12.mjs — 复现快速连点第 12 击（cctv→global）时 global header 为何 0 个可命中点 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('.gev-logs/rev2-accept');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
await sleep(8000);

const HEADER_SEL = '.panel-header, .pp-header-row, .dock-header, header, .location-toolbar-label, .panel-title, .pp-header-label';
const probe = (id) => page.evaluate((id, SEL) => {
  const el = document.getElementById(id);
  const c = getComputedStyle(el);
  const h = el.querySelector(SEL);
  const hr = h && h.getBoundingClientRect();
  const hc = h && getComputedStyle(h);
  const cx = hr ? Math.round(hr.x + hr.width / 2) : null;
  const cy = hr ? Math.round(hr.y + hr.height / 2) : null;
  const e = (cx !== null) ? document.elementFromPoint(cx, cy) : null;
  const owner = e && e.closest ? e.closest('[id]') : null;
  return {
    cls: el.className, rect: [+el.getBoundingClientRect().x.toFixed(0), +el.getBoundingClientRect().y.toFixed(0),
      +el.getBoundingClientRect().width.toFixed(0), +el.getBoundingClientRect().height.toFixed(0)],
    op: c.opacity, vis: c.visibility, disp: c.display, pe: c.pointerEvents, z: c.zIndex, transform: c.transform,
    header: hr ? { rect: [+hr.x.toFixed(0), +hr.y.toFixed(0), +hr.width.toFixed(0), +hr.height.toFixed(0)], op: hc.opacity, pe: hc.pointerEvents, disp: hc.display, vis: hc.visibility } : null,
    hitAtHeaderCentre: e ? e.tagName + '.' + String(e.className || '').slice(0, 30) : null,
    hitOwner: owner ? owner.id : null,
    appHidden: el.hasAttribute('hidden') || el.dataset.hidden || '', parentCls: el.parentElement ? el.parentElement.className : '',
  };
}, id, HEADER_SEL);

const clickHeader = async (id, fx = 0.5) => {
  const p = await page.evaluate((id, fx) => {
    const e = document.getElementById(id);
    const h = e.querySelector('.panel-header, .pp-header-row, .dock-header, .location-toolbar-label') || e;
    const r = h.getBoundingClientRect();
    return { x: Math.round(r.x + r.width * fx), y: Math.round(r.y + r.height / 2) };
  }, id, fx);
  await page.mouse.move(p.x, p.y); await sleep(60); await page.mouse.down(); await sleep(45); await page.mouse.up();
  return p;
};

// 复制 rapid 序列前 11 击的节奏
const seq = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel',
  'location-bar', 'control-panel', 'data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel'];
const log = [];
for (const id of seq) {
  const p = await clickHeader(id);
  await sleep(900 + 90);
  log.push({ id, at: p, state: await probe('global-context-panel') });
}
// 现在 cctv 刚被打开（第 11 击），逐 300ms 采样 4 秒
const timeline = [];
for (let i = 0; i < 14; i++) {
  timeline.push({ t: i * 300, g: await probe('global-context-panel'), c: await probe('cctv-panel') });
  await sleep(300);
}
console.log(JSON.stringify({ log, timeline }, null, 1).slice(0, 12000));
fs.writeFileSync(path.join(OUT, 'diag12.json'), JSON.stringify({ log, timeline }, null, 1));
await browser.close();
