#!/usr/bin/env node
/**
 * qa-regress.mjs —— 7 张卡展开/收缩 + 控制台错误 + 768 宽窄屏 sanity
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'evidence/_collab/t_9739e3a7';
const res = { cards: {}, errors: [] };
const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--window-position=1900,40', '--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'],
  protocolTimeout: 900000,
});
async function open(w, h) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 160)); });
  await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => window.__gevEdge && document.getElementById('data-panel'), { timeout: 120000 });
  await sleep(11000);
  await page.keyboard.press('Escape');
  await sleep(1800);
  page.__errs = errs;
  return page;
}
const page = await open(1536, 730);
const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel'];
const rect = (p, id) => p.evaluate((id) => { const r = document.getElementById(id).getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }, id);
const toggle = (p, id) => p.evaluate((id) => {
  const el = document.getElementById(id); const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 24, clientY: r.top + 14 }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + 24, clientY: r.top + 14 }));
}, id);
for (const id of ids) {
  const before = await rect(page, id);
  await toggle(page, id); await sleep(1500);
  const exp = await rect(page, id);
  const st = await page.evaluate(() => { const s = window.__gevEdge.stats(); return { count: s.count, rings: s.surfaces.map((x) => x.id + ':' + x.band).join(','), err: s.err }; });
  await page.screenshot({ path: `${OUT}/regress-expand-${id}.png` });
  await toggle(page, id); await sleep(1600);
  const after = await rect(page, id);
  const overlap = await page.evaluate((id) => {
    const a = document.getElementById(id).getBoundingClientRect();
    let worst = 0;
    document.querySelectorAll('.gev-lc').forEach((c) => {
      if (c.id === id) return;
      const cs = getComputedStyle(c);
      if (cs.visibility === 'hidden' || cs.display === 'none') return;
      const b = c.getBoundingClientRect();
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 0 && h > 0) worst = Math.max(worst, Math.round(w * h));
    });
    return worst;
  }, id);
  res.cards[id] = { before, expanded: exp, after, restored: JSON.stringify(before) === JSON.stringify(after), overlapPx: overlap, surfaces: st };
}
res.pageAfterAll = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
  hidden: document.querySelectorAll('.gev-lc-hid').length, floating: document.querySelectorAll('.gev-lc-floating').length,
}));
res.errors = page.__errs.slice(-10);
await page.screenshot({ path: `${OUT}/regress-all-closed.png` });
await page.close();

/* 窄屏 sanity */
const p2 = await open(768, 900);
res.narrow = await p2.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
  st: (() => { const s = window.__gevEdge.stats(); return { count: s.count, err: s.err, scale: s.scale, canvas: s.canvas }; })(),
}));
await p2.screenshot({ path: `${OUT}/regress-768.png` });
res.narrowErrors = p2.__errs.slice(-6);
fs.writeFileSync(`${OUT}/qa-regress.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
await browser.close();
