#!/usr/bin/env node
/* 冷启动分阶段耗时基线 —— 真 Chrome + RTX 3060，每次全新 profile（空 HTTP 缓存）
   ----------------------------------------------------------------------------
   测什么：navigationStart → 遮罩真正消失（gate 的 gate:mask:gone，opacity<0.05）
   怎么测：页面内 performance.now() 标记（src/boot-timeline.js，锚点
           navigationStart）+ 浏览器自报 Navigation/Paint Timing 交叉校验；
           外部再用 harness 墙钟轮询一次，作为「独立总时长」。
   产物：.gev-logs/lc/boot/baseline-<tag>.json + 控制台中位数表 + 截图

   用法:
     node scripts/lc/boot-timeline-coldstart.mjs [tag] [runs] [url]
     例: node scripts/lc/boot-timeline-coldstart.mjs dev 6 http://127.0.0.1:4173/?welcome=0
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'dev';
const RUNS = Number(process.argv[3] || 6);
const BASE = process.argv[4] || 'http://127.0.0.1:4173/?welcome=0';
const OUT = '.gev-logs/lc/boot';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : +((s[mid - 1] + s[mid]) / 2).toFixed(1);
};
const pct = (xs, q) => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

const runs = [];

for (let i = 1; i <= RUNS; i++) {
  const profile = mkdtempSync(join(tmpdir(), `gev-cold-${TAG}-`));
  const browser = await puppeteer.launch({
    headless: false,
    executablePath:
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
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
  page.on('pageerror', (e) =>
    errors.push('pageerror: ' + String(e.message).slice(0, 200)),
  );
  page.on('console', (m) => {
    if (m.type() === 'error')
      errors.push('console.error: ' + m.text().slice(0, 200));
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable').catch(() => {});
  await cdp.send('Network.clearBrowserCache').catch(() => {});
  await cdp
    .send('Network.setCacheDisabled', { cacheDisabled: false })
    .catch(() => {});

  const wall0 = Date.now();
  await page.goto(`${BASE}&run=${i}&t=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
  });

  /* 等到遮罩真的没了（gate 的 interactive 或 opacity≈0），25ms 轮询 */
  let wallReveal = null;
  for (let k = 0; k < 1200; k++) {
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

  const snap = await page
    .evaluate(() => {
      const tl = window.__bootTimeline;
      const gate = window.__gevBoot;
      return {
        timeline:
          tl && typeof tl.snapshot === 'function' ? tl.snapshot() : null,
        gate:
          gate && typeof gate.snapshot === 'function' ? gate.snapshot() : null,
        gpu:
          window.__gevGpu && window.__gevGpu.probe
            ? window.__gevGpu.probe()
            : null,
        /* 全量资源清单：用于归因「阶段里到底在等哪个请求」 */
        resources: performance.getEntriesByType('resource').map((e) => ({
          name: e.name
            .replace(/^https?:\/\/[^/]+/, '')
            .split('?')[0]
            .slice(0, 110),
          start: +e.startTime.toFixed(1),
          end: +e.responseEnd.toFixed(1),
          dur: +e.duration.toFixed(1),
          type: e.initiatorType,
          bytes: e.transferSize || 0,
        })),
        navTiming: (() => {
          const n = performance.getEntriesByType('navigation')[0] || null;
          if (!n) return null;
          return {
            responseStart: +n.responseStart.toFixed(1),
            domInteractive: +n.domInteractive.toFixed(1),
            dcl: +n.domContentLoadedEventEnd.toFixed(1),
            load: +n.loadEventEnd.toFixed(1),
            transferSize: n.transferSize,
          };
        })(),
        timeOrigin: performance.timeOrigin,
      };
    })
    .catch((e) => ({ error: String(e.message || e) }));

  /* 证据截图（真截图，不裁剪，给人看） */
  const shot = join(OUT, `baseline-${TAG}-run${i}.png`);
  await page.screenshot({ path: shot }).catch(() => {});

  const row = {
    run: i,
    wallRevealMs: wallReveal,
    timeOrigin: snap.timeOrigin,
    navTiming: snap.navTiming,
    gpu: snap.gpu,
    errors,
    timeline: snap.timeline,
    resources: snap.resources || [],
    probeLog: snap.gate?.viewProbeLog || [],
    gateState: snap.gate
      ? {
          state: snap.gate.state,
          reason: snap.gate.reason,
          maskOpacity: snap.gate.maskOpacity,
          probeAtReveal: snap.gate.probeAtReveal,
          viewProbe: snap.gate.viewProbe,
          longFrames: snap.gate.longFrames,
        }
      : null,
    screenshot: shot,
  };
  runs.push(row);
  const tl = row.timeline;
  console.log(
    `run${i}: total=${tl ? tl.total : '?'}ms sum=${tl ? tl.sum : '?'} cov.err=${tl ? tl.coverageErrorPct : '?'}% ` +
      `wall=${wallReveal}ms reason=${row.gateState && row.gateState.reason} ` +
      `gpu=${row.gpu && /RTX 3060/.test(row.gpu.renderer || '') ? 'RTX3060' : row.gpu && row.gpu.renderer}`,
  );
  await browser.close();
}

