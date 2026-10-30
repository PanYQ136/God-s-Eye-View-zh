#!/usr/bin/env node
/* Phase7D3 —— 色散「可见带」深度覆盖 A/B（lead 决策：扩大可见带，不改判据、不放宽 R/B 硬规）
   用途：在同一页内交错切换 CFG.dispBandStart ∈ {0,0.6,0.85,0.95}，用与 phase7b-sweep 完全相同的
   口径（A=dispGain8 / B=dispGain1 的逐像素 Δ(R−B)，36 边 × band 内逐深 1px 线均值）出：
     · band 均值 JND（|bandMean| ≥ 3 的边数 / 36）—— gate 读数，判据不变
     · bandAbsMean = band 内 |Δ| 的线性均值（可用信号包络）
     · cancel = bandAbsMean / |bandMean|（符号抵消倍数 → 判「均值为零」是内容抵消还是量级不足）
     · max2d / flips / satFrac —— 无彩虹与硬边饱和
   用法：node scripts/lc/_diag/p7d3-disp-band.mjs [tag]
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] || 'p7d3';
const BASE = process.env.GEV_URL || 'http://127.0.0.1:4174/?welcome=0';
const OUT = '.gev-logs/lc/phase7d3';
mkdirSync(OUT, { recursive: true });
const W = 1348, VH = 774;
const E0S = (process.env.P7D3_E0 || '0,0.6,0.85,0.95').split(',').map(Number);
const REPS = +(process.env.P7D3_REPS || 3);
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
let booted = false, surfN = 0;
for (let i = 0; i < 450; i++) {          // 本机冷启动 26–70s（机器忙时更久）
  const st = await page.evaluate(() => {
    try {
      const s = window.__gevEdge && window.__gevEdge.stats();
      return { ready: !!(window.__lc && window.__lc.api && window.__lc.api.ready), n: s ? (s.surfaces || []).length : 0 };
    } catch (e) { return { ready: false, n: 0 }; }
  }).catch(() => ({ ready: false, n: 0 }));
  surfN = st.n;
  if (st.ready && st.n >= 9) { booted = true; break; }
  await sleep(400);
}
const bootMs = Date.now() - t0;
await sleep(5000);
const cdp = await page.createCDPSession();
const gpu = await page.evaluate(() => { try { return window.__gevGpu.probe().renderer; } catch (e) { return null; } });
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const parkPtr = async () => { await page.mouse.move(4, 700, { steps: 3 }); await sleep(450); };

/* 页内像素内核：与 phase7b-sweep 同口径 + 每深记录「符号均值 / 绝对值均值」 */
await page.evaluate(() => {
  /* 复用同一块 canvas + 显式 close(bitmap)：旧写法每次 dec 都新建 1685×968 canvas，
     多轮后页面内存堆积会让 Chrome 卡死（实测 4 配置×2 轮的运行在 warmup 后 hang）。 */
  let _cv = null, _cx = null;
  const dec = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    if (!_cv) { _cv = document.createElement('canvas'); _cx = _cv.getContext('2d', { willReadFrequently: true }); }
    if (_cv.width !== bmp.width || _cv.height !== bmp.height) { _cv.width = bmp.width; _cv.height = bmp.height; }
    _cx.clearRect(0, 0, bmp.width, bmp.height);
    _cx.drawImage(bmp, 0, 0);
    const out = { d: _cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height, K: bmp.width / innerWidth };
    if (bmp.close) bmp.close();
    return out;
  };
  const edgeDisp = (A, B, rect, edgePx, axis, bandPx, dir, cap255) => {
    dir = dir || 1;
    const jnd = 3, satThr = 0.9 * (cap255 || 1e9);
    const x0 = Math.round(rect.x + rect.w * 0.3), x1 = Math.round(rect.x + rect.w * 0.7);
    const y0 = Math.round(rect.y + rect.h * 0.3), y1 = Math.round(rect.y + rect.h * 0.7);
    const edge = Math.round(edgePx);
    const prof = [], absProf = [], maxAt = [];
    let satN = 0, totN = 0;
    for (let k = 0; k <= 14; k++) {
      const aa = edge + k * dir;
      let s = 0, sa = 0, n = 0, mx = 0;
      for (let t = Math.max(0, Math.min(aa, aa + dir)); t < Math.min(axis === 'y' ? A.h : A.w, Math.max(aa, aa + dir)); t++) {
        for (let u = axis === 'y' ? x0 : y0; u < Math.min(axis === 'y' ? x1 : y1, axis === 'y' ? A.w : A.h); u++) {
          const i = axis === 'y' ? (t * A.w + u) * 4 : (u * A.w + t) * 4;
          const drb = (A.d[i] - B.d[i]) - (A.d[i + 2] - B.d[i + 2]);
          s += drb; sa += Math.abs(drb); n++; if (Math.abs(drb) > mx) mx = Math.abs(drb);
          if (k < 10) { totN++; if (Math.abs(drb) >= satThr) satN++; }
        }
      }
      prof.push(n ? +(s / n).toFixed(2) : 0);
      absProf.push(n ? +(sa / n).toFixed(2) : 0);
      maxAt.push(+mx.toFixed(1));
    }
    const bd = Math.max(1, Math.round(bandPx));
    const inBand = prof.slice(0, bd), absIn = absProf.slice(0, bd);
    const mean = inBand.reduce((a, b) => a + b, 0) / inBand.length;
    const absMeanPx = absIn.reduce((a, b) => a + b, 0) / absIn.length;
    const max2d = Math.max(...maxAt.slice(0, bd));
    let flips = 0;
    for (let i = 1; i < inBand.length; i++) if (inBand[i] !== 0 && Math.sign(inBand[i]) !== Math.sign(inBand[i - 1]) && Math.abs(inBand[i]) >= 1.5) flips++;
    return { mean: +mean.toFixed(2), absMeanPx: +absMeanPx.toFixed(2), max2d, flips,
      satFrac: +(satN / Math.max(1, totN)).toFixed(3), prof: inBand, absProf: absIn };
  };
  /* 背景是否「活的」：黑屏/纯色背景下色散恒为 0（Phase7C R1 黑帧会在 photoreal 切换期出现），
     所以每次测量前先量画面标准差，std < 6 视为黑屏 → 等，不许记 0 当成「无色散」。 */
  window.__p7d3 = { dec, edgeDisp };
  let _lv = null, _lx = null;
  window.__p7d3.live = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const cw = Math.round(bmp.width * 0.5), ch = Math.round(bmp.height * 0.6);
    if (!_lv) { _lv = document.createElement('canvas'); _lx = _lv.getContext('2d', { willReadFrequently: true }); }
    _lv.width = cw; _lv.height = ch;
    const cx = _lx;
    cx.drawImage(bmp, Math.round(bmp.width * 0.25), Math.round(bmp.height * 0.2), cw, ch, 0, 0, cw, ch);
    const d = cx.getImageData(0, 0, cw, ch).data;
    if (bmp.close) bmp.close();
    let s = 0, s2 = 0, n = 0; const uniq = new Set();
    for (let i = 0; i < d.length; i += 4) {
      const l = (d[i] + d[i + 1] + d[i + 2]) / 3; s += l; s2 += l * l; n++;
      if (uniq.size < 4000) uniq.add(d[i] << 16 | d[i + 1] << 8 | d[i + 2]);
    }
    const mean = s / n;
    return { mean: +mean.toFixed(2), std: +Math.sqrt(Math.max(0, s2 / n - mean * mean)).toFixed(2), uniq: uniq.size };
  };
});

