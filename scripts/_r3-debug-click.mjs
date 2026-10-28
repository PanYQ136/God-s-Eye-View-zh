#!/usr/bin/env node
/** _r3-debug-click.mjs — 为什么 matrix 脚本里的 header 点击打不开卡？逐帧看 class/rect */
import puppeteer from 'puppeteer';
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
  window.__log = [];
  for (const t of ['pointerdown', 'pointerup', 'click']) {
    document.addEventListener(t, (e) => {
      window.__log.push({ t, target: e.target && e.target.tagName + '.' + String(e.target.className || '').slice(0, 30),
        owner: e.target && e.target.closest ? ((e.target.closest('.gev-lc') || {}).id || null) : null, trusted: e.isTrusted });
    }, true);
  }
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(8000);
const snap = (id) => page.evaluate((id) => {
  const e = document.getElementById(id);
  const r = e.getBoundingClientRect();
  return { cls: String(e.className), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], style: e.getAttribute('style') };
}, id);
const SEL = '.panel-header, .pp-header-row, .dock-header, header, .panel-title, .pp-header-label, .location-toolbar-label';
const cands = await page.evaluate((id, SEL) => {
  const el = document.getElementById(id);
  const out = [];
  for (const h of el.querySelectorAll(SEL)) {
    const r = h.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5]]) {
      const x = Math.round(r.x + r.width * fx), y = Math.round(r.y + r.height * fy);
      const e = document.elementFromPoint(x, y);
      const hh = e && e.closest ? e.closest(SEL) : null;
      const owner = e && e.closest ? ((e.closest('.gev-lc') || {}).id || null) : null;
      out.push({ x, y, hit: e ? e.tagName + '.' + String(e.className || '').slice(0, 26) : '', owner, onHeader: !!(hh && el.contains(hh)) });
    }
  }
  return out;
}, 'data-panel', SEL);
console.log('cands', JSON.stringify(cands));
const p = cands.find((c) => c.owner === 'data-panel' && c.onHeader) || cands[0];
console.log('BEFORE', JSON.stringify(await snap('data-panel')));
await page.mouse.move(p.x, p.y); await sleep(60);
await page.mouse.down(); await sleep(45); await page.mouse.up();
const trace = [];
for (const t of [60, 150, 300, 600, 1000, 1600]) {
  await new Promise((r) => setTimeout(r, t - (trace.length ? [60, 150, 300, 600, 1000, 1600][trace.length - 1] : 0)));
  trace.push({ t, ...(await snap('data-panel')) });
}
console.log('TRACE', JSON.stringify(trace));
console.log('EVENTS', JSON.stringify(await page.evaluate(() => window.__log)));
// 再点一次（此时应已展开），看是否会收起
await page.mouse.move(p.x, p.y); await sleep(60);
await page.mouse.down(); await sleep(45); await page.mouse.up(); await sleep(900);
console.log('AFTER2', JSON.stringify(await snap('data-panel')));
console.log('EVENTS2', JSON.stringify(await page.evaluate(() => window.__log)));
await browser.close();
