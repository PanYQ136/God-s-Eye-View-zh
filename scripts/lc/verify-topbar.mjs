#!/usr/bin/env node
/* scripts/lc/verify-topbar.mjs —— 死代码退役后的顶栏/网络/控制台复核
   跑法： node scripts/lc/verify-topbar.mjs
   断言：① #lg-glass-trigger / #lg-glass-menu 已不存在 ② 顶栏可见按钮几何合规
         ③ 无 /gev-lg-filter.js、/gev-lg-dispmap.jpg、/gev-gl-glass.js 请求
         ④ console error = 0（Cesium 0 宽噪声除外） */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const URL = process.env.LC_URL || 'http://127.0.0.1:4173/';
const OUT = '.gev-logs/lc/topbar';
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--window-size=1536,830', '--window-position=40,40', '--no-first-run'],
  defaultViewport: { width: 1536, height: 730 },
});
const page = await browser.newPage();
const reqs = [];
const errs = [];
page.on('request', (r) => reqs.push(r.url()));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
page.on('pageerror', (e) => errs.push(String(e && e.message)));

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 90000 });
await new Promise((r) => setTimeout(r, 6000));

const dom = await page.evaluate(() => {
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.01;
  };
  const nav = document.getElementById('top-center-actions');
  const kids = nav
    ? [...nav.querySelectorAll('button,a,[role="button"]')]
        .filter(vis)
        .map((b) => {
          const r = b.getBoundingClientRect();
          return {
            tag: b.tagName.toLowerCase(),
            id: b.id || null,
            cls: (b.className || '').toString().slice(0, 48),
            x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
            label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 24),
          };
        })
    : [];
  // 顶栏按钮互相重叠检测（右上角 HUD 一簇）
  const overlaps = [];
  for (let i = 0; i < kids.length; i++) {
    for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i], b = kids[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) overlaps.push([a.id || a.cls, b.id || b.cls]);
    }
  }
  return {
    trigger: !!document.getElementById('lg-glass-trigger'),
    menu: !!document.getElementById('lg-glass-menu'),
    svgFilter: !!document.getElementById('gev-lg-svg'),
    glGlassCanvas: !!document.getElementById('gev-gl-glass'),
    navExists: !!nav,
    navRect: nav ? (({ x, y, width, height }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) }))(nav.getBoundingClientRect()) : null,
    buttons: kids,
    overlaps,
  };
});

const deadReqs = reqs.filter((u) => /gev-lg-filter|gev-lg-dispmap|gev-gl-glass|lgGlass/.test(u));
const realErrs = errs.filter((e) => !/greater than 0/.test(e));

await page.screenshot({ path: `${OUT}/full.png` });
const navBox = await page.evaluate(() => {
  const n = document.getElementById('top-center-actions');
  if (!n) return null;
  const r = n.getBoundingClientRect();
  return { x: Math.max(0, r.x - 40), y: Math.max(0, r.y - 20), width: Math.min(1536, r.width + 80), height: Math.max(40, r.height + 40) };
});
if (navBox) await page.screenshot({ path: `${OUT}/topbar.png`, clip: navBox });
await page.screenshot({ path: `${OUT}/bottom-dock.png`, clip: { x: 380, y: 590, width: 780, height: 140 } });

const report = {
  deadElements: { trigger: dom.trigger, menu: dom.menu, svgFilter: dom.svgFilter, glGlassCanvas: dom.glGlassCanvas },
  deadRequests: deadReqs,
  navExists: dom.navExists,
  navRect: dom.navRect,
  buttons: dom.buttons,
  overlaps: dom.overlaps,
  consoleErrors: realErrs,
  rawConsoleErrorCount: errs.length,
};
console.log(JSON.stringify(report, null, 1));
const ok = !dom.trigger && !dom.menu && !dom.svgFilter && !dom.glGlassCanvas && deadReqs.length === 0 && realErrs.length === 0 && dom.overlaps.length === 0 && dom.buttons.length >= 3;
console.log(`\n=== ${ok ? 'PASS' : 'FAIL'} verify-topbar ===`);
await browser.close();
process.exit(ok ? 0 : 1);
