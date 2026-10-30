#!/usr/bin/env node
/* Phase6C4 · 瓦片预热/提前发起 A/B（同时刻交替跑，抵消网络漂移）
   ----------------------------------------------------------------------------
   同一份构建、同一台机、同一个 dev/prod server：
     OFF = `<url>&tilewarm=0`  → 关掉「main:entry 提前发 ion 端点 + 瓦片树预取」
     ON  = `<url>`             → 默认（两件事都开）
   每次都是全新 Chrome profile + Network.clearBrowserCache（真冷启动），
   交替 OFF/ON/OFF/ON…，因此网络环境漂移对两边是共同噪声。

   产出：.gev-logs/lc/prefetch/warm-ab-<tag>.json + 控制台成对表

   用法: node scripts/lc/_diag/phase6c4b-warm-ab.mjs [tag] [pairs] [url]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'ab';
const PAIRS = Number(process.argv[3] || 3);
const BASE = process.argv[4] || 'http://127.0.0.1:4173/?welcome=0';
const OUT = '.gev-logs/lc/prefetch';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STAGES = [
  'viewer:ready → tileset:fetch:begin',
  'tileset:fetch:begin → tileset:fetch:end',
  'tileset:added → gate:view:content',
  'gate:cine:done → gate:view:content',
  'gate:view:content → gate:view:settled',
  'main:entry → viewer:ready',
];

async function oneRun(mode, index) {
  const profile = mkdtempSync(join(tmpdir(), `gev-ab-${mode}-`));
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
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 160)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 160));
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable').catch(() => {});
  await cdp.send('Network.clearBrowserCache').catch(() => {});

  const url = mode === 'off' ? `${BASE}&tilewarm=0&ab=${index}` : `${BASE}&ab=${index}`;
  const wall0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  let wallReveal = null;
  for (let k = 0; k < 1600; k++) {
    const st = await page
      .evaluate(() => {
        const gate = window.__gevBoot;
        const el = document.getElementById('loading-screen');
        const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
        return { interactive: !!(gate && gate.interactive), op };
      })
      .catch(() => null);
    if (st && (st.interactive || (Number.isFinite(st.op) && st.op < 0.02))) {
      wallReveal = Date.now() - wall0;
      break;
    }
    await sleep(25);
  }
  const snap = await page.evaluate(() => {
    const tl = window.__bootTimeline ? window.__bootTimeline.snapshot() : null;
    const res = performance.getEntriesByType('resource').map((e) => ({
      path: (() => {
        try {
          return new URL(e.name).pathname.slice(0, 90);
        } catch (_) {
          return e.name.slice(0, 90);
        }
      })(),
      dur: +e.duration.toFixed(1),
      transferSize: e.transferSize,
      start: +e.startTime.toFixed(1),
    }));
    return {
      timeline: tl,
      warm: window.__gevTileWarm ? window.__gevTileWarm.stats() : null,
      gate: window.__gevBoot ? window.__gevBoot.snapshot() : null,
      gpu: window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null,
      tiles: res.filter((r) => /3dtiles/.test(r.path)),
    };
  });
  await browser.close();

  const stage = (from, to) => {
    const s = (snap.timeline?.stages || []).find((x) => x.from === from && x.to === to);
    return s ? s.ms : null;
  };
  const mark = (name) => {
    const c = (snap.timeline?.checkpoints || []).find((x) => x.name === name);
    return c ? c.t : null;
  };
  return {
    mode,
    index,
    wallRevealMs: wallReveal,
    total: snap.timeline?.total ?? null,
    coverageErrorPct: snap.timeline?.coverageErrorPct ?? null,
    gpu: snap.gpu?.renderer || null,
    checkpoints: {
      mainEntry: mark('main:entry'),
      viewerReady: mark('viewer:ready'),
      tilesetFetchBegin: mark('tileset:fetch:begin'),
      tilesetFetchEnd: mark('tileset:fetch:end'),
      tilesetAdded: mark('tileset:added'),
      cineDone: mark('gate:cine:done'),
      viewContent: mark('gate:view:content'),
      viewSettled: mark('gate:view:settled'),
      maskGone: mark('gate:mask:gone'),
    },
    stages: Object.fromEntries(
      STAGES.map((s) => {
        const [a, b] = s.split(' → ');
        return [s, stage(a, b)];
      }),
    ),
    probeAtReveal: snap.gate?.probeAtReveal || null,
    tiles: {
      requests: snap.tiles.length,
      fromCache: snap.tiles.filter((t) => t.transferSize === 0).length,
      durP50: (() => {
        const d = snap.tiles.map((t) => t.dur).sort((x, y) => x - y);
        return d.length ? d[Math.floor(d.length / 2)] : null;
      })(),
      durMax: snap.tiles.length ? Math.max(...snap.tiles.map((t) => t.dur)) : null,
    },
    warm: snap.warm,
    errors,
  };
}

const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(1);
};

const runs = [];
for (let i = 1; i <= PAIRS; i++) {
  for (const mode of ['off', 'on']) {
    const r = await oneRun(mode, i);
    runs.push(r);
    console.log(
      `pair${i} ${mode.padEnd(3)} total=${r.total} wall=${r.wallRevealMs} ` +
        `fetch=${r.stages['tileset:fetch:begin → tileset:fetch:end']} ` +
        `ladder=${r.stages['tileset:added → gate:view:content']} ` +
        `cacheHits=${r.tiles.fromCache}/${r.tiles.requests} ` +
        `probe=${r.probeAtReveal ? r.probeAtReveal.std + '/' + r.probeAtReveal.uniq : '-'}`,
    );
  }
}

const byMode = {};
for (const mode of ['off', 'on']) {
  const rs = runs.filter((r) => r.mode === mode);
  byMode[mode] = {
    n: rs.length,
    total: median(rs.map((r) => r.total)),
    fetch: median(rs.map((r) => r.stages['tileset:fetch:begin → tileset:fetch:end'])),
    ladder: median(rs.map((r) => r.stages['tileset:added → gate:view:content'])),
    ladderFromCine: median(rs.map((r) => r.stages['gate:cine:done → gate:view:content'])),
    mainToViewer: median(rs.map((r) => r.stages['main:entry → viewer:ready'])),
    cacheHits: median(rs.map((r) => r.tiles.fromCache)),
    tileRequests: median(rs.map((r) => r.tiles.requests)),
    durP50: median(rs.map((r) => r.tiles.durP50)),
    probeStd: median(rs.map((r) => r.probeAtReveal?.std)),
    probeUniq: median(rs.map((r) => r.probeAtReveal?.uniq)),
    errors: rs.flatMap((r) => r.errors).slice(0, 6),
  };
}

const pairs = [];
for (let i = 1; i <= PAIRS; i++) {
  const off = runs.find((r) => r.mode === 'off' && r.index === i);
  const on = runs.find((r) => r.mode === 'on' && r.index === i);
  if (!off || !on) continue;
  pairs.push({
    pair: i,
    totalDelta: +(on.total - off.total).toFixed(1),
    fetchDelta: +(
      on.stages['tileset:fetch:begin → tileset:fetch:end'] -
      off.stages['tileset:fetch:begin → tileset:fetch:end']
    ).toFixed(1),
    ladderDelta: +(
      on.stages['tileset:added → gate:view:content'] -
      off.stages['tileset:added → gate:view:content']
    ).toFixed(1),
    cacheHitsOff: off.tiles.fromCache,
    cacheHitsOn: on.tiles.fromCache,
  });
}

const file = join(OUT, `warm-ab-${TAG}.json`);
writeFileSync(file, JSON.stringify({ tag: TAG, url: BASE, pairs: PAIRS, runs, byMode, pairDeltas: pairs }, null, 1));

console.log('\n==== 成对差分（on − off，负数=on 更快）====');
for (const p of pairs)
  console.log(
    `pair${p.pair}: total ${p.totalDelta}ms  fetch ${p.fetchDelta}ms  ladder ${p.ladderDelta}ms  cacheHits ${p.cacheHitsOff}→${p.cacheHitsOn}`,
  );
console.log('\n==== 中位数 ====');
for (const mode of ['off', 'on']) {
  const b = byMode[mode];
  console.log(
    `${mode.padEnd(3)} n=${b.n} total=${b.total} fetch=${b.fetch} ladder=${b.ladder} ladderFromCine=${b.ladderFromCine} cacheHits=${b.cacheHits}/${b.tileRequests} p50=${b.durP50} probeStd=${b.probeStd} probeUniq=${b.probeUniq}`,
  );
}
console.log('\nerrors off:', byMode.off.errors);
console.log('errors on :', byMode.on.errors);
console.log('写出:', file);
