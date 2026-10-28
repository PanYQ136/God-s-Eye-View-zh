#!/usr/bin/env node
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'], protocolTimeout: 600000 });
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9500);
const p = await page.evaluate(() => { const el = document.getElementById('pp-toggles'); const r = el.getBoundingClientRect(); const q = [Math.round(r.x + r.width / 2), Math.round(r.y + 14)]; const e = document.elementFromPoint(q[0], q[1]); return { ok: !!(e && el.contains(e)), at: q }; });
await page.mouse.move(p.at[0], p.at[1]); await page.mouse.down(); await page.mouse.up();
await sleep(2200);
const dump = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  const walk = (n, d) => {
    const s = getComputedStyle(n); const r = n.getBoundingClientRect();
    const line = { d, cls: (n.className || '').toString().slice(0, 44), id: n.id, tag: n.tagName, h: +r.height.toFixed(1), oy: s.overflowY, sh: n.scrollHeight, ch: n.clientHeight, kids: n.children.length };
    out.push(line);
    if (d < 3) [...n.children].forEach((c) => walk(c, d + 1));
  };
  const out = [];
  walk(el, 0);
  return out;
});
console.log(JSON.stringify(dump.filter((x) => x.h > 10).slice(0, 60), null, 1));
await browser.close();
