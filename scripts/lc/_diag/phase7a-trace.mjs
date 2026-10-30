#!/usr/bin/env node
/* 一次性冷启动 trace：每 100ms 采 __gevCine.stage / 遮罩 / 关键 mark，打印时间线 */
import puppeteer from 'puppeteer';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:4173/?welcome=0';
const profile = mkdtempSync(join(tmpdir(), 'gev-trace-'));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: profile,
  args: [
    '--no-sandbox',
    '--window-size=1372,934',
    '--hide-scrollbars',
    '--ignore-gpu-blocklist',
    '--force_high_performance_gpu',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
  protocolTimeout: 300000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const cdp = await page.createCDPSession();
await cdp.send('Network.enable').catch(() => {});
await cdp.send('Network.clearBrowserCache').catch(() => {});
const t0 = Date.now();
await page.goto(`${BASE}&trace=1&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });

const rows = [];
for (let k = 0; k < 400; k++) {
  const st = await page
    .evaluate(() => {
      const g = window.__gevBoot;
      const el = document.getElementById('loading-screen');
      const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
      const tl = window.__bootTimeline && window.__bootTimeline.snapshot
        ? window.__bootTimeline.snapshot()
        : null;
      return {
        cine: window.__gevCine ? window.__gevCine.stage : null,
        done: window.__gevCine ? !!window.__gevCine.done : null,
        interactive: !!(g && g.interactive),
        op,
        marks: tl && tl.marks ? tl.marks.map((m) => m.name + '@' + m.t) : [],
        globeShow: window.__gevViewer?.scene?.globe?.show ?? null,
        photo: window.__gevPhotoreal || null,
      };
    })
    .catch(() => null);
  if (st) rows.push({ ms: Date.now() - t0, ...st, marks: undefined });
  const last = rows[rows.length - 1];
  if (last && last.interactive && last.photo && last.photo.ready) break;
  await new Promise((r) => setTimeout(r, 100));
}

const tl = await page
  .evaluate(() => {
    const t = window.__bootTimeline;
    const s = t && t.snapshot ? t.snapshot() : null;
    return s ? { marks: s.marks, frames: s.frames, worstFrame: s.worstFrame, total: s.total } : null;
  })
  .catch(() => null);

for (const r of rows) {
  console.log(
    `${r.ms}ms cine=${r.cine} done=${r.done} maskOp=${r.op} interactive=${r.interactive} globe=${r.globeShow} photo=${r.photo ? (r.photo.ready ? 'ready' : 'pending') : '-'}`,
  );
}
console.log('\n== TIMELINE MARKS (navStart ms) ==');
for (const m of (tl && tl.marks) || []) console.log(`  ${m.t}\t${m.name}`);
console.log('worstFrame', tl && tl.worstFrame, 'total', tl && tl.total);
await browser.close();