const readCards = () => page.evaluate(() => {
  const s = window.__gevEdge.stats();
  return (s.surfaces || []).map((x) => {
    const el = document.getElementById(x.id);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { id: x.id, x: r.x, y: r.y, w: r.width, h: r.height, band: x.band };
  }).filter((c) => c && c.w > 20 && c.h > 20);
});
let cardRects = await readCards();
let bandMap = Object.fromEntries(cardRects.map((c) => [c.id, c.band]));

const pair = async (a, b, cap255) => page.evaluate(async (a, b, cards, bands, cap255) => {
  const dec = window.__p7d3.dec, f = window.__p7d3.edgeDisp;
  const A = await dec(a), B = await dec(b);
  const K = A.K; const rows = [];
  for (const cd of cards) {
    const r = { x: cd.x * K, y: cd.y * K, w: cd.w * K, h: cd.h * K };
    const band = (bands[cd.id] || 10) * K;
    const edges = { top: [r.y, 'y', 1], left: [r.x, 'x', 1], bot: [r.y + r.h, 'y', -1], right: [r.x + r.w, 'x', -1] };
    for (const [e, [ep, ax, dir]] of Object.entries(edges)) {
      const m = f(A, B, r, ep, ax, band, dir, cap255);
      rows.push({ card: cd.id, edge: e, ...m });
    }
  }
  return { K, rows };
}, a, b, cardRects, bandMap, 20);

