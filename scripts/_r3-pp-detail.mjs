#!/usr/bin/env node
/** _r3-pp-detail.mjs — pp 展开态：逐行间距明细 + 文本级重叠检查 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
const OUT = path.resolve('.gev-logs/r3-t829');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--hide-scrollbars', '--window-size=1560,860'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730 });
await page.evaluateOnNewDocument(() => { try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); sessionStorage.setItem('gev:first-run-mission-session:v1', 'dismissed'); } catch (e) {} });
await page.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#pp-toggles', { timeout: 120000 });
await sleep(7500);
// 真实点开 pp
const p = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  const h = el.querySelector('.pp-header-row');
  const r = h.getBoundingClientRect();
  const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
  const e = document.elementFromPoint(x, y);
  return { x, y, owner: e && e.closest ? ((e.closest('.gev-lc') || {}).id || null) : null };
});
await page.mouse.move(p.x, p.y); await sleep(60); await page.mouse.down(); await sleep(45); await page.mouse.up(); await sleep(1500);
const info = await page.evaluate(() => {
  const el = document.getElementById('pp-toggles');
  const r = el.getBoundingClientRect();
  const rows = [...el.querySelectorAll('.pp-toggle-btn, .pp-slider-row, .pp-toggle-group, .pp-mode-btn, .pp-select, .pp-header-row')]
    .map((e) => { const b = e.getBoundingClientRect(); return { tag: e.tagName, cls: String(e.className).slice(0, 34), parent: (e.parentElement.className || e.parentElement.id || '').slice(0, 24), top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), left: +b.left.toFixed(1), right: +b.right.toFixed(1) }; })
    .filter((x) => x.bottom - x.top > 3);
  const groups = new Map();
  for (const row of rows) { const k = row.parent; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(row); }
  const detail = [];
  for (const [k, list] of groups) {
    list.sort((a, b) => a.top - b.top);
    for (let i = 1; i < list.length; i++) detail.push({ parent: k, from: list[i - 1].cls, to: list[i].cls, gap: +(list[i].top - list[i - 1].bottom).toFixed(1) });
  }
  // 文本级：把可见文本节点的 rect 两两比，看是否有跨行压字
  const texts = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const b = range.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) continue;
    texts.push({ t: n.nodeValue.trim().slice(0, 18), top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), left: +b.left.toFixed(1), right: +b.right.toFixed(1) });
  }
  const tOver = [];
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const A = texts[i], B = texts[j];
    const ix = Math.min(A.right, B.right) - Math.max(A.left, B.left);
    const iy = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
    if (ix > 2 && iy > 2) tOver.push({ a: A.t, b: B.t, ix: +ix.toFixed(0), iy: +iy.toFixed(0) });
  }
  return { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    clientHeight: el.clientHeight, scrollHeight: el.scrollHeight, rows: rows.length,
    gaps: detail.filter((d) => d.gap > -1), negativeGaps: detail.filter((d) => d.gap <= -1),
    minGap: Math.min(...detail.filter((d) => d.gap > -1).map((d) => d.gap)),
    textCount: texts.length, textOverlaps: tOver.slice(0, 8) };
});
console.log(JSON.stringify(info, null, 1));
fs.writeFileSync(path.join(OUT, 'pp-detail.json'), JSON.stringify(info, null, 2));
await page.screenshot({ path: path.join(OUT, 'G3-pp-expanded-top.png') });
await browser.close();
