#!/usr/bin/env node
/** dbg-dock-toggle.mjs —— 点 dock 卡「标题条按钮」(#control-panel-toggle) 时，浮层是不是开了又立刻被 App 关掉 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--window-size=1536,820', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(() => { try { localStorage.removeItem('gev-liquid-cards:v2'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(8000);
await page.keyboard.press('Escape');
await sleep(2000);
const info = (tag) => page.evaluate((tag) => ({ tag, ...window.__gevLc.info('control-panel'), collapsed: document.getElementById('control-panel').classList.contains('collapsed') }), tag);
console.log(JSON.stringify(await info('before')));
const p = await page.evaluate(() => { const b = document.getElementById('control-panel-toggle').getBoundingClientRect(); return { x: Math.round(b.left + 20), y: Math.round(b.top + b.height / 2) }; });
await page.mouse.click(p.x, p.y);
await sleep(120);
console.log(JSON.stringify(await info('t+120ms')));
await sleep(700);
console.log(JSON.stringify(await info('t+820ms')));
await page.mouse.click(p.x, p.y);
await sleep(900);
console.log(JSON.stringify(await info('after 2nd click')));
await browser.close();
