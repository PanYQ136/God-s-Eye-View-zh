#!/usr/bin/env node
/* qa-lg-radio-probe.mjs — 查 .context-radio-toggle 的 2px 溢出源 */
import puppeteer from 'puppeteer';
const URL = process.argv[2] || 'http://127.0.0.1:4173/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', args: ['--no-sandbox', '--window-size=1536,730'] });
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await sleep(9000);
const out = await page.evaluate(() => {
  const b = document.querySelector('.context-radio-toggle');
  if (!b) return { missing: true };
  const cs = getComputedStyle(b);
  const kids = [...b.children].map((k) => {
    const s = getComputedStyle(k);
    return { tag: k.tagName, cls: String(k.className).slice(0, 40), h: k.getBoundingClientRect().height, sh: k.scrollHeight, ch: k.clientHeight, lh: s.lineHeight, fs: s.fontSize, disp: s.display };
  });
  const r = b.getBoundingClientRect();
  return { rect: [r.width, r.height], sh: b.scrollHeight, ch: b.clientHeight, sw: b.scrollWidth, cw: b.clientWidth, pad: cs.padding, lh: cs.lineHeight, fs: cs.fontSize, ov: [cs.overflowX, cs.overflowY], kids };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
