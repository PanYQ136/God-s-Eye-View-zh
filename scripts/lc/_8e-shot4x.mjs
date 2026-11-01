#!/usr/bin/env node
/* Phase8E 视觉取证：1x 全图 + 目标区域 4x（LANCZOS 放大，与 Phase8D 同一口径）。
   真实 Chrome + RTX3060，非 headless。真 dsf=4 在本机 5392×3096 画布会让 Cesium
   大气 shader 编译失败（baseline 构建同样失败，属环境限制，见 Phase8E 报告）。
   用法：node scripts/lc/_8e-shot4x.mjs <url> <outPrefix>                          */
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const URL = process.argv[2] || 'http://127.0.0.1:4175/';
const OUT = process.argv[3] || '.gev-logs/lc/phase8e/shot/8e';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion',
  ],
  protocolTimeout: 900000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 120)); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!(window.__lc && window.__lc.api && window.__lc.api.mounted), { timeout: 90000 }).catch(() => {});
await page.waitForFunction(() => {
  const el = document.querySelector('#loading-screen');
  return !el || el.classList.contains('hidden') || getComputedStyle(el).display === 'none' || Number(getComputedStyle(el).opacity) < 0.05;
}, { timeout: 60000 }).catch(() => {});
await sleep(9000);
await page.mouse.move(700, 420);
await sleep(600);

const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a';
});

/* 全图 1x */
await page.screenshot({ path: `${OUT}-full-1x.png` });

/* 目标 1：最大的一张 .gev-lc 卡（玻璃壳） */
const card = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.gev-lc')];
  if (!cards.length) return null;
  const r = cards
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 120 && r.height > 60)
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
  if (!r) return null;
  return { x: r.r.x, y: r.r.y, w: r.r.width, h: r.r.height };
});
const clip = (b, pad = 10) => ({
  x: Math.max(0, Math.round(b.x - pad)),
  y: Math.max(0, Math.round(b.y - pad)),
  width: Math.min(1348 - Math.max(0, Math.round(b.x - pad)), Math.round(b.w + pad * 2)),
  height: Math.min(774 - Math.max(0, Math.round(b.y - pad)), Math.round(b.h + pad * 2)),
});

const shots = [];
if (card) {
  const c = clip(card);
  await page.screenshot({ path: `${OUT}-card-1x.png`, clip: c });
  await sharp(`${OUT}-card-1x.png`)
    .resize(c.width * 4, c.height * 4, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}-card-4x.png`);
  shots.push(`${OUT}-card-1x.png`, `${OUT}-card-4x.png`, c);
}

/* 目标 2：命令坞 / 数据层抽屉区域（含多层控件与文字） */
const dock = await page.evaluate(() => {
  const el = document.querySelector('#command-dock') || document.querySelector('#data-panel') || document.querySelector('#control-panel');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
if (dock) {
  const c = clip(dock, 8);
  await page.screenshot({ path: `${OUT}-dock-1x.png`, clip: c });
  await sharp(`${OUT}-dock-1x.png`)
    .resize(c.width * 4, c.height * 4, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}-dock-4x.png`);
  shots.push(`${OUT}-dock-1x.png`, `${OUT}-dock-4x.png`, c);
}

console.log(JSON.stringify({ url: URL, renderer, errors: errors.slice(0, 4), shots }, null, 1));
await browser.close();
