#!/usr/bin/env node
/* 诊断 dock 面板高度是否贴合内容（location / control / pp） */
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
const SEL = { 'location-bar': '#location-bar .dock-tray-toggle', 'control-panel': '#control-panel-toggle' };
for (const id of ['location-bar', 'control-panel']) {
  await page.evaluate((id) => window.__lc.api.dispatch({ type: 'ESC', id }), id);
  await sleep(700);
  const p = await page.evaluate((sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; }, SEL[id]);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.mouse.down(); await sleep(30); await page.mouse.up();
  await sleep(1200);
  const info = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const r = el.getBoundingClientRect();
    const kids = [...el.children].map((c) => {
      const b = c.getBoundingClientRect();
      const cs = getComputedStyle(c);
      return { cls: (c.className || c.tagName) + '', y: Math.round(b.y), h: Math.round(b.height), display: cs.display };
    });
    /* 最深叶子的内容底边 */
    let contentBottom = -Infinity, contentTop = Infinity, count = 0;
    el.querySelectorAll('*').forEach((n) => {
      const b = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      if (b.height < 1 || b.width < 1 || cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return;
      if (!n.textContent.trim() && !n.querySelector('*')) return;
      contentBottom = Math.max(contentBottom, b.bottom);
      contentTop = Math.min(contentTop, b.top);
      count++;
    });
    return {
      phase: window.__lc.api.phases()[id],
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      scrollH: Math.round(el.scrollHeight),
      clientH: Math.round(el.clientHeight),
      contentH: count ? Math.round(contentBottom - r.top) : null,
      emptyBottomPx: count ? Math.round(r.bottom - contentBottom) : null,
      kids,
    };
  }, id);
  info.chDbg = await page.evaluate(() => (window.__lc.chDbg || []).slice());
  console.log(id, JSON.stringify(info, null, 1));
}
await browser.close();
