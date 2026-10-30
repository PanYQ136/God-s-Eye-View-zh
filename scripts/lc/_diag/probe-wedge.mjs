#!/usr/bin/env node
/* 探针 12：复现 T6→T7 的 wedge：pp→cctv 互斥 → ESC 全部收起 → 开位置面板。 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1560,890', '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling'],
  protocolTimeout: 300000,
  defaultViewport: { width: 1536, height: 730, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
try { await page.bringToFront(); } catch (e) {}
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 200; i++) { if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break; await sleep(400); }
await sleep(12000);
const click = async (sel) => {
  const p = await page.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + Math.min(14, b.height / 2)) }; }, sel);
  await page.mouse.move(p.x - 12, p.y - 8, { steps: 3 }); await sleep(30);
  await page.mouse.move(p.x, p.y, { steps: 3 }); await sleep(30);
  await page.mouse.down(); await sleep(25); await page.mouse.up();
  await sleep(1600);
};
const st = async (tag) => console.log(tag, JSON.stringify(await page.evaluate(() => {
  const ph = window.__lc.api.phases();
  const anims = {};
  for (const id of Object.keys(ph)) { const e = document.getElementById(id); anims[id] = e.getAnimations().map((a) => a.playState + ':' + Math.round(a.effect.getTiming().duration)); }
  return { ph, anims };
})));
await click('#pp-toggles .pp-header-row');
await st("A_pp_open");
await click('#cctv-panel .panel-header');
await st("B_cctv_open");
// ensureAllMini：对每个非 mini 卡 dispatch ESC
await page.evaluate(() => { const ph = window.__lc.api.phases(); for (const id in ph) if (ph[id] !== 'mini') window.__lc.api.dispatch({ type: 'ESC', id }); });
await sleep(1500);
await st("C_after_esc");
await click('#location-bar .dock-tray-toggle');
for (let i = 0; i < 6; i++) { await st("D" + i); await sleep(700); }
await browser.close();
