#!/usr/bin/env node
/* Phase8E 视觉取证（第二轮）：关掉首启引导后取 1x 全图 + 展开卡 1x/4x。
   真实 Chrome + RTX3060，非 headless；4x = 1x 裁剪 LANCZOS 放大（与 Phase8D 同口径）。
   用法：node scripts/lc/_8e-shot2.mjs <url> <outPrefix>                          */
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const URL = process.argv[2] || 'http://127.0.0.1:4175/';
const OUT = process.argv[3] || '.gev-logs/lc/phase8e/shot/8e2';
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
await sleep(6000);

/* 关首启引导：真实键盘 ESC（先点一下页面中部把焦点交给页面） */
await page.mouse.move(700, 300);
await page.mouse.down(); await sleep(40); await page.mouse.up();
await sleep(200);
await page.keyboard.press('Escape');
await sleep(1200);
const overlay = await page.evaluate(() => {
  const ids = ['#first-run', '#first-run-overlay', '.first-run', '#welcome'];
  const found = ids.map((s) => document.querySelector(s)).filter(Boolean);
  const visible = found.filter((el) => getComputedStyle(el).display !== 'none' && Number(getComputedStyle(el).opacity) > 0.05);
  return { found: found.length, visible: visible.length };
});
await sleep(3000);
await page.mouse.move(700, 420);
await sleep(500);
await page.screenshot({ path: `${OUT}-full-1x.png` });

const renderer = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl');
  const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a';
});
const phases = await page.evaluate(() => [...document.querySelectorAll('.gev-lc')].map((c) => c.dataset.lcPhase || null));

/* 真实鼠标点第一张可见卡的头部 → 展开 */
const target = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.gev-lc')];
  const withRect = cards.map((el) => ({ el, r: el.getBoundingClientRect() })).filter(({ r }) => r.width > 40 && r.height > 30);
  if (!withRect.length) return null;
  const { el, r } = withRect[0];
  return { id: el.id || null, x: r.x + r.width / 2, y: r.y + 18, w: r.width, h: r.height };
});
let clickResult = null;
if (target) {
  await page.mouse.move(target.x, target.y);
  await sleep(160);
  await page.mouse.down(); await sleep(40); await page.mouse.up();
  await sleep(1100);
  const after = await page.evaluate((id) => {
    const el = id ? document.getElementById(id) : [...document.querySelectorAll('.gev-lc')].find((c) => c.dataset.lcPhase !== 'mini');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { phase: el.dataset.lcPhase || null, x: r.x, y: r.y, w: r.width, h: r.height };
  }, target.id);
  clickResult = { target, after };
}

const box = clickResult?.after?.w > 80 ? clickResult.after : { x: 420, y: 60, w: 520, h: 480 };
const c = {
  x: Math.max(0, Math.round(box.x - 12)),
  y: Math.max(0, Math.round(box.y - 12)),
  width: Math.min(1348, Math.round(box.w + 24)),
  height: Math.min(774, Math.round(box.h + 24)),
};
await page.screenshot({ path: `${OUT}-card-1x.png`, clip: c });
await sharp(`${OUT}-card-1x.png`)
  .resize(c.width * 4, c.height * 4, { kernel: 'lanczos3' })
  .png({ compressionLevel: 9 })
  .toFile(`${OUT}-card-4x.png`);

/* 打开的数据层抽屉（左侧组），含 26 行开关 */
const rows = await page.evaluate(() => {
  const el = document.querySelector('#data-toggles') || document.querySelector('#data-panel');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, count: el.querySelectorAll('[data-layer-id], .pp-toggle-btn').length };
});
if (rows) {
  const rc = {
    x: Math.max(0, Math.round(rows.x - 8)),
    y: Math.max(0, Math.round(rows.y - 8)),
    width: Math.min(1348, Math.round(rows.w + 16)),
    height: Math.min(774, Math.round(rows.h + 16)),
  };
  await page.screenshot({ path: `${OUT}-rows-1x.png`, clip: rc });
  await sharp(`${OUT}-rows-1x.png`)
    .resize(rc.width * 4, rc.height * 4, { kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(`${OUT}-rows-4x.png`);
}

console.log(JSON.stringify({ url: URL, renderer, overlay, phases, clickResult, rows, errors: errors.slice(0, 4) }, null, 1));
await browser.close();
