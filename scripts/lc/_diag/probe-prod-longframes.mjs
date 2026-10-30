#!/usr/bin/env node
/* prod 长帧归因（card t_374e47f6 定位用）：冷启动 → reveal 后 16s 采 rAF dt + LoAF 归因
   用法: node scripts/lc/_diag/probe-prod-longframes.mjs [base]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:4174/?welcome=0';
const OUT = '.gev-logs/lc/boot';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'gev-lf-'));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: profile,
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 300000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const cdp = await page.createCDPSession();
await cdp.send('Network.enable').catch(() => {});
await cdp.send('Network.clearBrowserCache').catch(() => {});
const wall0 = Date.now();
await page.goto(`${BASE}&lf=${Date.now()}`, { waitUntil: 'domcontentloaded' });
let reveal = null;
for (let k = 0; k < 2400; k++) {
  const st = await page.evaluate(() => {
    const g = window.__gevBoot;
    const el = document.getElementById('loading-screen');
    return { i: !!(g && g.interactive), op: el ? parseFloat(getComputedStyle(el).opacity) : 0 };
  }).catch(() => null);
  if (st && (st.i || st.op < 0.02)) { reveal = Date.now() - wall0; break; }
  await sleep(25);
}
await page.evaluate(() => {
  const frames = [], loaf = [], t0 = performance.now();
  window.__lf = { frames, loaf, t0, done: false };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        loaf.push({
          start: +(e.startTime - (performance.timeOrigin + 0)).toFixed(0),
          dur: +e.duration.toFixed(1),
          blocking: +e.blockingDuration.toFixed(1),
          styleLayout: +e.styleAndLayoutStart ? 1 : 0,
          scripts: (e.scripts || []).slice(0, 3).map((s) => ({
            inv: s.invoker, type: s.invokerType, dur: +s.duration.toFixed(1), src: (s.sourceURL || '').slice(-70), fn: (s.sourceFunctionName || '').slice(0, 40),
          })),
        });
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch (e) { window.__lf.loafErr = String(e); }
  const tick = (ts) => {
    frames.push({ t: +(ts - t0).toFixed(1) });
    if (ts - t0 < 16000) requestAnimationFrame(tick); else window.__lf.done = true;
  };
  requestAnimationFrame(tick);
});
for (let k = 0; k < 200; k++) {
  if (await page.evaluate(() => !!(window.__lf && window.__lf.done)).catch(() => false)) break;
  await sleep(200);
}
const res = await page.evaluate(() => {
  const a = window.__lf, f = a.frames, d = [];
  for (let i = 1; i < f.length; i++) d.push({ t: f[i].t, dt: +(f[i].t - f[i - 1].t).toFixed(1) });
  const long = d.filter((x) => x.dt >= 90);
  return { loafErr: a.loafErr || null, frames: d.length, spanMs: d.length ? d[d.length - 1].t : 0, long, loaf: a.loaf };
});
const lines = [
  `base=${BASE} reveal=${reveal}ms frames=${res.frames} span=${res.spanMs} loafErr=${res.loafErr}`,
  `rAF>90ms: ${JSON.stringify(res.long)}`,
  ...res.loaf.map((l) => `LoAF dur=${l.dur} blocking=${l.blocking} scripts=${JSON.stringify(l.scripts)}`),
];
console.log(lines.join('\n'));
writeFileSync(join(OUT, `probe-prod-longframes.json`), JSON.stringify({ reveal, ...res }, null, 1));
await browser.close();
