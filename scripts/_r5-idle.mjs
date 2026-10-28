#!/usr/bin/env node
/* _r5-idle.mjs — idle 3s: count style mutations + console errors (归一不得在空闲时抖动) */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'], protocolTimeout: 600000 });
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {} });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text().slice(0, 160)); });
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(10000);
const idle = await page.evaluate(() => new Promise((res) => {
  let n = 0;
  const mo = new MutationObserver((ms) => { n += ms.filter((m) => m.attributeName === 'style').length; });
  mo.observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true });
  setTimeout(() => { mo.disconnect(); res(n); }, 3000);
}));
// 展开一张再空闲 3s（归一调度窗口 1.8s 已过）
await page.evaluate(() => { const el = document.getElementById('pp-toggles'); const r = el.getBoundingClientRect(); window.__p = [Math.round(r.x + r.width / 2), Math.round(r.y + 14)]; });
const p = await page.evaluate(() => window.__p);
await page.mouse.move(p[0], p[1]); await page.mouse.down(); await page.mouse.up();
await sleep(6000);
const idle2 = await page.evaluate(() => new Promise((res) => {
  let n = 0;
  const mo = new MutationObserver((ms) => { n += ms.filter((m) => m.attributeName === 'style').length; });
  mo.observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true });
  setTimeout(() => { mo.disconnect(); res(n); }, 3000);
}));
console.log('idle style mutations (all mini):', idle, '| after open (6s later):', idle2, '| errors:', JSON.stringify(errs.slice(0, 4)));
await browser.close();
