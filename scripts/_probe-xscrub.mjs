#!/usr/bin/env node
/** _probe-xscrub.mjs — 验证运行时 ✕ 清零：注入 Cesium 版权关闭按钮，等轮询把字形换成「关闭」 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--hide-scrollbars'],
  protocolTimeout: 300000,
});
const p = await b.newPage();
await p.setViewport({ width: 1536, height: 730 });
await p.evaluateOnNewDocument(() => {
  try { localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); } catch (e) {}
});
await p.goto('http://127.0.0.1:4173/?welcome=0', { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(7000);

// 1) 注入两个 Cesium 风格的关闭按钮
const injected = await p.evaluate(() => {
  const wrap = document.createElement('div');
  wrap.id = 'x-probe-wrap';
  wrap.innerHTML = '<button class="cesium-credit-lightbox-close">×</button>';
  document.body.appendChild(wrap);
  return wrap.firstChild.textContent;
});
await sleep(3200);
const after = await p.evaluate(() => {
  const el = document.querySelector('#x-probe-wrap .cesium-credit-lightbox-close');
  const r = el.getBoundingClientRect();
  return { text: el.textContent, w: Math.round(r.width), h: Math.round(r.height), fs: getComputedStyle(el).fontSize, scrubbed: el.dataset.xScrubbed };
});

// 2) 全页 ✕ 清单（含隐藏）
const inv = await p.evaluate(() => {
  const hits = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const t = (n.nodeValue || '').trim();
    if (/^[×✕✖]$/.test(t)) {
      const el = n.parentElement, cs = getComputedStyle(el), r = el.getBoundingClientRect();
      hits.push({ cls: (el.className || '').toString().slice(0, 40), id: el.id, t, size: [Math.round(r.width), Math.round(r.height)], vis: cs.visibility });
    }
  }
  return hits;
});

console.log('injected:', JSON.stringify(injected));
console.log('after 3.2s:', JSON.stringify(after));
console.log('page ✕ inventory:', JSON.stringify(inv));
console.log((after.text === '关闭' || after.text.includes('关闭')) ? 'PASS scrub' : 'FAIL scrub');
await b.close();
