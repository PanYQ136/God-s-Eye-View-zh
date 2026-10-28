#!/usr/bin/env node
/** 两个 dock 托盘（位置 / 视觉预设）展开可见性 + 折叠 scrollWidth 复核 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const url = process.argv[2] || 'http://127.0.0.1:4173/';
const SCR = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 13000));
await page.keyboard.press('Escape');
await page.evaluate(() => { const w = document.querySelector('.welcome-modal, #welcome-modal'); if (w) { const b = w.querySelector('button'); if (b) b.click(); } });
await new Promise((r) => setTimeout(r, 2000));

const res = {};
for (const id of ['location-bar', 'control-panel']) {
  const collapsed = await page.evaluate((id) => {
    const p = document.getElementById(id);
    const inner = p.querySelector('[class$="-inner"], .location-inner, .panel-inner');
    const tray = p.querySelector('.dock-popover-content');
    const tcs = getComputedStyle(tray);
    return { collapsed: p.classList.contains('collapsed'), sw: inner.scrollWidth, cw: inner.clientWidth, trayDisplay: tcs.display, trayBg: tcs.backgroundColor };
  }, id);
  await page.evaluate((id) => {
    const p = document.getElementById(id);
    p.querySelector('.dock-tray-toggle, button[aria-expanded]').dispatchEvent(new PointerEvent('click', { bubbles: true, detail: 1 }));
  }, id);
  await new Promise((r) => setTimeout(r, 900));
  const expanded = await page.evaluate((id) => {
    const p = document.getElementById(id);
    const tray = p.querySelector('.dock-popover-content');
    const r = tray.getBoundingClientRect();
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    const cs = getComputedStyle(tray);
    return {
      collapsed: p.classList.contains('collapsed'), display: cs.display, opacity: cs.opacity, bg: cs.backgroundColor,
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      inViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
      topAtCenter: top ? top.tagName : null, topInTray: !!top && tray.contains(top),
    };
  }, id);
  const clipW = Math.min(1536, expanded.rect[2] + 8), clipH = Math.min(730, expanded.rect[3] + 8);
  const buf = await page.screenshot({ clip: { x: Math.max(0, expanded.rect[0] - 4), y: Math.max(0, expanded.rect[1] - 4), width: Math.max(8, clipW), height: Math.max(8, clipH) } });
  fs.writeFileSync(`${SCR}/tray-${id}.png`, buf);
  await page.evaluate((id) => {
    const p = document.getElementById(id);
    p.querySelector('.dock-tray-toggle, button[aria-expanded]').dispatchEvent(new PointerEvent('click', { bubbles: true, detail: 1 }));
  }, id);
  await new Promise((r) => setTimeout(r, 800));
  const after = await page.evaluate((id) => {
    const p = document.getElementById(id);
    const inner = p.querySelector('[class$="-inner"], .location-inner, .panel-inner');
    const tcs = getComputedStyle(p.querySelector('.dock-popover-content'));
    return { collapsed: p.classList.contains('collapsed'), sw: inner.scrollWidth, cw: inner.clientWidth, trayDisplay: tcs.display };
  }, id);
  res[id] = { collapsed, expanded, afterClose: after };
}
console.log(JSON.stringify(res, null, 1));
await browser.close();
