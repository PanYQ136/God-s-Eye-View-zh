#!/usr/bin/env node
/** dbg2.mjs —— 打印 placeExpanded / obstacles / hiddenSibs */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const id = process.argv[2] || 'control-panel';
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--window-size=1536,820'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(1000);
const pre = await page.evaluate((id) => ({
  placeNoSkip: window.__gevLc._place(id, []),
  placeSkip: window.__gevLc._place(id, ['location-bar', 'gev-voice-control', 'pp-toggles', 'cctv-panel', 'global-context-panel']),
  obs: window.__gevLc._obs(id, []),
}), id);
await page.evaluate((id) => window.__gevLc.open(id), id);
await sleep(900);
const post = await page.evaluate((id) => ({
  info: window.__gevLc.info(id),
  placeNow: window.__gevLc._place(id, []),
  sibs: window.__gevLc._sibs(id),
  style: { left: document.getElementById(id).style.left, top: document.getElementById(id).style.top, w: document.getElementById(id).style.width, h: document.getElementById(id).style.height },
}), id);
console.log(JSON.stringify({ pre, post }, null, 1));
await browser.close();
