#!/usr/bin/env node
/**
 * _pp_probe.mjs —— pp 展开态结构探针：子项 rect/gap/滚动能力（真实鼠标点击 header）
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--hide-scrollbars', '--window-size=1536,730'],
  defaultViewport: { width: 1536, height: 730 },
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' });
await sleep(9000);
// 关掉首启欢迎层（真实鼠标点击「自由探索」）
const wk = await page.evaluate(() => {
  const el = [...document.querySelectorAll('button,div,a')].find((b) =>
    /自由探索/.test(b.textContent || ''),
  );
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
if (wk) {
  await page.mouse.click(wk.x, wk.y);
  await sleep(1200);
}
const hdr = await page.evaluate(() => {
  const h = document.querySelector('#pp-toggles .pp-header-row');
  const r = h.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, html: document.getElementById('pp-toggles').outerHTML.length };
});
await page.mouse.click(hdr.x, hdr.y);
await sleep(900);
const info = await page.evaluate(() => {
  const c = document.getElementById('pp-toggles');
  const b = c.getBoundingClientRect();
  const flat = [];
  const walk = (el, depth) => {
    for (const ch of el.children) {
      const r = ch.getBoundingClientRect();
      const s = getComputedStyle(ch);
      if (r.width < 4 || r.height < 4) continue;
      flat.push({
        depth,
        cls: (ch.className && String(ch.className)).slice(0, 44),
        tag: ch.tagName.toLowerCase(),
        rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        bg: s.backgroundColor,
        color: s.color,
        mb: s.marginBottom,
        gap: s.gap || s.rowGap,
        disp: s.display,
        of: s.overflow,
        sh: ch.scrollHeight,
        chh: ch.clientHeight,
      });
      if (depth < 2) walk(ch, depth + 1);
    }
  };
  walk(c, 0);
  return {
    card: { rect: [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)], sh: c.scrollHeight, ch: c.clientHeight, of: getComputedStyle(c).overflowY, floating: c.classList.contains('gev-lc-floating') },
    flat,
  };
});
console.log(JSON.stringify(info, null, 1));
fs.writeFileSync('.gev-logs/glass/pp-probe.json', JSON.stringify(info, null, 1));
await page.screenshot({ path: '.gev-logs/glass/pp-expanded.png' });
await browser.close();
