#!/usr/bin/env node
/** _diag-pp5.mjs — pp 卡在棋盘底下的 2x 高清图 + 标签/行几何，判断「标签是否被裁切」 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('.gev-logs/final2/pp5');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(4000);
const settle = async () => { for (let i = 0; i < 90; i++) { const n = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length); if (!n) return; await sleep(35); } };
const pt = await page.evaluate(() => { const r = document.querySelector('#pp-toggles .pp-header-row').getBoundingClientRect(); return { x: r.x + 30, y: r.y + r.height / 2 }; });
await page.mouse.click(pt.x, pt.y);
await settle();
await sleep(600);
// 棋盘垫在卡下面
await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  const z = parseInt(getComputedStyle(el).zIndex, 10) || 100;
  const pat = document.createElement('div');
  pat.id = 'qa-checker';
  pat.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:' + (z - 1) + ';background-image:repeating-conic-gradient(#000 0% 25%,#fff 0% 50%);background-size:16px 16px;';
  document.body.appendChild(pat);
});
await sleep(300);
const geo = await page.evaluate(() => {
  const root = document.getElementById('pp-toggles');
  const rows = [...root.querySelectorAll('.pp-slider-row.visible, .pp-toggle-btn, .pp-mode-btn, .pp-slider-mini-label')].map((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      cls: String(el.className).slice(0, 40), id: el.id,
      rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      lh: cs.lineHeight, fs: cs.fontSize, of: cs.overflow, pos: cs.position, top: cs.top, margin: cs.margin, transform: cs.transform, clip: cs.clipPath,
      color: cs.color, ts: cs.textShadow.slice(0, 40),
    };
  });
  return { rows, card: root.getBoundingClientRect().toJSON() };
});
fs.writeFileSync(path.join(OUT, 'geo.json'), JSON.stringify(geo, null, 1));
await page.screenshot({ path: path.join(OUT, 'pp-checker.png'), clip: { x: 1180, y: 90, width: 310, height: 380 } });
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await sleep(700);
await page.screenshot({ path: path.join(OUT, 'pp-checker@2x.png'), clip: { x: 1180, y: 90, width: 310, height: 380 } });
for (const r of geo.rows.slice(0, 24)) console.log(r.id || r.cls, r.rect, 'fs=' + r.fs, 'lh=' + r.lh, 'of=' + r.of, 'pos=' + r.pos, 'clip=' + r.clip, r.color);
console.log('OUT', OUT);
await browser.close();
