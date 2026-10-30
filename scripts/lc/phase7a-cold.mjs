#!/usr/bin/env node
/* Phase7A · 冷启动验收（base-first）
   ---------------------------------------------------------------------------
   口径与 C6 终验脚本一致（scripts/lc/_diag/final-accept-cold6.mjs）：
   全新 profile + Network.clearBrowserCache + ?welcome=0，25ms 轮询遮罩，
   opacity<0.02 或 __gevBoot.interactive 作为 loading 墙钟终点；
   reveal+100ms 截图 → 页内解码中心 640×420 → std / uniq（B5 同口径）。
   追加 Phase7A 必须项：
     · photoreal 后台最终加载完成（__gevPhotoreal.ready && scene.globe.show===false）
     · 交互后 0–10s 帧率 / >100ms
   用法: node scripts/lc/phase7a-cold.mjs <tag> [runs] [base]
*/
import puppeteer from 'puppeteer';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TAG = process.argv[2] || 'p7a';
const RUNS = Number(process.argv[3] || 3);
const BASE = process.argv[4] || 'http://127.0.0.1:4173/?welcome=0';
const OUT = '.gev-logs/lc/phase7a';
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
  const profile = mkdtempSync(join(tmpdir(), `gev-p7a-${TAG}-`));
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
    if (m.type() === 'error') errors.push('console.error: ' + m.text().slice(0, 200));
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

  /* reveal +100ms：B5 取证 */
  await sleep(100);
  const png = await page.screenshot({ encoding: 'base64' }).catch(() => null);
  const b5 = png
    ? await page
        .evaluate(async (b64) => {
          const bmp = await createImageBitmap(
            await (await fetch('data:image/png;base64,' + b64)).blob(),
          );
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
  const shotFile = join(OUT, `p7a-${TAG}-run${i}-reveal100.png`);
  if (png) writeFileSync(shotFile, Buffer.from(png, 'base64'));

  /* 交互后 rAF 采集 12s（W1 = 0–10s） */
  await page.evaluate(() => {
    const frames = [];
    const t0 = performance.now();
    window.__p7aAcc = { frames, t0, done: false };
    const tick = (ts) => {
      frames.push({ t: +(ts - t0).toFixed(1) });
      if (ts - t0 < 12000) requestAnimationFrame(tick);
      else window.__p7aAcc.done = true;
    };
    requestAnimationFrame(tick);
  });
  for (let k = 0; k < 200; k++) {
    const done = await page.evaluate(() => !!(window.__p7aAcc && window.__p7aAcc.done)).catch(() => false);
    if (done) break;
    await sleep(200);
  }
  const acc = await page
    .evaluate(() => {
      const a = window.__p7aAcc;
      if (!a) return null;
      const f = a.frames;
      const deltas = [];
      for (let i = 1; i < f.length; i++) deltas.push({ t: f[i].t, dt: +(f[i].t - f[i - 1].t).toFixed(1) });
      const d = deltas.filter((x) => x.t <= 10000);
      const span = d.length ? d[d.length - 1].t - d[0].t + d[0].dt : 0;
      const over100 = d.filter((x) => x.dt >= 100);
      return {
        frames: d.length,
        fpsMean: span ? +((d.length / span) * 1000).toFixed(1) : null,
        worst: d.length ? Math.max(...d.map((x) => x.dt)) : null,
        over100: over100.length,
        over100List: over100.map((x) => ({ t: x.t, dt: x.dt })),
      };
    })
    .catch((e) => ({ err: String(e.message || e) }));

  /* photoreal 最终态（等到 ready 或 25s） */
  let photoreal = null;
  for (let k = 0; k < 125; k++) {
    photoreal = await page
      .evaluate(() => ({
        p: window.__gevPhotoreal || null,
        globeShow: window.__gevViewer ? window.__gevViewer.scene.globe.show : null,
        activeStack: window.__godsEyeView?.mapStackController?.getState
          ? window.__godsEyeView.mapStackController.getState()?.activeId ?? null
          : null,
        tilesInScene: (() => {
          const prims = window.__gevViewer?.scene?.primitives;
          if (!prims) return null;
          let n = 0;
          for (let i = 0; i < prims.length; i++) {
            const p = prims.get(i);
            if (p && p.initialTilesLoaded && typeof p.tilesLoaded === 'boolean') n += 1;
          }
          return n;
        })(),
      }))
      .catch(() => null);
    if (photoreal && photoreal.p && photoreal.p.ready) break;
    await sleep(200);
  }

  const snap = await page
    .evaluate(() => {
      const g = window.__gevBoot;
      const s = g && g.snapshot ? g.snapshot() : null;
      const tl = window.__bootTimeline;
      return {
        marks: s ? s.marks : null,
        reason: s ? s.reason : null,
        longFrames: s ? s.longFrames : null,
        timeline: tl && typeof tl.snapshot === 'function' ? tl.snapshot() : null,
        gpu: window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null,
        cine: window.__gevCine ? { stage: window.__gevCine.stage, done: window.__gevCine.done } : null,
      };
    })
    .catch((e) => ({ error: String(e.message || e) }));

  const mk = Object.fromEntries((snap.marks || []).map((m) => [m.name, m.t]));
  const dt = (a, b) => (mk[a] != null && mk[b] != null ? +(mk[b] - mk[a]).toFixed(0) : null);
  const row = {
    run: i,
    loadingMs: wallReveal,
    reason: snap.reason,
    marks: mk,
    phase: {
      navToFirstFrame: mk['frame:first'],
      firstFrameToSceneReady: dt('frame:first', 'scene:ready'),
      sceneReadyToBaseStack: dt('basemap:setStack:begin', 'basemap:setStack:end'),
      cineGoToDone: dt('cine:go(base-first)', 'cine:done'),
      baseStackEndToContent: dt('basemap:setStack:end', 'view:content'),
      contentToDecide: dt('view:content', 'view:settled'),
    },
    timeline: snap.timeline
      ? { total: snap.timeline.total, stages: (snap.timeline.stages || []).map((s) => [s.from + '→' + s.to, Math.round(s.ms)]) }
      : null,
    b5,
    b5Pass: !!(b5 && b5.std >= 18 && b5.uniq >= 800),
    w1: acc,
    photoreal,
    cine: snap.cine,
    maskLongFrames: (snap.longFrames || []).filter((f) => f.dt >= 100).length,
    gpuRenderer: snap.gpu ? snap.gpu.renderer : null,
    errors: errors.slice(0, 8),
    screenshot: shotFile,
  };
  runs.push(row);
  writeFileSync(join(OUT, `p7a-${TAG}-partial.json`), JSON.stringify(runs, null, 1));
  console.log(
    `run${i} loading=${wallReveal}ms reason=${row.reason} B5 std=${b5 && b5.std} uniq=${b5 && b5.uniq} ` +
      `| W1 fps=${acc && acc.fpsMean} worst=${acc && acc.worst} over100=${acc && acc.over100} ` +
      `| photoreal ready=${photoreal && photoreal.p && photoreal.p.ready} globe=${photoreal && photoreal.globeShow} stack=${photoreal && photoreal.activeStack} ` +
      `| gpu=${(row.gpuRenderer || '').slice(0, 48)}`,
  );
  await browser.close();
}

const agg = {
  tag: TAG,
  base: BASE,
  runs: runs.length,
  loadingMs: runs.map((r) => r.loadingMs),
  loadingMedian: median(runs.map((r) => r.loadingMs)),
  loadingMax: Math.max(...runs.map((r) => r.loadingMs)),
  loadingPass5s: runs.every((r) => r.loadingMs != null && r.loadingMs <= 5000),
  b5Pass: runs.every((r) => r.b5Pass),
  b5: runs.map((r) => r.b5),
  photorealReady: runs.map((r) => !!(r.photoreal && r.photoreal.p && r.photoreal.p.ready)),
  photorealPass: runs.every((r) => !!(r.photoreal && r.photoreal.p && r.photoreal.p.ready)),
  w1Fps: runs.map((r) => r.w1 && r.w1.fpsMean),
  w1Worst: runs.map((r) => r.w1 && r.w1.worst),
  w1Over100: runs.map((r) => r.w1 && r.w1.over100),
  gpuAllRtx3060: runs.every((r) => /RTX 3060/.test(String(r.gpuRenderer || ''))),
  raw: runs,
};
writeFileSync(join(OUT, `p7a-${TAG}.json`), JSON.stringify(agg, null, 1));
console.log('\n== AGG ==');
console.log(JSON.stringify({ ...agg, raw: undefined }, null, 1));
