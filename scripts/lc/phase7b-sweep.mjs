#!/usr/bin/env node
/* Phase7B —— 真实地图色散 JND 补偿（只调 dispCap；不碰 layout/pp/loading/玻璃几何）
   模式：
     node scripts/lc/phase7b-sweep.mjs sweep          扫 dispCap ∈ {12,16,20,24,28,32}/255，出 36 边 JND 统计
     node scripts/lc/phase7b-sweep.mjs verify [tag]   用产品默认参数跑 36 边 JND + 1x/4x/8x 样张
   口径与 C6 一致：A/B 只切 dispGain 8↔1 隔离色散分量（同底图），另拍 gain8/gain8 作噪声底。 */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const M = process.argv[2] || 'sweep';
const MODE = ['sweep', 'gain', 'verify'].includes(M) ? M : 'sweep';
const TAG = process.argv[3] || 'p7b';
const BASE = process.env.GEV_URL || 'http://127.0.0.1:4174/?welcome=0';
const OUT = '.gev-logs/lc/phase7b';
mkdirSync(OUT, { recursive: true });
const W = 1348, VH = 774;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${VH + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: VH, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 140)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});
const t0 = Date.now();
await page.goto(`${BASE}&t=${Date.now()}`, { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
    && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
const bootMs = Date.now() - t0;
await sleep(5000);
const cdp = await page.createCDPSession();
const gpu = await page.evaluate(() => { try { return window.__gevGpu.probe().renderer; } catch (e) { return null; } });
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const parkPtr = async () => { await page.mouse.move(4, 700, { steps: 3 }); await sleep(450); };
const save = (name, b64) => { if (b64) writeFileSync(`${OUT}/${TAG}-${name}.png`, Buffer.from(b64, 'base64')); };

/* 页内像素内核（与 phase6c6-visual.mjs 同口径） */
await page.evaluate(() => {
  const dec = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height, K: bmp.width / innerWidth };
  };
  const edgeDisp = (A, B, rect, edgePx, axis, bandPx, dir, cap255) => {
    dir = dir || 1;
    const satThr = 0.9 * (cap255 || 1e9);
    const x0 = Math.round(rect.x + rect.w * 0.3), x1 = Math.round(rect.x + rect.w * 0.7);
    const y0 = Math.round(rect.y + rect.h * 0.3), y1 = Math.round(rect.y + rect.h * 0.7);
    const edge = Math.round(edgePx);
    const prof = [], maxAt = [];
    let satN = 0, totN = 0;
    for (let k = 0; k <= 14; k++) {
      const aa = edge + k * dir;
      let s = 0, n = 0, mx = 0;
      for (let t = Math.max(0, Math.min(aa, aa + dir)); t < Math.min(axis === 'y' ? A.h : A.w, Math.max(aa, aa + dir)); t++) {
        for (let u = axis === 'y' ? x0 : y0; u < Math.min(axis === 'y' ? x1 : y1, axis === 'y' ? A.w : A.h); u++) {
          const i = axis === 'y' ? (t * A.w + u) * 4 : (u * A.w + t) * 4;
          const drb = (A.d[i] - B.d[i]) - (A.d[i + 2] - B.d[i + 2]);
          s += drb; n++; if (Math.abs(drb) > mx) mx = Math.abs(drb);
          if (k < 10) { totN++; if (Math.abs(drb) >= satThr) satN++; }
        }
      }
      prof.push(n ? +(s / n).toFixed(2) : 0);
      maxAt.push(+mx.toFixed(1));
    }
    const bd = Math.max(1, Math.round(bandPx));
    const inBand = prof.slice(0, bd);
    const mean = inBand.reduce((a, b) => a + b, 0) / inBand.length;
    const max2d = Math.max(...maxAt.slice(0, bd));
    let w = 0; while (w < inBand.length && Math.abs(inBand[w]) >= 2) w++;
    let flips = 0;
    for (let i = 1; i < inBand.length; i++) if (inBand[i] !== 0 && Math.sign(inBand[i]) !== Math.sign(inBand[i - 1]) && Math.abs(inBand[i]) >= 1.5) flips++;
    return { mean: +mean.toFixed(2), max2d, widthPx: w, flips, prof: inBand, maxAt: maxAt.slice(0, bd), satFrac: +(satN / Math.max(1, totN)).toFixed(3) };
  };
  window.__p7 = { dec, edgeDisp };
  window.__p7crop = async (b64, box, s) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const K = bmp.width / innerWidth;
    const cv = document.createElement('canvas');
    cv.width = Math.round(box.w * K * s); cv.height = Math.round(box.h * K * s);
    const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false;
    cx.drawImage(bmp, Math.round(box.x * K), Math.round(box.y * K), Math.round(box.w * K), Math.round(box.h * K), 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/png');
  };
});

