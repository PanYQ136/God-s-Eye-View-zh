#!/usr/bin/env node
/* Phase8C 冒烟：只要 1 个页面、3 条断言（boot / look 采样 / stats 字段），不跑全量矩阵 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__gevEdge, { timeout: 60000 }).catch(() => {});
await sleep(9000);
const out = await page.evaluate(() => {
  const e = window.__gevEdge;
  if (!e) return { err: 'no __gevEdge' };
  const s = e.stats();
  const el = document.querySelector('#data-panel');
  const cs = el ? getComputedStyle(el) : null;
  return {
    counts: { frames: s.frames, lookSamples: s.look.samples, lookSrc: s.look.src, fboStatus: s.look.fboStatus, fails: s.look.fails },
    renderer: s.renderer, a11y: s.a11y, cfg: s.cfg, eff: s.eff,
    lookPer: JSON.parse(JSON.stringify(s.look.per)),
    vars: cs ? { tintA: cs.getPropertyValue('--lc-tint-a'), tintRgb: cs.getPropertyValue('--lc-tint-rgb'), shadowRgb: cs.getPropertyValue('--lc-shadow-rgb'), fg: cs.getPropertyValue('--lc-fg-flip'), radiusInner: cs.getPropertyValue('--lc-radius-inner'), bgImage: cs.backgroundImage.slice(0, 200) } : null,
  };
});
console.log(JSON.stringify(out, null, 1).slice(0, 6000));
console.log('ERRORS:', errs.slice(0, 8));
await browser.close();
