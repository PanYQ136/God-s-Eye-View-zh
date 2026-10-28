#!/usr/bin/env node
/** _r3-debug-click2.mjs — 复刻 matrix 的判定：点击后 950ms 读 stateAll 的 hidden/area */
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
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(8000);
await page.evaluate(() => {
  window.__a = (c) => { const s = String(c || ''); const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return /^rgb\(/.test(s) ? 1 : 0; const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number); return p.length > 3 ? p[3] : 1; };
});
const detail = (id) => page.evaluate((id) => {
  const e = document.getElementById(id);
  const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
  return { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], area: Math.round(r.width * r.height),
    opacity: c.opacity, visibility: c.visibility, display: c.display, transform: c.transform,
    cls: String(e.className), hiddenByRule: c.visibility === 'hidden' || c.display === 'none' || +c.opacity < .05 };
}, id);
const clickId = async (id) => {
  const p = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const SEL = '.panel-header, .pp-header-row, .dock-header, header, .panel-title, .pp-header-label, .location-toolbar-label';
    for (const h of el.querySelectorAll(SEL)) {
      const r = h.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5]]) {
        const x = Math.round(r.x + r.width * fx), y = Math.round(r.y + r.height * fy);
        const e = document.elementFromPoint(x, y);
        const hh = e && e.closest ? e.closest(SEL) : null;
        const owner = e && e.closest ? ((e.closest('.gev-lc') || {}).id || null) : null;
        if (hh && el.contains(hh) && owner === id) return { x, y };
      }
    }
    return null;
  }, id);
  if (!p) return null;
  await page.mouse.move(p.x, p.y); await sleep(50);
  await page.mouse.down(); await sleep(45); await page.mouse.up();
  return p;
};
console.log('base data', JSON.stringify(await detail('data-panel')));
const p = await clickId('data-panel');
console.log('clicked at', JSON.stringify(p));
for (const t of [200, 700, 950, 1200, 2000]) {
  await sleep(t === 200 ? 200 : 0);
  console.log('t' + t, JSON.stringify(await detail('data-panel')));
  await sleep(250);
}
console.log('--- now scene while data open ---');
const p2 = await clickId('scene-panel');
console.log('clicked scene at', JSON.stringify(p2));
for (let i = 0; i < 4; i++) { await sleep(400); console.log('data', JSON.stringify(await detail('data-panel')), 'scene', JSON.stringify(await detail('scene-panel'))); }
await browser.close();
