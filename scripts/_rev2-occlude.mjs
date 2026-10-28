#!/usr/bin/env node
/** _rev2-occlude.mjs — 量化「切到右栏 cctv 后，global 的 header 多久重新可命中」 */
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

const click = async (id, fx = 0.5) => {
  const p = await page.evaluate((id, fx) => {
    const e = document.getElementById(id);
    const h = e.querySelector('.pp-header-row, .panel-header, .location-toolbar-label') || e;
    const r = h.getBoundingClientRect();
    return { x: Math.round(r.x + r.width * fx), y: Math.round(r.y + r.height / 2) };
  }, id, fx);
  await page.mouse.move(p.x, p.y); await sleep(60); await page.mouse.down(); await sleep(45); await page.mouse.up();
  return p;
};

// 1) 打开 cctv
await click('cctv-panel');
await sleep(1200);
// 2) 立刻点 global，同时逐 100ms 记录 global 的可见性/命中
await page.evaluate((id) => {
  window.__oc = null;
  const el = document.getElementById(id);
  const h = el.querySelector('.panel-header, .pp-header-row') || el;
  window.__oc = { samples: [] };
  const t0 = performance.now();
  const iv = setInterval(() => {
    const r = h.getBoundingClientRect();
    const c = getComputedStyle(el);
    const e = document.elementFromPoint(Math.round(r.x + r.width * 0.5), Math.round(r.y + r.height / 2));
    const owner = e && e.closest ? e.closest('[id]') : null;
    window.__oc.samples.push({ t: Math.round(performance.now() - t0), op: +(+c.opacity).toFixed(2), vis: c.visibility,
      disp: c.display, rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)],
      hit: e ? e.tagName + '.' + String(e.className || '').slice(0, 20) : null, owner: owner ? owner.id : null,
      collapsed: el.classList.contains('collapsed') });
    if (performance.now() - t0 > 4000) clearInterval(iv);
  }, 100);
}, 'global-context-panel');
await sleep(250);
const tClick = await click('global-context-panel');
await sleep(4200);
const oc = await page.evaluate(() => window.__oc);
const st = await page.evaluate(() => ({ g: document.getElementById('global-context-panel').className,
  c: document.getElementById('cctv-panel').className }));
const firstHittable = oc.samples.find((s) => s.owner === 'global-context-panel' || (s.hit && /panel-title|pp-header/.test(s.hit)));
console.log(JSON.stringify({ tClick, state: st, samples: oc.samples.slice(0, 24) }, null, 1));
fs.writeFileSync(path.join(OUT, 'occlude.json'), JSON.stringify({ tClick, state: st, samples: oc.samples }, null, 1));
await browser.close();
