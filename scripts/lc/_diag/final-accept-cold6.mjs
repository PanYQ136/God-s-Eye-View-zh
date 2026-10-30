#!/usr/bin/env node
/* 终验（card t_374e47f6）—— 6 次冷启动：loading / B5@reveal / 进入后 10s 帧率 / 长帧
   ---------------------------------------------------------------------------
   每次：全新 Chrome profile + Network.clearBrowserCache + ?welcome=0，25ms 轮询遮罩
   (opacity<0.02 或 __gevBoot.interactive) 作为 loading 墙钟终点。
   终点后 +100ms 截全页 → 页内解码中心 640×420 → std / uniq（与 gate B5 同口径）。
   随后立刻装 rAF 采集器 16s：
     W1 = reveal 后 0–10s（本卡要求：进入后 10s 帧率 + >100ms 长帧）
     W2 = reveal 后 7–15s（gate B4 ramp 硬断言同口径）
   GPU 每次读 __gevGpu.probe().renderer，必须含 RTX 3060。
   用法: node scripts/lc/_diag/final-accept-cold6.mjs <tag> [runs] [base]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'accept6';
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

const runs = [];

for (let i = 1; i <= RUNS; i++) {
  const profile = mkdtempSync(join(tmpdir(), `gev-final-${TAG}-`));
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

  let wallReveal = null;
  for (let k = 0; k < 2400; k++) {
    const st = await page
      .evaluate(() => {
        const g = window.__gevBoot;
        const el = document.getElementById('loading-screen');
        const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
        return { interactive: !!(g && g.interactive), op };
      })
      .catch(() => null);
    if (st && (st.interactive || (Number.isFinite(st.op) && st.op < 0.02))) {
      wallReveal = Date.now() - wall0;
      break;
    }
    await sleep(25);
  }

  /* reveal +100ms：B5 取证（中心 640×420，页内解码同一张 PNG） */
  await sleep(100);
  const png = await page.screenshot({ encoding: 'base64' }).catch(() => null);
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
          return {
            w,
            h,
            mean: +mean.toFixed(2),
            std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(2),
            uniq: uniq.size,
          };
        }, png)
        .catch((e) => ({ err: String(e.message || e) }))
    : null;
  const shotFile = join(OUT, `accept6-${TAG}-run${i}-reveal100.png`);
  if (png) writeFileSync(shotFile, Buffer.from(png, 'base64'));

  /* 进入后 rAF 采集 16s（W1 = 0–10s，W2 = 7–15s） */
  await page.evaluate(() => {
    const frames = [];
    const t0 = performance.now();
    window.__finalAcc = { frames, t0, done: false };
    const tick = (ts) => {
      const el = document.getElementById('loading-screen');
      const op = el ? parseFloat(getComputedStyle(el).opacity) : 0;
      frames.push({ t: +(ts - t0).toFixed(1), maskOp: op });
      if (ts - t0 < 16000) requestAnimationFrame(tick);
      else window.__finalAcc.done = true;
    };
    requestAnimationFrame(tick);
  });
  for (let k = 0; k < 200; k++) {
    const done = await page.evaluate(() => !!(window.__finalAcc && window.__finalAcc.done)).catch(() => false);
    if (done) break;
    await sleep(200);
  }
  const acc = await page
    .evaluate(() => {
      const a = window.__finalAcc;
      if (!a) return null;
      const f = a.frames;
      const deltas = [];
      for (let i = 1; i < f.length; i++) deltas.push({ t: f[i].t, dt: +(f[i].t - f[i - 1].t).toFixed(1), maskOp: f[i].maskOp });
      const win = (lo, hi) => {
        const d = deltas.filter((x) => x.t >= lo && x.t <= hi);
        const span = d.length ? d[d.length - 1].t - d[0].t + d[0].dt : 0;
        const sum = d.reduce((s, x) => s + x.dt, 0);
        const over100 = d.filter((x) => x.dt >= 100);
        return {
          frames: d.length,
          spanMs: +span.toFixed(0),
          fpsMean: span ? +((d.length / span) * 1000).toFixed(1) : null,
          worst: d.length ? Math.max(...d.map((x) => x.dt)) : null,
          over100: over100.length,
          over100List: over100.map((x) => x.t),
          over100MaskMin: over100.length ? Math.min(...over100.map((x) => x.maskOp)) : null,
        };
      };
      return { w1: win(0, 10000), w2: win(7000, 15000), framesTotal: f.length, lastT: f.length ? f[f.length - 1].t : null };
    })
    .catch((e) => ({ err: String(e.message || e) }));

  const snap = await page
    .evaluate(() => {
      const g = window.__gevBoot;
      const s = g && g.snapshot ? g.snapshot() : null;
      const tl = window.__bootTimeline;
      return {
        state: s ? s.state : null,
        reason: s ? s.reason : null,
        marks: s ? s.marks : null,
        probeConfig: s ? s.probeConfig : null,
        longFrames: s ? s.longFrames : null,
        timeline: tl && typeof tl.snapshot === 'function' ? tl.snapshot() : null,
        gpu: window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null,
      };
    })
    .catch((e) => ({ error: String(e.message || e) }));

  const mk = Object.fromEntries(((snap.marks || [])).map((m) => [m.name, m.t]));
  const dt = (a, b) => (mk[a] != null && mk[b] != null ? +(mk[b] - mk[a]).toFixed(0) : null);
  const row = {
    run: i,
    loadingMs: wallReveal,
    reason: snap.reason,
    stateAtEnd: snap.state,
    marks: mk,
    probeConfig: snap.probeConfig,
    tilesetToContent: dt('tileset:added', 'view:content'),
    contentToSettled: dt('view:content', 'view:settled'),
    decideToMaskGone: snap.reason ? dt('decide:' + snap.reason, 'mask:gone') : null,
    b5: b5,
    b5Pass: !!(b5 && b5.std >= 18 && b5.uniq >= 800),
    w1: acc && acc.w1,
    w2: acc && acc.w2,
    maskLongFrames: (snap.longFrames || []).filter((f) => f.dt >= 100).length,
    maskLongFramesVisible: (snap.longFrames || []).filter((f) => f.dt >= 100 && f.maskOp < 0.95).length,
    timelineTotal: snap.timeline ? snap.timeline.total : null,
    gpuRenderer: snap.gpu ? snap.gpu.renderer : null,
    errors: errors.slice(0, 6),
    screenshot: shotFile,
  };
  runs.push(row);
  writeFileSync(join(OUT, `accept6-${TAG}-partial.json`), JSON.stringify(runs, null, 1));
  console.log(
    `run${i} loading=${wallReveal}ms reason=${row.reason} B5 std=${b5 && b5.std} uniq=${b5 && b5.uniq} ` +
      `| W1(0-10s) fps=${row.w1 && row.w1.fpsMean} worst=${row.w1 && row.w1.worst} over100=${row.w1 && row.w1.over100} ` +
      `| W2 ramp fps=${row.w2 && row.w2.fpsMean} worst=${row.w2 && row.w2.worst} over100=${row.w2 && row.w2.over100} ` +
      `| gpu=${(row.gpuRenderer || '').slice(0, 60)}`,
  );
  await browser.close();
}