/* ── 聚合 ─────────────────────────────────────────────────────────────── */
const totals = runs.map((r) => r.timeline?.total).filter(Number.isFinite);
const sums = runs.map((r) => r.timeline?.sum).filter(Number.isFinite);
const covErrs = runs
  .map((r) => r.timeline?.coverageErrorPct)
  .filter(Number.isFinite);
const walls = runs.map((r) => r.wallRevealMs).filter(Number.isFinite);

const stageMap = new Map();
for (const r of runs) {
  for (const s of r.timeline?.stages || []) {
    const key = `${s.from} → ${s.to}`;
    if (!stageMap.has(key)) stageMap.set(key, { key, ms: [] });
    stageMap.get(key).ms.push(s.ms);
  }
}
const stageRows = [...stageMap.values()]
  .map((s) => ({
    stage: s.key,
    median: median(s.ms),
    min: Math.min(...s.ms),
    max: Math.max(...s.ms),
    n: s.ms.length,
    pctOfTotal: median(totals)
      ? +((median(s.ms) / median(totals)) * 100).toFixed(1)
      : null,
  }))
  .sort((a, b) => b.median - a.median);

const summary = {
  tag: TAG,
  url: BASE,
  runs: runs.length,
  gpu: runs.map((r) => r.gpu?.renderer || null),
  gpuAllRtx3060: runs.every((r) => /RTX 3060/.test(r.gpu?.renderer || '')),
  total: {
    median: median(totals),
    min: Math.min(...totals),
    max: Math.max(...totals),
    values: totals,
  },
  sum: { median: median(sums), values: sums },
  coverageErrorPct: {
    median: median(covErrs),
    max: Math.max(...covErrs.map(Math.abs)),
  },
  wallReveal: { median: median(walls), values: walls },
  wallVsTimelinePct: median(totals)
    ? +(((median(walls) - median(totals)) / median(totals)) * 100).toFixed(2)
    : null,
  stages: stageRows,
  resources: runs[0]?.timeline?.resources || null,
  longTasks: runs.map((r) => r.timeline?.longTasks || []),
  longFrames: runs.map((r) => r.timeline?.longFrames || []),
  worstFrame: runs.map((r) => r.timeline?.worstFrame),
  frames: runs.map((r) => r.timeline?.frames),
  errors: runs.map((r) => r.errors),
};

const file = join(OUT, `baseline-${TAG}.json`);
writeFileSync(file, JSON.stringify({ summary, runs }, null, 1));

console.log(
  '\n==== 中位数表（ms，n=' + runs.length + '，锚点=navigationStart）====',
);
console.log('阶段'.padEnd(46) + 'median   min     max     %total');
for (const s of summary.stages) {
  console.log(
    s.stage.padEnd(46) +
      String(s.median).padStart(7) +
      String(s.min).padStart(8) +
      String(s.max).padStart(8) +
      String(s.pctOfTotal).padStart(8) +
      '%',
  );
}
console.log(
  '\n总 loading(时间线) median:',
  summary.total.median,
  'ms   min/max:',
  summary.total.min,
  '/',
  summary.total.max,
);
console.log(
  '阶段之和 median:',
  summary.sum.median,
  'ms   覆盖误差 median/max:',
  summary.coverageErrorPct.median,
  '%/',
  summary.coverageErrorPct.max,
  '%',
);
console.log(
  'harness 墙钟 median:',
  summary.wallReveal.median,
  'ms   与时间线偏差:',
  summary.wallVsTimelinePct,
  '%',
);
console.log('GPU 全 RTX 3060:', summary.gpuAllRtx3060, summary.gpu[0]);
console.log('worst frame per run:', summary.worstFrame.join(' / '), 'ms');
console.log('长任务 top:', JSON.stringify(summary.longTasks[0]?.slice(0, 5)));
console.log(
  '资源:',
  summary.resources && {
    count: summary.resources.count,
    mb: summary.resources.mb,
    groups: summary.resources.groups,
  },
);
console.log('\n写出:', file);
