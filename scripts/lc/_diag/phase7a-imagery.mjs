#!/usr/bin/env node
/* Phase7A 诊断：底图瓦片「请求时刻 / 层级 / 耗时」与关键 mark 对齐
   用法: node scripts/lc/_diag/phase7a-imagery.mjs [base] [label] */
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://127.0.0.1:4174/?welcome=0';
const LABEL = process.argv[3] || 'img';
const OUT = '.gev-logs/lc/phase7a';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), 'gev-img-'));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  userDataDir: profile,
  args: [
    '--no-sandbox',
    '--window-size=1372,934',
    '--window-position=40,20',
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
await page.goto(`${BASE}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });
for (let k = 0; k < 2400; k++) {
  const st = await page
    .evaluate(() => {
      const g = window.__gevBoot;
      const el = document.getElementById('loading-screen');
      const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
      return { interactive: !!(g && g.interactive), op };
    })
    .catch(() => null);
  if (st && (st.interactive || (Number.isFinite(st.op) && st.op < 0.02))) break;
  await sleep(25);
}
await sleep(6000);
const data = await page.evaluate(() => {
  const tl = window.__bootTimeline && window.__bootTimeline.snapshot ? window.__bootTimeline.snapshot() : null;
  const res = performance.getEntriesByType('resource').map((e) => ({
    name: e.name,
    start: +e.startTime.toFixed(0),
    dur: +e.duration.toFixed(0),
    xfer: e.transferSize || 0,
    enc: e.encodedBodySize || 0,
    dec: e.decodedBodySize || 0,
    init: e.initiatorType,
  }));
  return { tl, res, baseTiles: globalThis.__gevBaseTiles ? globalThis.__gevBaseTiles.stats() : null, probe: window.__gevBoot?.snapshot ? window.__gevBoot.snapshot().viewProbeLog : null };
});
await browser.close();

const marks = (data.tl?.marks || []).map((m) => ({ n: m.name, t: +m.t.toFixed(0) }));
const byHost = {};
const tiles = [];
for (const r of data.res) {
  let host = 'other';
  try {
    host = new URL(r.name).host;
  } catch (_) {}
  byHost[host] = byHost[host] || { n: 0, bytes: 0, netN: 0, durSum: 0, first: 1e9, last: 0 };
  const h = byHost[host];
  h.n += 1;
  h.bytes += r.enc;
  if (r.xfer > 0) h.netN += 1;
  h.durSum += r.dur;
  h.first = Math.min(h.first, r.start);
  h.last = Math.max(h.last, r.start);
  if (/autonavi|arcgisonline|openstreetmap/.test(r.name)) {
    const m = /[?&]z=(\d+)/.exec(r.name) || /MapServer\/tile\/(\d+)\//.exec(r.name);
    tiles.push({
      host,
      z: m ? +m[1] : null,
      start: r.start,
      dur: r.dur,
      xfer: r.xfer,
      kb: +(r.enc / 1024).toFixed(1),
      x: (/([?&]x=)(\d+)/.exec(r.name) || [])[2],
      y: (/([?&]y=)(\d+)/.exec(r.name) || [])[2],
    });
  }
}
tiles.sort((a, b) => a.start - b.start);
const mk = Object.fromEntries(marks.map((m) => [m.n, m.t]));
console.log('MARK ' + marks.map((m) => m.n + '@' + m.t).join(' '));
if (data.baseTiles) {
  const b = data.baseTiles;
  console.log(
    `\nBASEWARM mode=${b.mode} req=${b.req} ok=${b.ok} kb=${b.kb} errors=${b.errors} firstTile=${b.firstTileMs} lastTile=${b.lastTileMs} center=${JSON.stringify(b.center)} provider=${b.provider}`,
  );
}
console.log('\nHOSTS');
for (const [h, v] of Object.entries(byHost)
  .sort((a, b) => b[1].n - a[1].n)
  .slice(0, 14))
  console.log(
    ` ${h} n=${v.n} net=${v.netN} kb=${(v.bytes / 1024).toFixed(0)} durSum=${v.durSum.toFixed(0)} first=${v.first.toFixed(0)} last=${v.last.toFixed(0)}`,
  );
console.log('\nIMAGERY TILES n=' + tiles.length);
for (const t of tiles)
  console.log(
    ` z${t.z} x=${t.x} y=${t.y} start=${t.start.toFixed(0)} dur=${t.dur.toFixed(0)} kb=${t.kb} ${t.xfer > 0 ? 'NET' : 'cache'}  (rel cine:done ${(t.start - (mk['gate:cine:done'] || mk['cine:done'] || 0)).toFixed(0)})`,
  );
console.log('\nPROBE LOG (last 12)');
for (const p of (data.probe || []).slice(-12))
  console.log(` @${p.atRel} std=${p.std} uniq=${p.uniq} ok=${p.ok}`);
writeFileSync(join(OUT, `${LABEL}-imagery.json`), JSON.stringify({ marks, tiles, byHost, probe: data.probe }, null, 1));
console.log('\nsaved ' + join(OUT, `${LABEL}-imagery.json`));
