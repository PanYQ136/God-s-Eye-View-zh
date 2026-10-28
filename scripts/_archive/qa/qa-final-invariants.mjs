#!/usr/bin/env node
/** 终检：.gev-lc 数量、FAB 材质、§12 关键 computed、无 console error */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,820', '--hide-scrollbars'],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto(process.env.GEV_URL || 'http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 120000 });
await sleep(7000);
const out = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.gev-lc')];
  const fab = document.getElementById('gev-gfx-fab');
  const cs = (el) => (el ? getComputedStyle(el) : null);
  const info = cards.map((el) => ({
    id: el.id || el.className,
    bg: cs(el).backgroundColor,
    radius: cs(el).borderRadius,
    shape: cs(el).cornerShape || cs(el).getPropertyValue('corner-shape'),
    shadow: cs(el).boxShadow.slice(0, 80),
  }));
  const f = cs(fab);
  const warp = document.querySelector('#data-panel .gev-lg-warp');
  return {
    count: cards.length,
    cards: info,
    fab: f ? { bg: f.backgroundColor, radius: f.borderRadius, band: f.getPropertyValue('--lgm-band'), shape: f.getPropertyValue('corner-shape') } : null,
    warp: warp ? { bf: cs(warp).backdropFilter, mask: (cs(warp).maskImage || '').slice(0, 40), radius: cs(warp).borderRadius } : null,
    lensCanvas: !!document.getElementById('gev-edge-lens'),
    squircle: cs(document.getElementById('data-panel')).getPropertyValue('corner-shape'),
  };
});
console.log(JSON.stringify({ ...out, errors: errs.slice(0, 5), errorCount: errs.length }, null, 1));
await browser.close();
