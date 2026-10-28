#!/usr/bin/env node
/** _rev2-fps.mjs — FPS 口径固定：fresh load → 20s 预热 → 3×4s 窗口取中位 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('.gev-logs/rev2-accept');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860',
    '--autoplay-policy=no-user-gesture-required'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(20000);   // 预热：Cesium 瓦片 / shader 编译 / 卡片 init 全部落定
const win = () => page.evaluate(() => new Promise((r) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else r(+(n / ((performance.now() - t0) / 1000)).toFixed(1)); };
  requestAnimationFrame(tick);
}));
const mini = [await win(), await win(), await win()];
// 展开一张（pp）再量，验证「有卡展开」时也不掉到 30 以下
const c = await page.evaluate(() => {
  const e = document.getElementById('pp-toggles');
  const h = e.querySelector('.pp-header-row, .panel-header');
  const r = h.getBoundingClientRect();
  return { x: Math.round(r.x + r.width * 0.15), y: Math.round(r.y + r.height / 2) };
});
await page.mouse.move(c.x, c.y); await sleep(60); await page.mouse.down(); await sleep(45); await page.mouse.up();
await sleep(2500);
const opened = await page.evaluate(() => !document.getElementById('pp-toggles').classList.contains('collapsed'));
const withCard = [await win(), await win()];
const sortNum = (a) => [...a].sort((x, y) => x - y);
const med = (a) => { const s = sortNum(a); return s[Math.floor(s.length / 2)]; };
const res = { viewport: '1536x730', allMini: mini, allMiniMedian: med(mini), ppOpened: opened,
  withCardOpen: withCard, overallMedian: med([...mini, ...withCard]), samples: { mini, withCard } };
console.log(JSON.stringify(res));
fs.writeFileSync(path.join(OUT, 'fps.json'), JSON.stringify(res, null, 1));
await browser.close();
