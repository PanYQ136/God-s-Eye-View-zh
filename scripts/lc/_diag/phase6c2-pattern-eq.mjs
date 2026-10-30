#!/usr/bin/env node
/* Phase6C2 Round-2 回修验证：testBg pattern 平铺与旧「逐格 fillRect」实现是否逐格等价。
   期望值用旧实现的公式独立算（g = round(grid*scale)，light = 模式对应的奇偶），
   再与 probeTestBg 读回的真实像素比对（模式 0/1/2 × grid 2/8，各 120 个采样点）。 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--hide-scrollbars', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__gevEdge && window.__gevEdge.stats && window.__gevEdge.probeTestBg)).catch(() => false);
  if (ok) break; await sleep(400);
}
await sleep(1500);
const out = await page.evaluate(() => {
  const L = [238, 238, 238], D = [14, 14, 14];
  const res = {};
  for (const [name, mode] of [['checker', 0], ['hstripes', 1], ['vstripes', 2]]) {
    for (const grid of [2, 8]) {
      if (mode === 0) window.__gevEdge.testChecker(true, grid, 0);
      else window.__gevEdge.testStripes(mode === 1 ? 1 : 0, grid);
      const scale = window.__gevEdge.stats().scale;
      const g = Math.max(2, Math.round(grid * scale));
      let bad = 0, n = 0, sample = [];
      for (let i = 0; i < 120; i++) {
        const xc = 10 + ((i * 37) % 900) + 0.5, yc = 10 + ((i * 53) % 700) + 0.5;
        const dx = Math.round(xc * scale), dy = Math.round(yc * scale);
        const cx = Math.floor(dx / g), cy = Math.floor(dy / g);
        const light = mode === 1 ? (cy % 2 === 0) : mode === 2 ? (cx % 2 === 0) : ((cx + cy) % 2 === 0);
        const want = light ? L : D;
        const got = window.__gevEdge.probeTestBg(xc, yc);
        n++;
        if (!Array.isArray(got) || got.join() !== want.join()) { bad++; if (sample.length < 3) sample.push({ xc, yc, want, got }); }
      }
      res[name + '@' + grid + 'px'] = { mode, scale, g, samples: n, mismatch: bad, sample };
    }
  }
  return res;
});
await browser.close();
console.log(JSON.stringify(out, null, 1));
const bad = Object.entries(out).filter(([, v]) => v.mismatch > 0);
console.log(bad.length ? 'MISMATCH ' + JSON.stringify(bad) : 'ALL EQUIVALENT');
process.exit(bad.length ? 1 : 0);