/* 卡片清单以 __gevEdge.stats().surfaces（9 面）为权威源：.gev-lc 在某些状态下少一张（P7B 实测 8/9） */
const cardRects = await page.evaluate(() => {
  const s = window.__gevEdge.stats();
  const ids = (s.surfaces || []).map((x) => x.id);
  window.__gevEdge.logIds = ids;
  return ids.map((id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { id, x: r.x, y: r.y, w: r.width, h: r.height };
  }).filter((c) => c && c.w > 20 && c.h > 20);
});
const bandMap = await page.evaluate(() => {
  const s = window.__gevEdge.stats();
  return Object.fromEntries((s.surfaces || []).map((x) => [x.id, x.band]));
});
const sweepPair = async (a, b, cap255) => page.evaluate(async (a, b, cards, bands, cap255) => {
  const dec = window.__p7.dec, f = window.__p7.edgeDisp;
  const A = await dec(a), B = await dec(b);
  const K = A.K; const rows = [];
  for (const cd of cards) {
    const r = { x: cd.x * K, y: cd.y * K, w: cd.w * K, h: cd.h * K };
    const band = (bands[cd.id] || 10) * K;
    const edges = { top: [r.y, 'y', 1], left: [r.x, 'x', 1], bot: [r.y + r.h, 'y', -1], right: [r.x + r.w, 'x', -1] };
    for (const [e, [ep, ax, dir]] of Object.entries(edges)) {
      const m = f(A, B, r, ep, ax, band, dir, cap255);
      rows.push({ card: cd.id, edge: e, mean: m.mean, absMean: Math.abs(m.mean), max2d: m.max2d, flips: m.flips, satFrac: m.satFrac, prof: m.prof });
    }
  }
  return rows;
}, a, b, cardRects, bandMap, cap255);

const setCfg = (o) => page.evaluate((o) => window.__gevEdge.set(o), o);

/* ── A/B：dispGain=gain（开）vs 1（旧行为基准）→ 差就是色散分量 ──
   真实地图有风场/航班在动（实测 0.46% 像素每帧变化），单次 A/B 的 max2d 会被
   偶发运动污染 → 每组跑 REPS 对，逐边取中位数（mean/max2d/flips 全中位）。 */
