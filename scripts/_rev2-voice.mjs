#!/usr/bin/env node
/** _rev2-voice.mjs — 定位 gev-voice-control 重载后 open=true 的来源（是持久化还是 init 顺序） */
import puppeteer from 'puppeteer';
const URL = 'http://127.0.0.1:4173/?welcome=0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
const snap = (tag) => page.evaluate((tag) => {
  const g = (id) => {
    const e = document.getElementById(id); if (!e) return { missing: true };
    const r = e.getBoundingClientRect();
    return { cls: e.className, collapsed: e.classList.contains('collapsed'),
      rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)] };
  };
  const ls = {};
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); ls[k] = String(localStorage.getItem(k)).slice(0, 60); } } catch (e) {}
  return { tag, voice: g('gev-voice-control'), dock: g('command-dock'), control: g('control-panel'), ls };
}, tag);

const load = async (label) => {
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pp-toggles', { timeout: 120000 });
  await sleep(7000);
  console.log(JSON.stringify(await snap(label)));
};

await load('first-load');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(7000);
console.log(JSON.stringify(await snap('reload-1')));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(7000);
console.log(JSON.stringify(await snap('reload-2')));

// 点一下 dock 里的 control-panel 再重载，看 voice 是否被带成 open
const c = await page.evaluate(() => {
  const e = document.getElementById('control-panel');
  const h = e.querySelector('.dock-header, .panel-header, .dock-title') || e;
  const r = h.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});
await page.mouse.move(c.x, c.y); await sleep(60); await page.mouse.down(); await sleep(45); await page.mouse.up();
await sleep(1500);
console.log(JSON.stringify(await snap('after-click-control')));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(7000);
console.log(JSON.stringify(await snap('reload-after-click')));
await browser.close();
