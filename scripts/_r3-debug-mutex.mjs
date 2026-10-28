#!/usr/bin/env node
/** _r3-debug-mutex.mjs — 复刻 matrix 的 switchCase 第一步，逐项打印诊断 */
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
  window.__ev = [];
  for (const t of ['pointerdown', 'pointerup', 'click']) {
    document.addEventListener(t, (e) => window.__ev.push({ t, target: e.target && e.target.tagName + '.' + String(e.target.className || '').slice(0, 34), trusted: e.isTrusted, at: Math.round(performance.now()) }), true);
  }
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
    cls: String(e.className).slice(-60), opacity: c.opacity, hidden: c.visibility === 'hidden' || c.display === 'none' || +c.opacity < .05 };
}, id);
const cands = (id) => page.evaluate((id) => {
  const el = document.getElementById(id);
  const SEL = '.panel-header, .pp-header-row, .dock-header, header, .panel-title, .pp-header-label, .location-toolbar-label';
  const out = [];
  for (const h of el.querySelectorAll(SEL)) {
    const r = h.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.5], [0.75, 0.5], [0.5, 0.25], [0.5, 0.75]]) {
      const x = Math.round(r.x + r.width * fx), y = Math.round(r.y + r.height * fy);
      const e = document.elementFromPoint(x, y);
      const hh = e && e.closest ? e.closest(SEL) : null;
      const owner = e && e.closest ? ((e.closest('.gev-lc') || {}).id || null) : null;
      if (hh && el.contains(hh) && owner === id) out.push({ x, y, hit: e.tagName + '.' + String(e.className || '').slice(0, 24) });
    }
  }
  return out;
}, id);

// 开 data
const c1 = await cands('data-panel');
console.log('data cands', JSON.stringify(c1.slice(0, 3)));
await page.mouse.move(c1[0].x, c1[0].y); await sleep(50); await page.mouse.down(); await sleep(45); await page.mouse.up();
await sleep(1200);
console.log('data after open', JSON.stringify(await detail('data-panel')));
console.log('events', JSON.stringify(await page.evaluate(() => window.__ev)));

// 挂 rAF + observer（复刻 switchCase）
await page.evaluate(() => {
  window.__tl = []; window.__stop = false;
  const tick = () => { if (window.__stop) return; const open = (ids) => ids.filter((i) => { const e = document.getElementById(i); if (!e) return false; const r = e.getBoundingClientRect(); return !e.classList.contains('collapsed') && r.width > 200; }).length; window.__tl.push(open(['data-panel', 'scene-panel'])); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
// 点 scene
const c2 = await cands('scene-panel');
console.log('scene cands', JSON.stringify(c2.slice(0, 3)));
await page.mouse.move(c2[0].x, c2[0].y); await sleep(50); await page.mouse.down(); await sleep(45); await page.mouse.up();
for (const t of [150, 400, 950, 1500]) {
  await sleep(t === 150 ? 150 : 250);
  console.log('t' + t, 'data', JSON.stringify(await detail('data-panel')), 'scene', JSON.stringify(await detail('scene-panel')));
}
console.log('events', JSON.stringify(await page.evaluate(() => window.__ev)));
console.log('tl max', JSON.stringify(await page.evaluate(() => { window.__stop = true; return { frames: window.__tl.length, max: Math.max(...window.__tl) }; })));
await browser.close();
