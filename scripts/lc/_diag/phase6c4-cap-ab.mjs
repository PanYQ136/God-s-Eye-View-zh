#!/usr/bin/env node
/* Phase6C4 (card t_36d7461c) —— 遮罩期并发 A/B + settle/grace + B5 reveal 取证
   ---------------------------------------------------------------------------
   测什么（每次冷启动，全新 profile，空 HTTP 缓存）：
     1. 遮罩期实际生效的 Cesium 请求并发上限（轮询 __gevBoot.snapshot().sched，
        只统计 maskOp ≥ 0.95 的采样 → 证明遮罩期被压在 SCHED_CAP）；
     2. probeConfig.settleMs / graceMs / settleGraceTotalMs（断言合计 700）；
     3. 遮罩收起时刻（opacity<0.02）的墙钟 + gate marks（tileset:added /
        view:content / view:settled / decide / mask:gone）；
     4. reveal+100ms 中心 640×420 的 std / uniq / lap（与 gate B5 同口径，页内解码）；
     5. 遮罩期 >100ms 长帧的 maskOp（B2 口径，必须全部 ≥0.95）。
   用途：对 SCHED_CAP {1,2} 与 {2,4} 做同机 A/B，判断「降到 1/2 是否多等」。
   用法: node scripts/lc/_diag/phase6c4-cap-ab.mjs <tag> [runs] [url]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'cap-ab';
const RUNS = Number(process.argv[3] || 3);
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

const runs = [];

for (let i = 1; i <= RUNS; i++) {
  const profile = mkdtempSync(join(tmpdir(), `gev-capab-${TAG}-`));
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
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 160)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 160));
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable').catch(() => {});
  await cdp.send('Network.clearBrowserCache').catch(() => {});

  const wall0 = Date.now();
  await page.goto(`${BASE}&run=${i}&t=${Date.now()}`, { waitUntil: 'domcontentloaded' });

  /* 轮询：遮罩期并发上限 + 遮罩不透明度；遮罩消失即记为 reveal */
  const schedSamples = [];
  let wallReveal = null;
  for (let k = 0; k < 1500; k++) {
    const st = await page
      .evaluate(() => {
        const g = window.__gevBoot;
        const el = document.getElementById('loading-screen');
        const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
        const s = g && g.snapshot ? g.snapshot() : null;
        return {
          interactive: !!(g && g.interactive),
          op,
          per: s && s.sched ? s.sched.per : null,
          all: s && s.sched ? s.sched.all : null,
          state: s ? s.state : null,
        };
      })
      .catch(() => null);
    if (st) {
      if (st.op >= 0.95 && st.per != null) schedSamples.push({ op: st.op, per: st.per, all: st.all, at: Date.now() - wall0 });
      if (st.interactive || (Number.isFinite(st.op) && st.op < 0.02)) {
        wallReveal = Date.now() - wall0;
        break;
      }
    }
    await sleep(40);
  }
  await sleep(80);
  const png = await page.screenshot({ encoding: 'base64', clip: undefined }).catch(() => null);
  const b5 = png
    ? await page
        .evaluate(async (b64) => {
          const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
          const w = Math.min(640, bmp.width);
          const h = Math.min(420, bmp.height);
          const x = Math.max(0, Math.round((bmp.width - w) / 2));
          const y = Math.max(0, Math.round((bmp.height - h) / 2));
          const cv = document.createElement('canvas');
          cv.width = w;
          cv.height = h;
          const cx = cv.getContext('2d', { willReadFrequently: true });
          cx.drawImage(bmp, x, y, w, h, 0, 0, w, h);
          const d = cx.getImageData(0, 0, w, h).data;
          let sum = 0,
            sum2 = 0,
            n = 0;
          const uniq = new Set();
          for (let p = 0; p < d.length; p += 4) {
            const l = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
            sum += l;
            sum2 += l * l;
            n += 1;
            uniq.add((d[p] << 16) | (d[p + 1] << 8) | d[p + 2]);
          }
          const mean = sum / n;
          return { w, h, mean: +mean.toFixed(2), std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(2), uniq: uniq.size };
        }, png)
        .catch((e) => ({ err: String(e.message || e) }))
    : null;

  const snap = await page
    .evaluate(() => {
      const g = window.__gevBoot;
      const s = g && g.snapshot ? g.snapshot() : null;
      const tl = window.__bootTimeline;
      return {
        gate: s,
        timeline: tl && typeof tl.snapshot === 'function' ? tl.snapshot() : null,
        gpu: window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null,
      };
    })
    .catch((e) => ({ error: String(e.message || e) }));

  const shot = join(OUT, `capab-${TAG}-run${i}.png`);
  await page.screenshot({ path: shot }).catch(() => {});

  const capSeen = schedSamples.reduce(
    (a, s) => ({ per: Math.min(a.per, s.per), all: Math.min(a.all, s.all), n: a.n + 1 }),
    { per: 99, all: 99, n: 0 },
  );
  const marks = (snap.gate && snap.gate.marks) || [];
  const mk = Object.fromEntries(marks.map((m) => [m.name, m.t]));
  const lf = (snap.gate && snap.gate.longFrames) || [];
  const lf100 = lf.filter((f) => f.dt >= 100);
  const row = {
    run: i,
    wallRevealMs: wallReveal,
    capSeen,
    schedSamplesN: schedSamples.length,
    probeConfig: snap.gate ? snap.gate.probeConfig : null,
    reason: snap.gate ? snap.gate.reason : null,
    stateAtReveal: snap.gate ? snap.gate.state : null,
    marks: mk,
    probeAtReveal: snap.gate ? snap.gate.probeAtReveal : null,
    probeAtDecide: snap.gate ? snap.gate.probeAtDecide : null,
    b5atReveal100: b5,
    longFramesOver100: lf100.length,
    longFramesMinMaskOp: lf100.length ? Math.min(...lf100.map((f) => f.maskOp)) : null,
    longFramesWorst: lf100.length ? Math.max(...lf100.map((f) => f.dt)) : null,
    timelineTotal: snap.timeline ? snap.timeline.total : null,
    gpuRenderer: snap.gpu ? snap.gpu.renderer : null,
    errors,
    screenshot: shot,
  };
  runs.push(row);
  const m = mk;
  const dt = (a, b) => (m[a] != null && m[b] != null ? +(m[b] - m[a]).toFixed(0) : null);
  console.log(
    `run${i} capSeen=${capSeen.per}/${capSeen.all} reveal=${wallReveal}ms reason=${row.reason} ` +
      `settle/grace=${row.probeConfig ? row.probeConfig.settleMs + '/' + row.probeConfig.graceMs + '=' + row.probeConfig.settleGraceTotalMs : '?'} ` +
      `B5@reveal+100 std=${b5 && b5.std} uniq=${b5 && b5.uniq} | ` +
      `tileset→content=${dt('tileset:added', 'view:content')} content→settled=${dt('view:content', 'view:settled')} ` +
      `decide→maskgone=${dt('decide:' + row.reason, 'mask:gone')} | LF>100=${row.longFramesOver100} minMaskOp=${row.longFramesMinMaskOp} worst=${row.longFramesWorst}`,
  );
  await browser.close();
}

