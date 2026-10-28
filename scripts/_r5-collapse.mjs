#!/usr/bin/env node
/* _r5-collapse.mjs — reproduce "collapse all" after a rapid burst and log each click */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'], protocolTimeout: 600000 });
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {} window.__gevcDebug = true; });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (t.includes('[gev-lc]')) logs.push(t); });
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9500);
const state = () => page.evaluate(() => window.__gevLc.state());
const click = async (id) => {
  const p = await page.evaluate((id) => { const el = document.getElementById(id); const r = el.getBoundingClientRect();
    const q = [Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(14, r.height / 2))];
    const e = document.elementFromPoint(q[0], q[1]);
    return { ok: !!(e && el.contains(e)), at: q, owner: e && e.closest('.gev-lc') ? e.closest('.gev-lc').id : (e ? e.tagName + '.' + (e.className || '').toString().slice(0, 24) : null) }; }, id);
  if (!p.ok) return { id, ...p };
  await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up();
  return { id, ...p };
};
// 制造 3 张开：data / pp / control
await click('data-panel'); await sleep(1400);
await click('pp-toggles'); await sleep(1400);
await click('control-panel'); await sleep(2200);
let st = await state();
console.log('open:', JSON.stringify(Object.entries(st).filter(([, v]) => v.floating).map(([k]) => k)));
for (let round = 0; round < 4; round++) {
  const open = Object.entries(await state()).filter(([, v]) => v.floating).map(([k]) => k);
  if (!open.length) break;
  for (const id of open) {
    const c = await click(id);
    let waited = 0;
    for (let k = 0; k < 16; k++) { const s2 = await state(); if (!s2[id].floating) break; await sleep(140); waited += 140; }
    const s3 = await state();
    console.log('click', JSON.stringify(c), 'waited', waited, 'stillFloating', s3[id].floating, 'collapsed', s3[id].collapsed);
  }
  await sleep(500);
}
await sleep(1600);
st = await state();
console.log('final:', JSON.stringify(Object.entries(st).filter(([, v]) => v.floating).map(([k]) => k)));
console.log('collapsed:', JSON.stringify(Object.entries(st).map(([k, v]) => [k, v.collapsed])));
console.log('--- dbg tail');
console.log(logs.slice(-40).join('\n'));
await browser.close();
