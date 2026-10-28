#!/usr/bin/env node
/**
 * _diag-pp3.mjs — pp 展开卡布局/材质诊断（1536×730，真实鼠标点击）
 * 输出: .gev-logs/final/ppdiag/{report.json,card.png,full.png}
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('.gev-logs/final/ppdiag');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl',
    '--ignore-gpu-blocklist', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 900000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(6000);

// 关掉首次启动 Launcher（ESC）
await page.keyboard.press('Escape');
await sleep(600);

const settle = async () => {
  for (let i = 0; i < 60; i++) {
    const n = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
    if (!n) return true;
    await sleep(40);
  }
  return false;
};

const headerPt = async (sel) => {
  const box = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, r: [r.x, r.y, r.width, r.height] };
  }, sel);
  return box;
};

await settle();
const hdr = await headerPt('#pp-toggles .pp-header-row');
console.log('header', JSON.stringify(hdr));
await page.mouse.move(hdr.x, hdr.y);
await page.mouse.down();
await page.mouse.up();
await settle();
await sleep(700);

const dump = await page.evaluate(() => {
  const root = document.getElementById('pp-toggles');
  if (!root) return null;
  const cs = (el) => getComputedStyle(el);
  const rows = [];
  const walk = (el, depth) => {
    if (rows.length > 120) return;
    const r = el.getBoundingClientRect();
    const c = cs(el);
    rows.push({
      d: depth,
      tag: el.tagName,
      cls: (el.className && String(el.className).slice(0, 70)) || '',
      id: el.id || '',
      txt: (el.children.length === 0 ? (el.textContent || '') : '').trim().slice(0, 22),
      rect: [+r.x.toFixed(1), +r.y.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)],
      display: c.display,
      pos: c.position,
      flex: c.flex,
      minH: c.minHeight,
      h: c.height,
      of: c.overflow,
      bg: c.backgroundColor,
      bgi: (c.backgroundImage || '').slice(0, 60),
      color: c.color,
      blur: c.backdropFilter,
      pad: c.padding,
      gap: c.rowGap,
      z: c.zIndex,
      vis: c.visibility,
      op: c.opacity,
    });
    for (const ch of el.children) walk(ch, depth + 1);
  };
  walk(root, 0);
  const rr = root.getBoundingClientRect();
  const card = {
    rect: [rr.x, rr.y, rr.width, rr.height],
    scrollTop: root.scrollTop,
    scrollHeight: root.scrollHeight,
    clientHeight: root.clientHeight,
    overflowY: cs(root).overflowY,
    collapsed: root.classList.contains('collapsed'),
    floating: root.classList.contains('gev-lc-floating'),
    bg: cs(root).backgroundColor,
    blur: cs(root).backdropFilter,
  };
  // 兄弟重叠（可见子元素两两求交）
  const kids = [...root.querySelectorAll('*')].filter((el) => {
    const r = el.getBoundingClientRect();
    const c = cs(el);
    return r.width > 4 && r.height > 4 && c.visibility !== 'hidden' && +c.opacity > 0.05;
  });
  const ov = [];
  for (let i = 0; i < kids.length; i++) {
    for (let j = i + 1; j < kids.length; j++) {
      const a = kids[i], b = kids[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const ix = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const iy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ix > 2 && iy > 2) {
        ov.push({ a: a.className || a.tagName, b: b.className || b.tagName, ix: +ix.toFixed(1), iy: +iy.toFixed(1) });
      }
    }
  }
  return { card, rows, overlaps: ov.slice(0, 40), overlapCount: ov.length };
});

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...dump, consoleErrors: errs }, null, 1));
console.log('card', JSON.stringify(dump.card));
console.log('rows', dump.rows.length, 'overlaps', dump.overlapCount);
for (const r of dump.rows) {
  console.log(`${' '.repeat(r.d)}${r.tag}${r.id ? '#' + r.id : ''}.${r.cls} [${r.rect}] h=${r.h} minH=${r.minH} disp=${r.display} flex=${r.flex} of=${r.of} bg=${r.bg} bgi=${r.bgi ? 'yes' : ''} col=${r.color} ${r.txt}`);
}
console.log('OVERLAPS:');
for (const o of dump.overlaps) console.log('  ', JSON.stringify(o));

const cardEl = await page.$('#pp-toggles');
await cardEl.screenshot({ path: path.join(OUT, 'card.png') });
await page.screenshot({ path: path.join(OUT, 'full.png') });
// 2x 高清卡图
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await sleep(500);
await (await page.$('#pp-toggles')).screenshot({ path: path.join(OUT, 'card@2x.png') });
console.log('OUT', OUT);
await browser.close();