const agg = {
  tag: TAG,
  runs: runs.length,
  capSeen: runs.map((r) => `${r.capSeen.per}/${r.capSeen.all}`),
  probeConfig: runs[0] && runs[0].probeConfig,
  wallRevealMs: runs.map((r) => r.wallRevealMs),
  wallRevealMedian: median(runs.map((r) => r.wallRevealMs)),
  tilesetToContent: runs.map((r) => (r.marks['view:content'] != null && r.marks['tileset:added'] != null ? +(r.marks['view:content'] - r.marks['tileset:added']).toFixed(0) : null)),
  contentToSettled: runs.map((r) => (r.marks['view:settled'] != null && r.marks['view:content'] != null ? +(r.marks['view:settled'] - r.marks['view:content']).toFixed(0) : null)),
  b5: runs.map((r) => r.b5atReveal100),
  b5Pass: runs.every((r) => r.b5atReveal100 && r.b5atReveal100.std >= 18 && r.b5atReveal100.uniq >= 800),
  b2Pass: runs.every((r) => r.longFramesMinMaskOp == null || r.longFramesMinMaskOp >= 0.95),
  reasons: runs.map((r) => r.reason),
  gpu: runs.map((r) => r.gpuRenderer),
  raw: runs,
};
writeFileSync(join(OUT, `capab-${TAG}.json`), JSON.stringify(agg, null, 1));
console.log('\n== AGG ==');
console.log(JSON.stringify({ ...agg, raw: undefined }, null, 1));
