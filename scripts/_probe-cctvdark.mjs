#!/usr/bin/env node
/** _probe-cctvdark.mjs — 查 cctv 展开态那块黑色区域到底是什么元素 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed');
  } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#pp-toggles', { timeout: 60000 });
for (let i = 0; i < 80; i++) {
  const loading = await page.evaluate(() => {
    const l = document.getElementById('loading-screen');
    return l ? getComputedStyle(l).display !== 'none' && +getComputedStyle(l).opacity > 0.05 : false;
  });
  if (!loading) break;
  await sleep(500);
}
await sleep(6000);

// 真实点击 cctv header
const box = await page.evaluate(() => {
  const el = document.querySelector('#cctv-panel .panel-header');
  const r = el.getBoundingClientRect();
  return { x: r.x + Math.min(26, r.width * 0.25), y: r.y + r.height / 2 };
});
await page.mouse.move(box.x, box.y);
await page.mouse.down();
await sleep(30);
await page.mouse.up();
await sleep(1500);

const info = await page.evaluate(() => {
  const root = document.getElementById('cctv-panel');
  const out = [];
  for (const el of root.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) continue;
    const bg = cs.backgroundColor;
    const m = bg.match(/rgba?\(([^)]+)\)/);
    const a = m ? (m[1].split(',').length > 3 ? parseFloat(m[1].split(',')[3]) : 1) : 0;
    const l = (bg.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
    const luma = (0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]) / 255;
    if (a > 0.15 || el.tagName === 'VIDEO' || el.tagName === 'CANVAS' || el.tagName === 'IMG') {
      out.push({
        tag: el.tagName, cls: String(el.className || '').slice(0, 50), id: el.id,
        bg, alpha: +a.toFixed(3), luma: +luma.toFixed(2),
        rect: [+r.x.toFixed(0), +r.y.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)],
        bgi: cs.backgroundImage.slice(0, 50), filter: cs.filter, bf: cs.backdropFilter,
        txt: (el.textContent || '').trim().slice(0, 30),
      });
    }
  }
  return { panel: document.getElementById('cctv-panel').className, nodes: out };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
