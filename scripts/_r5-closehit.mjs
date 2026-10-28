#!/usr/bin/env node
/* _r5-closehit.mjs — 展开 data/control 后，看 header 点击点到底命中了什么，以及为什么 press 没被记录 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'], protocolTimeout: 600000 });
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
  window.__ev = [];
  ['pointerdown', 'pointerup'].forEach((t) => addEventListener(t, (e) => {
    const c = e.target.closest && e.target.closest('.gev-lc');
    window.__ev.push({ t, target: e.target.tagName + '.' + (e.target.className || '').toString().slice(0, 30), card: c && c.id, x: e.clientX, y: e.clientY, trusted: e.isTrusted });
  }, true));
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9500);
const click = async (id, dy = 14) => {
  const p = await page.evaluate((id, dy) => { const el = document.getElementById(id); const r = el.getBoundingClientRect();
    const q = [Math.round(r.x + r.width / 2), Math.round(r.y + dy)];
    const e = document.elementFromPoint(q[0], q[1]);
    return { ok: !!(e && el.contains(e)), at: q, hit: e ? e.tagName + '.' + (e.className || '').toString().slice(0, 40) : null }; }, id, dy);
  if (!p.ok) return { id, ...p };
  await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up();
  return { id, ...p };
};
console.log('open data', JSON.stringify(await click('data-panel')));
await sleep(1600);
console.log('open control', JSON.stringify(await click('control-panel')));
await sleep(2400);
const probe = await page.evaluate(() => {
  const out = {};
  ['data-panel', 'control-panel'].forEach((id) => {
    const el = document.getElementById(id);
    const r = el.getBoundingClientRect();
    const cands = [14, 22, 30, 40].map((dy) => {
      const q = [Math.round(r.x + r.width / 2), Math.round(r.y + dy)];
      const e = document.elementFromPoint(q[0], q[1]);
      return { dy, at: q, hit: e ? e.tagName + '.' + (e.className || '').toString().slice(0, 44) : null, inside: !!(e && el.contains(e)) };
    });
    out[id] = { rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)], cands,
      header: (() => { const h = el.querySelector('.panel-header,.dock-tray-toggle,.pp-header-row,.panel-title'); if (!h) return null; const hr = h.getBoundingClientRect(); return { cls: (h.className || '').toString().slice(0, 40), rect: [+hr.x.toFixed(1), +hr.y.toFixed(1), +hr.width.toFixed(1), +hr.height.toFixed(1)] }; })() };
  });
  return out;
});
console.log('probe', JSON.stringify(probe, null, 1));
// 真实点击 data header 的几个 y
for (const dy of [14, 22, 30, 40]) {
  const c = await click('data-panel', dy);
  await sleep(1500);
  const st = await page.evaluate(() => { const s = window.__gevLc.state(); return { data: s['data-panel'].floating, control: s['control-panel'].floating }; });
  console.log('click data dy=' + dy, JSON.stringify(c), '→ floating', JSON.stringify(st), 'ev', JSON.stringify(await page.evaluate(() => window.__ev.slice(-2))));
  if (!st.data) break;
}
await browser.close();
