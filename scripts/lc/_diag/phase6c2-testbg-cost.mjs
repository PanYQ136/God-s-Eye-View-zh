#!/usr/bin/env node
/* Phase6C2 Round-2 #1 归因证据：验收底衬 paintTestBg 的两种实现的单次成本。
   「逐格 fillRect」（v4 的实现）vs「2×2 pattern 平铺」（Round-2 的实现）。
   两者像素等价（见 phase6c2-pattern-eq.mjs：720 采样 0 mismatch），这里只比时间。
   用法: node scripts/lc/_diag/phase6c2-testbg-cost.mjs  → 结果写进 .gev-logs/lc/phase6c2/testbg-cost.json */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
});
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');
const out = await page.evaluate(() => {
  const W = 1348, H = 774, reps = 3;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', { alpha: false });
  const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const perCell = (g, mode) => { const t = performance.now(); for (let y = 0; y < H; y += g) for (let x = 0; x < W; x += g) { const l = mode === 1 ? ((y / g | 0) % 2 === 0) : mode === 2 ? ((x / g | 0) % 2 === 0) : (((x / g | 0) + (y / g | 0)) % 2 === 0); cx.fillStyle = l ? '#eeeeee' : '#0e0e0e'; cx.fillRect(x, y, g, g); } return +(performance.now() - t).toFixed(1); };
  const tiled = (g, mode) => {
    const t = performance.now();
    const c = document.createElement('canvas'); c.width = g * 2; c.height = g * 2;
    const tx = c.getContext('2d');
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { const l = mode === 1 ? (y % 2 === 0) : mode === 2 ? (x % 2 === 0) : ((x + y) % 2 === 0); tx.fillStyle = l ? '#eeeeee' : '#0e0e0e'; tx.fillRect(x * g, y * g, g, g); }
    const pat = cx.createPattern(c, 'repeat'); cx.fillStyle = pat; cx.fillRect(0, 0, W, H);
    return +(performance.now() - t).toFixed(1);
  };
  const res = {};
  for (const [name, mode] of [['checker', 0], ['hstripes', 1], ['vstripes', 2]]) {
    for (const g of [2, 8]) {
      const a = [], b = [];
      for (let i = 0; i < reps; i++) { a.push(perCell(g, mode)); b.push(tiled(g, mode)); }
      res[name + '@' + g + 'px'] = { perCell_ms: a, perCell_median: med(a), pattern_ms: b, pattern_median: med(b) };
    }
  }
  return { canvas: [W, H], note: '单次 repaint 成本（2d canvas，同机同页）', res };
});
await browser.close();
writeFileSync('.gev-logs/lc/phase6c2/testbg-cost.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
