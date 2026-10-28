#!/usr/bin/env node
/** _probe-dock2.mjs —— 开 __gevcDebug，抓 location-bar 首次/二次展开的布局决策日志 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1560,860', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.removeItem('gev-liquid-cards:v2'); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {}
});
const logs = [];
page.on('console', (m) => { const t = m.text(); if (t.indexOf('[gev-lc]') === 0 || t.indexOf('[gev-lc] ') === 0) logs.push(t); });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(11000);
await page.evaluate(() => (window.__gevcDebug = true));

for (let run = 1; run <= 2; run++) {
  logs.length = 0;
  const nat0 = await page.evaluate(() => {
    const st = window.__gevLc.state();
    const o = {};
    for (const k of ['location-bar', 'control-panel', 'gev-voice-control']) o[k] = st[k] ? st[k].nat : null;
    return o;
  });
  const p = await page.evaluate(() => {
    const el = document.getElementById('location-bar');
    const h = el.querySelector('.location-toolbar');
    const r = h.getBoundingClientRect();
    return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.5) };
  });
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down();
  await page.mouse.up();
  await sleep(900);
  const info = await page.evaluate(() => window.__gevLc.info('location-bar'));
  console.log('=== RUN', run, 'nat=', JSON.stringify(nat0), 'info=', JSON.stringify(info));
  for (const l of logs) console.log('   ', l.slice(0, 400));
  await page.keyboard.press('Escape');
  await sleep(700);
}
await browser.close();
