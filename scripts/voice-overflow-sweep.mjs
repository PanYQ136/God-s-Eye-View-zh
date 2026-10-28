#!/usr/bin/env node
/**
 * voice-overflow-sweep.mjs —— 多档宽度下 #gev-voice-control 的 scrollWidth/clientWidth
 * 以及页面级横向溢出回归。
 */
import puppeteer from 'puppeteer';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage();
const widths = [1920, 1680, 1536, 1440, 1366, 1280, 1180, 1024, 900, 820, 768, 700, 600, 480, 375, 320];
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 14000));
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => {
  const b = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent);
  if (b) b.click();
});
await new Promise((r) => setTimeout(r, 2500));

const rows = [];
for (const w of widths) {
  await page.setViewport({ width: w, height: 730, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 700));
  const m = await page.evaluate(() => {
    const vc = document.getElementById('gev-voice-control');
    if (!vc) return { missing: true };
    const cost = document.querySelector('#gev-voice-control .gev-voice-cost');
    const tier = document.getElementById('gev-voice-tier');
    return {
      sw: vc.scrollWidth, cw: vc.clientWidth, ow: vc.offsetWidth,
      cardW: Math.round(vc.getBoundingClientRect().width),
      tier: tier ? Math.round(tier.getBoundingClientRect().width) : null,
      costSw: cost ? cost.scrollWidth : null,
      docSw: document.documentElement.scrollWidth, inner: window.innerWidth,
      bodySw: document.body.scrollWidth,
    };
  });
  rows.push({ w, ...m, pass: m.sw <= m.cw + 1, pageOverflow: m.docSw - m.inner });
}
console.log(JSON.stringify(rows, null, 0).replace(/},/g, '},\n'));
const bad = rows.filter((r) => !r.pass || r.pageOverflow > 1);
console.log('FAILS:', JSON.stringify(bad));
await browser.close();
