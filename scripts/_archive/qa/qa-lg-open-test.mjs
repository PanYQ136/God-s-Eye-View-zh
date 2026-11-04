#!/usr/bin/env node
/** qa-lg-open-test.mjs —— 查 __gevLc.open 是否真的生效 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('c:' + m.text()); });
await page.goto(process.argv[2] || 'http://localhost:5183/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 8000));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 1000));
const before = await page.evaluate(() => ({
  hasLc: !!window.__gevLc, keys: window.__gevLc ? Object.keys(window.__gevLc.store()) : null,
  info: window.__gevLc.info('data-panel'), cls: document.getElementById('data-panel').className,
}));
const openRes = await page.evaluate(() => {
  const r = window.__gevLc.open('data-panel');
  return { r, anim: window.__gevGlassAnim, cnt: window.__gevGlassAnimCount, info: window.__gevLc.info('data-panel'), cls: document.getElementById('data-panel').className, parent: document.getElementById('data-panel').parentElement.id || document.getElementById('data-panel').parentElement.className };
});
await new Promise((r) => setTimeout(r, 600));
const after = await page.evaluate(() => ({ info: window.__gevLc.info('data-panel'), cls: document.getElementById('data-panel').className, parent: document.getElementById('data-panel').parentElement.tagName + '#' + (document.getElementById('data-panel').parentElement.id || ''), style: { left: document.getElementById('data-panel').style.left, top: document.getElementById('data-panel').style.top, w: document.getElementById('data-panel').style.width, h: document.getElementById('data-panel').style.height } }));
await page.screenshot({ path: 'evidence/lg-glass-shots/p0/open-test.png' });
console.log(JSON.stringify({ errs, before, openRes, after }, null, 1));
await browser.close();
