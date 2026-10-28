#!/usr/bin/env node
/* 精确排查：open 态下把 height 设成 auto 后，computed height / offsetHeight / scrollHeight 各是多少，
   以及是谁在撑高（含伪元素与最深叶子） */
import puppeteer from 'puppeteer';
const URL = 'http://127.0.0.1:4173/';
const W = 1536, H = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows'],
  protocolTimeout: 300000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {} });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 120; i++) {
  if (await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false)) break;
  await sleep(400);
}
await sleep(8000);
const p = await page.evaluate(() => { const b = document.querySelector('#location-bar .dock-tray-toggle').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; });
await page.mouse.move(p.x, p.y, { steps: 3 });
await page.mouse.down(); await sleep(30); await page.mouse.up();
await sleep(1400);

const out = await page.evaluate(() => {
  const el = document.getElementById('location-bar');
  const before = { inlineH: el.style.height, compH: getComputedStyle(el).height, offH: el.offsetHeight, sh: el.scrollHeight };
  el.style.height = 'auto';
  const after = { inlineH: el.style.height, compH: getComputedStyle(el).height, offH: el.offsetHeight, sh: el.scrollHeight };
  /* 谁最高：遍历全部后代 + 伪元素 */
  const items = [];
  el.querySelectorAll('*').forEach((n) => {
    const b = n.getBoundingClientRect();
    const cs = getComputedStyle(n);
    if (b.height >= 30) items.push({ cls: (n.className || n.tagName) + '', h: Math.round(b.height), y: Math.round(b.y), pos: cs.position, disp: cs.display, minH: cs.minHeight, maxH: cs.maxHeight, flex: cs.flex });
  });
  const pe = getComputedStyle(el, '::before');
  const ae = getComputedStyle(el, '::after');
  const pseudo = { before: { h: pe.height, content: pe.content, pos: pe.position, disp: pe.display }, after: { h: ae.height, content: ae.content, pos: ae.position, disp: ae.display } };
  el.style.height = before.inlineH;
  return { before, after, items, pseudo, cls: el.className, phase: el.dataset.lcPhase };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
