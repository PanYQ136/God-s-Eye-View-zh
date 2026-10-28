#!/usr/bin/env node
/* 探针：7 卡祖先链上是否有「为 fixed 定位创建包含块」的属性
   （transform / filter / backdrop-filter / will-change / contain:paint|layout|content / perspective）。 */
import puppeteer from 'puppeteer';
const W = 1536,
  H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--hide-scrollbars'],
  protocolTimeout: 600000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
  } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await sleep(12000);
const out = await page.evaluate(() => {
  const ids = ['data-panel', 'scene-panel', 'pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control'];
  const res = {};
  for (const id of ids) {
    const e = document.getElementById(id);
    const chain = [];
    let p = e ? e.parentElement : null;
    while (p && p !== document.documentElement) {
      const cs = getComputedStyle(p);
      const flags = [];
      if (cs.transform !== 'none') flags.push('transform=' + cs.transform);
      if (cs.filter !== 'none') flags.push('filter=' + cs.filter);
      if (cs.backdropFilter && cs.backdropFilter !== 'none') flags.push('backdrop=' + cs.backdropFilter);
      if (cs.willChange && cs.willChange !== 'auto') flags.push('will-change=' + cs.willChange);
      if (cs.contain && cs.contain !== 'none') flags.push('contain=' + cs.contain);
      if (cs.perspective && cs.perspective !== 'none') flags.push('perspective=' + cs.perspective);
      if (cs.containerType && cs.containerType !== 'normal') flags.push('container-type=' + cs.containerType);
      if (flags.length) chain.push((p.id || p.tagName) + ' :: ' + flags.join(' | '));
      p = p.parentElement;
    }
    res[id] = chain;
  }
  return res;
});
for (const id in out) console.log(id.padEnd(22), out[id].length ? '\n   ' + out[id].join('\n   ') : '(clean)');
await browser.close();
