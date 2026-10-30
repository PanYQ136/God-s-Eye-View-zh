#!/usr/bin/env node
/* 只读取证：打印 gate 的 viewProbeLog 轨迹（std/uniq/ok per 150ms）+ 关键 marks。
   用法: node scripts/lc/_diag/phase7a-probe-traj.mjs [url] */
import puppeteer from 'puppeteer';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL0 = process.argv[2] || 'http://127.0.0.1:4174/?welcome=0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), 'gev-p7at-'));
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
await page.goto(`${URL0}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
let snap = null;
for (let i = 0; i < 600; i++) {
  snap = await page.evaluate(() => (window.__gevBoot ? window.__gevBoot.snapshot() : null)).catch(() => null);
  if (snap && snap.state === 'interactive') break;
  await sleep(100);
}
await sleep(500);
snap = await page.evaluate(() => window.__gevBoot.snapshot()).catch(() => snap);
const tl = await page.evaluate(() => window.__bootTimeline?.snapshot?.() ?? null).catch(() => null);
const out = {
  releasedAt: snap?.inputReleasedAt,
  interactiveAt: snap?.interactiveAt,
  viewContentAt: snap?.viewContentAt,
  log: snap?.viewProbeLog,
  marks: (tl?.marks || []).map((m) => [m.name, Math.round(m.t)]).filter(([n]) => /gate:|mask:|chrome:|stack:|cine/.test(n)),
};
writeFileSync('.gev-logs/lc/phase7a/probe-traj.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify({ releasedAt: out.releasedAt, interactiveAt: out.interactiveAt, marks: out.marks.slice(0, 24) }, null, 1));
console.log('TRAJ', out.log.map((p) => `${p.atRel}:${p.std}/${p.uniq}${p.ok ? '*' : ''}`).join(' '));
await browser.close();
