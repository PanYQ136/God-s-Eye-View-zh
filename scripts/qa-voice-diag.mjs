#!/usr/bin/env node
/** 诊断：找出撑大 #gev-voice-control scrollWidth 的具体子元素（前后状态对比） */
import puppeteer from 'puppeteer';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => document.getElementById('gev-voice-control'), { timeout: 180000 });
await new Promise((r) => setTimeout(r, 9000));
await page.keyboard.press('Escape');
await page.evaluate(() => {
  const w = document.querySelector('.welcome-modal, #welcome-modal');
  if (w) {
    const c = w.querySelector('input');
    if (c) c.click();
    const b = w.querySelector('button');
    if (b) b.click();
  }
});
await new Promise((r) => setTimeout(r, 1500));

const dump = () =>
  page.evaluate(() => {
    const card = document.getElementById('gev-voice-control');
    const cr = card.getBoundingClientRect();
    const contentRight = cr.left + parseFloat(getComputedStyle(card).paddingLeft) + card.clientWidth;
    const rows = [];
    for (const el of card.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      rows.push({
        t: el.tagName.toLowerCase(),
        id: el.id || '',
        cls: ((el.className.baseVal ?? el.className) || '') + '',
        d: s.display,
        v: s.visibility,
        pos: s.position,
        w: Math.round(r.width),
        right: Math.round(r.right - contentRight),
        left: Math.round(r.left - cr.left),
      });
    }
    rows.sort((a, b) => b.right - a.right);
    return {
      status: card.dataset.status,
      cls: card.className,
      sw: card.scrollWidth,
      cw: card.clientWidth,
      ox: getComputedStyle(card).overflowX,
      html: document.documentElement.style.fontSize || '(none)',
      rootFont: getComputedStyle(document.documentElement).fontSize,
      cardFont: getComputedStyle(card).fontSize,
      top: rows.filter((r) => r.right > 1 || r.w > card.clientWidth + 1).slice(0, 12),
    };
  });

console.log('--- as-loaded ---');
console.log(JSON.stringify(await dump(), null, 1));

await page.evaluate(() => {
  const card = document.getElementById('gev-voice-control');
  card.dataset.status = 'idle';
});
await new Promise((r) => setTimeout(r, 500));
console.log('--- data-status=idle ---');
console.log(JSON.stringify(await dump(), null, 1));
await browser.close();
