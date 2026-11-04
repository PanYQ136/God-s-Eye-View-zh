#!/usr/bin/env node
/** qa-lg-globals.mjs —— 找出可用于移动 Cesium 相机的全局钩子 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto(process.argv[2] || 'http://localhost:5183/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 8000));
const out = await page.evaluate(() => {
  const keys = Object.keys(window).filter((k) => /gev|cesium|viewer|globe|camera|scene|eye/i.test(k));
  const res = {};
  keys.forEach((k) => { try { res[k] = typeof window[k] === 'object' && window[k] ? Object.keys(window[k]).slice(0, 12) : typeof window[k]; } catch (e) { res[k] = 'err'; } });
  const cs = document.querySelectorAll('canvas');
  const canv = [...cs].map((c) => ({ id: c.id, cls: (c.className || '').toString(), w: c.width, h: c.height }));
  return { keys: res, canv };
});
fs.writeFileSync('evidence/lg-glass-shots/p0/globals.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out).slice(0, 3000));
await browser.close();