const gpuOk = runs.every((r) => /RTX 3060/.test(String(r.gpuRenderer || '')));
const agg = {
  tag: TAG,
  base: BASE,
  runs: runs.length,
  loadingMs: runs.map((r) => r.loadingMs),
  loadingMedian: median(runs.map((r) => r.loadingMs)),
  loadingMax: Math.max(...runs.map((r) => r.loadingMs)),
  loadingPass5s: runs.every((r) => r.loadingMs != null && r.loadingMs <= 5000),
  loadingPass3s: runs.every((r) => r.loadingMs != null && r.loadingMs <= 3000),
  b5: runs.map((r) => r.b5),
  b5Pass: runs.every((r) => r.b5Pass),
  w1Fps: runs.map((r) => r.w1 && r.w1.fpsMean),
  w1Worst: runs.map((r) => r.w1 && r.w1.worst),
  w1Over100: runs.map((r) => r.w1 && r.w1.over100),
  fpsInRange: runs.every((r) => r.w1 && r.w1.fpsMean >= 50 && r.w1.fpsMean <= 60),
  noOver100: runs.every((r) => r.w1 && r.w1.over100 === 0),
  rampPass: runs.every((r) => r.w2 && r.w2.worst != null && r.w2.worst <= 100),
  reasons: runs.map((r) => r.reason),
  gpuAllRtx3060: gpuOk,
  gpuRenderers: runs.map((r) => r.gpuRenderer),
  raw: runs,
};
writeFileSync(join(OUT, `accept6-${TAG}.json`), JSON.stringify(agg, null, 1));
console.log('\n== AGG ==');
console.log(JSON.stringify({ ...agg, raw: undefined }, null, 1));