const REPS = 3;
const measureAt = async (gain, capScalar) => {
  const cap255 = capScalar * 255;
  const passes = [], noises = [];
  for (let i = 0; i < REPS; i++) {
    await setCfg({ dispGain: gain, dispCap: capScalar });
    await parkPtr(); await sleep(350);
    const a = await shot();
    await setCfg({ dispGain: 1.0 }); await sleep(450);
    const b = await shot();
    await setCfg({ dispGain: gain }); await sleep(450);
    const n1 = await shot();
    const n2 = await shot();
    await parkPtr(); await sleep(200);
    passes.push(await sweepPair(a, b, cap255));
    noises.push(await sweepPair(n1, n2, cap255));
  }
  const med = (arr) => { const s = arr.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const rows = passes[0].map((r0, idx) => {
    const pick = (f) => passes.map((p) => f(p[idx]));
    return {
      card: r0.card, edge: r0.edge,
      mean: +med(pick((r) => r.mean)).toFixed(2),
      absMean: +med(pick((r) => r.absMean)).toFixed(2),
      max2d: med(pick((r) => r.max2d)),
      flips: med(pick((r) => r.flips)),
      satFrac: +med(pick((r) => r.satFrac)).toFixed(3),
      absMeanAll: pick((r) => r.absMean).map((x) => +x.toFixed(2)),
    };
  });
  const noise = noises[0].map((r0, idx) => ({ card: r0.card, edge: r0.edge, absMean: med(noises.map((p) => p[idx].absMean)), max2d: med(noises.map((p) => p[idx].max2d)) }));
  const sum = (rs) => rs.reduce((s, r) => s + Math.abs(r.absMean), 0) / rs.length;
  /* 决策①（2026-10-30）：JND 判定改用**带内逐像素峰值**（max2d）；带符号 band 均值降级为 INFO 趋势。 */
  const noisePeakMax = Math.max(...noise.map((r) => r.max2d));
  const peakThr = Math.max(3, 2 * noisePeakMax);
  const atJndPeak = rows.filter((r) => r.max2d >= peakThr).length;
  const peakSorted = rows.map((r) => r.max2d).sort((x, y) => x - y);
  const atJnd = rows.filter((r) => r.absMean >= 3).length;
  const best = rows.slice().sort((x, y) => y.absMean - x.absMean)[0];
  const bestPeak = rows.slice().sort((x, y) => y.max2d - x.max2d)[0];
  return {
    gain, cap255: +cap255.toFixed(1),
    edges: rows.length, atJnd, ratio: +(atJnd / rows.length).toFixed(3),
    atJndPeak, ratioPeak: +(atJndPeak / rows.length).toFixed(3), peakThr,
    peakMin: peakSorted[0], peakMed: peakSorted[Math.floor(peakSorted.length / 2)], peakMax: peakSorted[peakSorted.length - 1],
    bestPeak: { card: bestPeak.card, edge: bestPeak.edge, max2d: bestPeak.max2d },
    meanAbs: +sum(rows).toFixed(3),
    maxAbs: +best.absMean.toFixed(2), best: { card: best.card, edge: best.edge, mean: best.mean, max2d: best.max2d },
    max2d: Math.max(...rows.map((r) => r.max2d)),
    maxFlips: Math.max(...rows.map((r) => r.flips)),
    maxSatFrac: +Math.max(...rows.map((r) => r.satFrac)).toFixed(3),
    noiseMean: +sum(noise).toFixed(3), noiseMax2d: Math.max(...noise.map((r) => r.max2d)),
    rows, noiseRows: noise,
  };
};

const report = { mode: MODE, at: new Date().toISOString(), base: BASE, gpu, bootMs, errs: [] };

const line = (tag, m) => `${tag}  gain ${m.gain} cap ${m.cap255}/255  peakJND ${m.atJndPeak}/${m.edges} (${(m.ratioPeak * 100).toFixed(0)}%, thr ${m.peakThr.toFixed(1)}, med ${m.peakMed})  [info meanJND ${m.atJnd}/${m.edges}]  meanAbs ${m.meanAbs}  maxAbs ${m.maxAbs} (${m.best.card}/${m.best.edge})  max2d ${m.max2d}  flips ${m.maxFlips}  satFrac ${m.maxSatFrac}  noise ${m.noiseMean}`;

/* 预热：页面 ready 后镜头/纹理仍在收敛（首轮实测噪声 12.7 → 整轮失效），先跑一轮丢弃 */
const warmup = async () => {
  await setCfg({ dispGain: 8.0, dispCap: 12 / 255 });
  await parkPtr(); await sleep(2500);
  const w = await measureAt(8.0, 12 / 255);
  report.warmup = { noise: w.noiseMean, maxAbs: w.maxAbs, meanAbs: w.meanAbs };
  console.log(`warmup(discard)  noise ${w.noiseMean}  meanAbs ${w.meanAbs}  maxAbs ${w.maxAbs}`);
};

if (MODE === 'sweep') {
  await warmup();
  report.sweep = [];
  for (const c of [12, 16, 20, 24, 28, 32]) {
    const m = await measureAt(8.0, c / 255);
    report.sweep.push(m);
    console.log(line(`cap ${c}/255`, m));
  }
  console.log('cards', cardRects.length, cardRects.map((c) => c.id).join(','));
} else if (MODE === 'gain') {
  await warmup();
  report.gainsweep = [];
  const combos = [[8, 20], [16, 20], [24, 20], [32, 20], [48, 20], [64, 20], [32, 24], [48, 24]];
  for (const [g, c] of combos) {
    const m = await measureAt(g, c / 255);
    report.gainsweep.push(m);
    console.log(line(`gain ${g} / cap ${c}`, m));
  }
} else {
  const cfg = await page.evaluate(() => window.__gevEdge.cfg());
  await warmup();
  const m = await measureAt(cfg.dispGain, cfg.dispCap);
  report.cfg = { gain: cfg.gain, band: cfg.band, ior: cfg.ior, thick: cfg.thick, dispPx: cfg.dispPx, dispGain: cfg.dispGain, dispCap: cfg.dispCap, bandAlpha: cfg.bandAlpha };
  report.sepCss = +(0.4 * cfg.dispPx).toFixed(3);
  report.jnd = m;
  console.log(`verify  sep ${report.sepCss}px  ` + line('', m));
  console.log(`判据（决策① 2026-10-30）逐像素材峰值 ≥3 灰阶 边占比 ≥50% → ${m.atJndPeak}/${m.edges} (${(m.ratioPeak * 100).toFixed(0)}%)  ${m.ratioPeak >= 0.5 ? 'PASS' : 'FAIL'}  |  带内峰值 min/med/max ${m.peakMin}/${m.peakMed}/${m.peakMax}  |  作废口径 band 均值 ${m.atJnd}/${m.edges}（仅趋势）`);

  /* 1x 全屏 + 最强边 4x/8x 样张（最近邻放大，不改像素值） */
  await parkPtr(); await sleep(300);
  const full = await shot();
  save('1x-full', full);
  const top = m.rows.slice().sort((a, b) => b.absMean - a.absMean).slice(0, 3);
  report.zoom = [];
  for (const r of top) {
    const cd = cardRects.find((c) => c.id === r.card);
    if (!cd) continue;
    const boxes = {
      top: { x: cd.x + cd.w * 0.3, y: cd.y - 2, w: 60, h: 14 },
      bot: { x: cd.x + cd.w * 0.3, y: cd.y + cd.h - 12, w: 60, h: 14 },
      left: { x: cd.x - 2, y: cd.y + cd.h * 0.3, w: 14, h: 60 },
      right: { x: cd.x + cd.w - 12, y: cd.y + cd.h * 0.3, w: 14, h: 60 },
    };
    const box = boxes[r.edge];
    for (const s of [4, 8]) {
      const u = await page.evaluate((b64, box, s) => window.__p7crop(b64, box, s), full, box, s);
      const nm = `${r.card}-${r.edge}-${s}x`;
      writeFileSync(`${OUT}/${TAG}-${nm}.png`, Buffer.from(String(u).split(',')[1], 'base64'));
      report.zoom.push({ name: nm, card: r.card, edge: r.edge, scale: s, mean: r.mean, box });
    }
  }
  console.log('zoom samples:', report.zoom.map((z) => z.name).join(', '));
}

report.errs = errs.filter((e) => !/Failed to load resource|favicon/i.test(e)).slice(0, 6);
writeFileSync(`${OUT}/${TAG}-${MODE}.json`, JSON.stringify(report, null, 1));
console.log('gpu', gpu, 'boot', bootMs, 'ms  errs', report.errs.length);
await browser.close();