const setCfg = (o) => page.evaluate((o) => window.__gevEdge.set(o), o);

/* 等背板变「活」（非黑/非纯色），否则色散读数恒 0 —— Phase7C R1 黑帧会持续数秒 */
const waitLive = async (maxMs = 90000, thr = 6) => {
  const t = Date.now(); const trail = [];
  while (Date.now() - t < maxMs) {
    const lv = await page.evaluate(async (b64) => window.__p7d3.live(b64), await shot());
    trail.push({ t: Date.now() - t, std: lv.std, mean: lv.mean, uniq: lv.uniq });
    if (lv.std >= thr) return { ok: true, waited: Date.now() - t, trail: trail.slice(-6) };
    await sleep(1500);
  }
  return { ok: false, waited: Date.now() - t, trail: trail.slice(-8) };
};
const med = (arr) => { const s = arr.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const measure = async (e0) => {
  const passes = [];
  for (let i = 0; i < REPS; i++) {
    const tRep = Date.now();
    await setCfg({ dispGain: 8.0, dispCap: 20 / 255, dispBandStart: e0 });
    await parkPtr(); await sleep(300);
    const a = await shot();
    await setCfg({ dispGain: 1.0 }); await sleep(420);
    const b = await shot();
    await setCfg({ dispGain: 8.0 }); await sleep(420);
    const n1 = await shot();
    const n2 = await shot();
    const p = await pair(a, b, 20);
    const nz = await pair(n1, n2, 20);
    passes.push({ rows: p.rows, noise: nz.rows, K: p.K });
    console.log(`  rep e0=${e0} #${i + 1} ${Date.now() - tRep}ms`);
  }
  const rows = passes[0].rows.map((r0, idx) => {
    const pick = (f) => passes.map((p) => f(p.rows[idx]));
    return {
      card: r0.card, edge: r0.edge,
      mean: +med(pick((r) => r.mean)).toFixed(2),
      absMean: +Math.abs(med(pick((r) => r.mean))).toFixed(2),
      absMeanPx: +med(pick((r) => r.absMeanPx)).toFixed(2),
      max2d: med(pick((r) => r.max2d)),
      flips: med(pick((r) => r.flips)),
      satFrac: +med(pick((r) => r.satFrac)).toFixed(3),
      prof: passes[0].rows[idx].prof,
      absProf: passes[0].rows[idx].absProf,
      meanAll: pick((r) => r.mean).map((x) => +x.toFixed(2)),
    };
  });
  const atJnd = rows.filter((r) => r.absMean >= 3).length;
  const avg = (a) => +(a.reduce((s, x) => s + x, 0) / a.length).toFixed(3);
  const absMeans = rows.map((r) => r.absMean);
  const live = await page.evaluate(async (b64) => window.__p7d3.live(b64), await shot());
  const absPx = rows.map((r) => r.absMeanPx);
  const noiseAbs = passes[0].noise.map((r, i) => med(passes.map((p) => Math.abs(p.noise[i].mean))));
  return {
    e0,
    edges: rows.length, atJnd, ratio: +(atJnd / rows.length).toFixed(3),
    meanAbs: avg(absMeans), maxAbs: Math.max(...absMeans),
    meanAbsPx: avg(absPx), maxAbsPx: Math.max(...absPx),
    max2d: Math.max(...rows.map((r) => r.max2d)),
    maxFlips: Math.max(...rows.map((r) => r.flips)),
    maxSatFrac: Math.max(...rows.map((r) => r.satFrac)),
    noiseMean: avg(noiseAbs),
    live,
    rows,
  };
};

const report = { at: new Date().toISOString(), base: BASE, gpu, bootMs, booted, errs: [], e0s: E0S, reps: REPS };
report.live = await waitLive();
if (!report.live.ok) console.log('WARN backdrop 仍非活（std<6）→ 读数无意义');
report.surfN = surfN;
/* 背板活了之后再采一次卡片几何（loading 期 surfaces 可能不足 9） */
cardRects = await readCards();
bandMap = Object.fromEntries(cardRects.map((c) => [c.id, c.band]));
report.cards = cardRects.map((c) => c.id);
if (cardRects.length !== 9) console.log('WARN cards', cardRects.length, '(期望 9)');

/* 冻结 Cesium 渲染循环（useDefaultRenderLoop=false）：A/B 两帧之间地图内容必须逐像素一致，
   否则风场/航班运动会被记进制散 Δ（实测未冻结时 max2d 48 vs 冻结后 ~25，噪声 10 vs ~0）。
   冻结后折射层仍由自己的 rAF 兜底重画（tick capture=false，复用已有纹理 + 当前 uniform），
   所以 A/B 只差 dispGain/dispBandStart 这一件事，口径与 phase7b-sweep 的 noise≈0 轮一致。 */
report.frozen = await page.evaluate(() => {
  const v = window.__gevViewer || (window.__godsEyeView && window.__godsEyeView.viewer);
  if (!v) return 'no-viewer';
  v.useDefaultRenderLoop = false;
  return 'frozen';
});
console.log('boot', bootMs, 'ms  cards', cardRects.length, '  backdrop', JSON.stringify(report.live), ' gpu', gpu);

/* 预热（丢弃）：首轮纹理/镜头仍在收敛 */
const warm = await measure(E0S[0]);
console.log(`warmup(discard) e0 ${warm.e0}  JND ${warm.atJnd}/${warm.edges}  meanAbs ${warm.meanAbs}  meanAbsPx ${warm.meanAbsPx}`);

report.runs = [];
for (const e0 of E0S) {
  const m = await measure(e0);
  report.runs.push(m);
  console.log(`e0 ${m.e0}  JND ${m.atJnd}/${m.edges} (${(m.ratio * 100).toFixed(0)}%)  meanAbs ${m.meanAbs}  maxAbs ${m.maxAbs}  meanAbsPx ${m.meanAbsPx}  max2d ${m.max2d}  flips ${m.maxFlips}  satFrac ${m.maxSatFrac}  noise ${m.noiseMean}`);
}

/* 逐边对照：e0=0 vs 每个候选（同一页交错 → 可比） */
const base0 = report.runs.find((r) => r.e0 === 0) || report.runs[0];
report.diff = report.runs.map((r) => ({
  e0: r.e0,
  gained: r.rows.filter((x, i) => x.absMean >= 3 && base0.rows[i].absMean < 3).map((x) => `${x.card}/${x.edge}`),
  lost: r.rows.filter((x, i) => x.absMean < 3 && base0.rows[i].absMean >= 3).map((x) => `${x.card}/${x.edge}`),
  absMeanPerEdge: Object.fromEntries(r.rows.map((x) => [`${x.card}/${x.edge}`, x.absMean])),
}));
await page.evaluate(() => {
  const v = window.__gevViewer || (window.__godsEyeView && window.__godsEyeView.viewer);
  if (v) v.useDefaultRenderLoop = true;
});
report.errs = errs.filter((e) => !/Failed to load resource|favicon/i.test(e)).slice(0, 6);
writeFileSync(`${OUT}/${TAG}-band.json`, JSON.stringify(report, null, 1));
console.log('wrote', `${OUT}/${TAG}-band.json`, 'errs', report.errs.length);
await browser.close();
