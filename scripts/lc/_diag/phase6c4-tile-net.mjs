#!/usr/bin/env node
/* 诊断：Google 3D Tiles 瓦片请求时间线（只测量）
   node scripts/lc/_diag/phase6c4-tile-net.mjs [runs]  → 打印每跑：瓦片请求数、按完成时刻分箱、
   最深 LOD 链的最后一条、遮罩收起时刻。判据：若瓦片请求呈「串行阶梯」= RTT 受限（预取可救）。
*/
import puppeteer from 'puppeteer';

const RUNS = Number(process.argv[2] || 1);
const URL = process.env.C4_URL || 'http://127.0.0.1:4173/?welcome=0&nocap=1&t=';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: false,
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
});

for (let i = 0; i < RUNS; i++) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const reqs = new Map();
  page.on('request', (rq) => {
    if (/tile\.googleapis\.com/.test(rq.url())) reqs.set(rq.url(), { s: Date.now(), e: null, url: rq.url() });
  });
  page.on('requestfinished', (rq) => {
    const o = reqs.get(rq.url());
    if (o) o.e = Date.now();
  });
  page.on('requestfailed', (rq) => {
    const o = reqs.get(rq.url());
    if (o) o.e = -Date.now();
  });
  const t0 = Date.now();
  await page.goto(URL + Date.now(), { waitUntil: 'load' });
  // 等遮罩收起（opacity<0.05）或 30s
  let maskGoneAt = null;
  for (let k = 0; k < 300; k++) {
    const op = await page.evaluate(() => {
      const el = document.getElementById('loading-screen');
      return el ? parseFloat(getComputedStyle(el).opacity) : 0;
    });
    if (!(op >= 0.05)) { maskGoneAt = Date.now() - t0; break; }
    await sleep(100);
  }
  await sleep(1200);
  const list = [...reqs.values()].map((o) => ({
    s: o.s - t0,
    e: o.e == null ? null : Math.abs(o.e - t0),
    fail: o.e != null && o.e < 0,
    d: o.e == null ? null : Math.abs(o.e - t0) - (o.s - t0),
    j: o.url.split('/').slice(-2).join('/').slice(0, 40),
  })).sort((a, b) => (a.e ?? 9e9) - (b.e ?? 9e9));
  const dones = list.filter((x) => x.e != null);
  // 分箱：每 500ms 完成的请求数
  const bins = {};
  for (const x of dones) {
    const b = Math.floor(x.e / 500) * 0.5;
    bins[b] = (bins[b] || 0) + 1;
  }
  console.log(`\n=== run${i + 1} maskGone=${maskGoneAt}ms  瓦片请求 ${list.length}（完成 ${dones.length} / 失败 ${dones.filter(d=>d.fail).length}）`);
  console.log('  完成分箱(0.5s):', JSON.stringify(bins));
  const late = dones.filter((x) => x.e > (maskGoneAt || 0) - 3500);
  console.log('  遮罩收起前 3.5s 内完成的最后 8 条：');
  for (const x of late.slice(-8)) console.log(`   +${x.e}ms dur=${x.d} ${x.j}`);
  const durs = dones.map((x) => x.d).sort((a, b) => a - b);
  if (durs.length) console.log(`  单条耗时 p50=${durs[Math.floor(durs.length * 0.5)]} p90=${durs[Math.floor(durs.length * 0.9)]} max=${durs[durs.length - 1]}`);
  await ctx.close();
}
await browser.close();
