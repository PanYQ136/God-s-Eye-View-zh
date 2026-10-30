#!/usr/bin/env node
/* Phase6C2 Gate v9 —— 色散（4 边区间）+ 长帧（3 窗 + LoAF 归因）+ 冷启动就绪门
   ── v9（Phase6C3-R4，评审 Round-3 回修）──────────────────────────────────
   #1 就绪门探针口径对齐 B5：gev-boot-gate.js 的画布探针从 256×160 / 4bit 量化 /
      std≥6 / uniq≥24 提到 640×420 / 8bit / std≥18 / uniq≥800（stride 2 抽样，覆盖
      同一区域）。旧探针对「模糊粗 LOD vs 清晰影像」不敏感 —— Round-3 的 FAIL 帧
      (std 8.09 / 340 色) 与 PASS 帧的探针读数逐位相同 (21.69/76)，遮罩在粗层上就收。
      本 gate 的 B5 判据未改，只是被测对象的判据与它同口径了。
   #2 failChip 诊断修正：#global-loading-status 带 hidden，innerText 取不到 →
      改用 textContent + offsetWidth 可见性，另出 failChipVisible / failChipLabel。
   ── v8（Phase6C3-R3，评审 Round-2 回修）──────────────────────────────────
   B1：遮罩收起判据必须是「最终视角真的有影像」（画布 readPixels 探针 / tilesLoaded），
       不再是全 tileset 的 numberOfTilesWithContentReady（它含落位前太空视角瓦片，
       实测 8–10 块时画面仍是一片纯色 → 遮罩在空地图上收起）。
   B2：冷启动期所有 >100ms 长帧必须 maskOp ≥0.95（用户不可见）。**不再要求
       「至少出现一帧 >100ms」** —— 机器更快/缓存更热时一帧都没有，那是产品更好，
       门控不该假 FAIL；存在性降为 I3（INFO）。
   B5：reveal 时刻的画面必须有影像 —— 中心 640×420 的唯一色数 / 亮度 std 阈值，
       并写出 reveal+0.1/1/4/8s 的截图与像素统计（单独一次冷加载取证，
       避免截图自身的长帧污染 B3/B4 的 warm/ramp 窗）。
   B3/B4 与 v7 相同：warm 窗（ready+3…7s）/ ramp 窗（ready+7…15s）worst ≤100ms。
   T1–T14 / T1b / T3a–T3c 全部保留，阈值未放宽。
   ──────────────────────────────────────────────────────────────────────────
   ── Round-2 回修（评审 4 项），逐条对应 ───────────────────────────────────────
   #1 drawMax 250–296ms 无法归因 → lens 现在记 drawMaxAt/drawFirstMs/drawLog，并提供
      resetPeaks(label) 分段（boot / warmup / ramp / idle×3 / hover 全部保留在 JSON）。
      实测归因：v4 那 250–296ms 是验收底衬 paintTestBg 自己的开销（2px 格逐格 fillRect，
      26 万 rect/帧，drawLog 里 tex=testbg、时间戳落在 2px 条纹阶段），不是首帧 shader
      编译、也不是产品路径；已改成 2×2 pattern 平铺（<2ms/帧），并在 JSON 里留 drawLog
      作为证据。首帧 draw 实测 2.9ms（drawFirstMs vs bootAt）。
   #2 T10 单窗口不可复现（c2a 103.1 FAIL / c2b 12.2 PASS）→ 稳态跑 3 个独立 8s 窗，
      逐窗报 worst + 分布；任何 >100ms 帧用 LoAF（long-animation-frame）归因脚本来源，
      lens 自己的 drawMax/drawLog 同时记录用于交叉判定。
   #3 「vstripes」实际画的是棋盘 → lens 改三态（棋盘 / 横条纹 / 竖条纹），gate 读回底衬
      像素做 T14 自检，证明标签与实现一致。
   #4 真地图色散跨跑不稳（c2a 顶56/下66 超 45）→ 同一 gate 连测两次写进 JSON，报告披露
      离散度并声明它不作阈值判据（主判据是确定性 2px 条纹）。
   其余 C1 断言（T1–T12）阈值与 gate3 逐条一致，未放宽。

   用法: node scripts/lc/phase6c2-gate.mjs [tag]
   产物: .gev-logs/lc/phase6c2/gate4[-tag].json + 8x PNG
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] ? '-' + process.argv[2] : '';
const W = 1348, VH = 774;
const OUT = '.gev-logs/lc/phase6c2';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const rec = (name, ok, detail, skip) => {
  R.push({ name, ok: !!ok, skip: !!skip, detail });
  console.log(`${skip ? 'INFO' : ok ? 'PASS' : 'FAIL'}  ${name}${ok || skip ? '' : '  <- ' + JSON.stringify(detail).slice(0, 460)}`);
};

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
const tBoot = Date.now();
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
    && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
const tReady = Date.now();
/* Phase6C3-B/D：冷启动就绪门快照 —— 遮罩何时收、收之前发生了什么。
   longFrames 是就绪门在「未交互」阶段自己记的 >50ms 帧（含当时的遮罩不透明度），
   用来断言「所有 >100ms 长帧都发生在遮罩下」，这是本次 B 方案的唯一证据来源。 */
const boot = await page.evaluate(() => (window.__gevBoot && window.__gevBoot.snapshot ? window.__gevBoot.snapshot() : null));
const bootLF = (boot && boot.longFrames) || [];
const bootBig = bootLF.filter((f) => f.dt > 100);
const bootBigVisible = bootBig.filter((f) => f.maskOp < 0.95);
console.log('boot gate:', JSON.stringify({
  reason: boot && boot.reason,
  marks: ((boot && boot.marks) || []).map((m) => m.name + '@' + m.t),
  longOver100: bootBig.length, worst: Math.max(0, ...bootLF.map((f) => f.dt)), visibleOver100: bootBigVisible.length,
}));
await sleep(3000);
/* Phase6C2 Round-2：LoAF（Long Animation Frame）归因 —— 任何 >100ms 的稳态帧都要能说清
   「是 Cesium 的 user-callback 还是 lens 自己的 draw」。lens 自己也在 stats 里记
   drawMax/drawMaxAt/drawLog，两边对时间戳即可判定。 */
const loafErr = await page.evaluate(() => {
  window.__loaf = [];
  try {
    window.__loafOb = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__loaf.push({
          start: +e.startTime.toFixed(1), dur: +e.duration.toFixed(1), blocking: +(e.blockingDuration || 0).toFixed(1),
          renderStart: +(e.renderStart || 0).toFixed(1),
          scripts: (e.scripts || []).slice(0, 5).map((s) => ({
            url: String(s.sourceURL || '').split('/').slice(-1)[0], fn: s.functionName || '', invoker: s.invoker || '', dur: +(s.duration || 0).toFixed(1),
          })),
        });
      }
    });
    window.__loafOb.observe({ type: 'long-animation-frame', buffered: false });
    return null;
  } catch (e) { return String(e && e.message || e); }
});
const takeLoaf = () => page.evaluate(() => { const l = window.__loaf || []; window.__loaf = []; return l; });
/* 峰值分段：boot（含首帧 draw）→ warmup → ramp → steady。全部保留在 JSON 里。 */
const peaks = {};
peaks.boot = await page.evaluate(() => window.__gevEdge.resetPeaks('boot(0→ready+3s)'));
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const parkPtr = async () => { await page.mouse.move(4, 620, { steps: 3 }); await sleep(400); };

const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
rec('G0 GPU = RTX 3060（非软件渲染）', !!gpu && /RTX 3060/.test(gpu.renderer || '') && gpu.software === false,
  gpu && { renderer: gpu.renderer, software: gpu.software, tier: gpu.tier });

/* ── 帧采样内核 ───────────────────────────────────────────────────── */
const frames = (ms) => page.evaluate(async (ms) => {
  const t0 = performance.now(); const ft = []; let last = t0, worst = 0;
  await new Promise((res) => { const tick = (ts) => { const dt = ts - last; last = ts; if (dt > 0) { ft.push(dt); if (dt > worst) worst = dt; } if (ts - t0 < ms) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
  const s = ft.slice().sort((a, b) => a - b);
  return { frames: ft.length, fps: +(1000 / s[Math.floor(s.length * .5)]).toFixed(1), p50ms: +s[Math.floor(s.length * .5)].toFixed(2),
    p95ms: +s[Math.floor(s.length * .95)].toFixed(1), worstMs: +worst.toFixed(1), over60: ft.filter((v) => v > 60).length };
}, ms);

await parkPtr();
await takeLoaf();
/* warm-up 窗口：完整披露（gate3 的 T10 读数就是这个） */
const warm = await frames(4000);
peaks.warmup = await page.evaluate(() => window.__gevEdge.resetPeaks('warmup 4s @ready+3s'));
const warmLoaf = await takeLoaf();
console.log('warmup(4s @ready+3s)', JSON.stringify(warm));
/* ramp 窗口：冷启动后 Cesium 仍在流瓦片/收敛自适应分辨率；整段完整披露（不丢） */
const ramp = await frames(8000);
peaks.ramp = await page.evaluate(() => window.__gevEdge.resetPeaks('ramp 8s @ready+7s'));
const rampLoaf = await takeLoaf();
console.log('ramp(8s @ready+7s)', JSON.stringify(ramp));
/* steady-state 门控：连续 3 个 1s 窗口 worst ≤50ms 才认为稳定，最多 45s */
let settle = null, waited = 0, okN = 0, tries = [];
while (waited < 45000 && okN < 3) {
  const f = await frames(1000); tries.push(f.worstMs); waited += 1000;
  okN = f.worstMs <= 50 ? okN + 1 : 0;
  if (okN >= 3) settle = waited;
}
console.log('settle', settle, 'ms · windows', JSON.stringify(tries));
await takeLoaf();
/* ── Round-2 评审 #2：T10 不能靠「换窗口的运气」。稳态跑 3 个独立 8s 窗，
      逐窗报 worst，并把 >100ms 的帧用 LoAF 归因（同时读 lens 自己的 drawMax/drawLog
      对齐时间戳：是 lens 的 draw 还是 Cesium 的 user-callback）。 */
const idleWindows = [];
for (let wi = 0; wi < 3; wi++) {
  await page.evaluate((l) => window.__gevEdge.resetPeaks(l), 'idle#' + (wi + 1) + '(8s)');
  const f = await frames(8000);
  const loaf = (await takeLoaf()).filter((e) => e.dur >= 100);
  const lens = await page.evaluate(() => { const s = window.__gevEdge.stats(); return { drawMax: s.drawMax, drawMaxAt: s.drawMaxAt, drawLog: s.drawLog, upMax: s.upMax }; });
  idleWindows.push({ window: wi + 1, ...f, loaf, lens });
  console.log('idle#' + (wi + 1), JSON.stringify(f), '| lens drawMax', lens.drawMax, '| loaf>100', JSON.stringify(loaf));
}
const fpsIdle = {
  fps: Math.min(...idleWindows.map((w) => w.fps)),
  worstMs: Math.max(...idleWindows.map((w) => w.worstMs)),
  p95ms: Math.max(...idleWindows.map((w) => w.p95ms)),
  over60: idleWindows.reduce((a, w) => a + w.over60, 0), frames: idleWindows.reduce((a, w) => a + w.frames, 0),
  windows: idleWindows.map((w) => w.worstMs),
};
const hp = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: Math.round(b.x + 40), y: Math.round(b.y + 20) }; });
await page.mouse.move(hp.x, hp.y, { steps: 6 }); await sleep(250);
await page.evaluate(() => window.__gevEdge.resetPeaks('hover(8s)'));
const fpsHover = await frames(8000);
const hoverLens = await page.evaluate(() => { const s = window.__gevEdge.stats(); return { drawMax: s.drawMax, drawMaxAt: s.drawMaxAt, drawLog: s.drawLog, upMax: s.upMax }; });
const hoverLoaf = (await takeLoaf()).filter((e) => e.dur >= 100);
console.log('hover', JSON.stringify(fpsHover), '| lens drawMax', hoverLens.drawMax, '| loaf>100', JSON.stringify(hoverLoaf));
await parkPtr();

/* ── 打开 data-panel（真指针） ─────────────────────────────────── */
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(600);
if (await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase) !== 'open') {
  const p = await page.evaluate(() => { const b = document.getElementById('data-panel').querySelector('.panel-header').getBoundingClientRect(); return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) }; });
  await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(80); await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1200);
}
const ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
rec('C0 真指针点击展开 data-panel', ph === 'open', { phase: ph });
const canvasCount = await page.evaluate(() => document.querySelectorAll('#gev-edge-lens').length);
const surfCount = await page.evaluate(() => window.__gevEdge.stats().count);
rec('C0b 单层：1 个折射 canvas / 9 个面（一卡一面）', canvasCount === 1 && surfCount === 9, { canvasCount, surfCount });
const lensErr = await page.evaluate(() => window.__gevEdge.stats().err);
rec('C1 lens 无 shader 报错', !lensErr, { err: lensErr });
await parkPtr();

const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const band = await page.evaluate(() => (window.__gevEdge.stats().surfaces.find((s) => s.id === 'data-panel') || {}).band);
await page.evaluate(() => {
  const s = document.createElement('style'); s.id = 'pc-blank';
  s.textContent = '#data-panel > *{visibility:hidden!important}'; document.head.appendChild(s);
  const d = document.createElement('div'); d.id = 'pc-under';
  d.style.cssText = 'position:fixed;inset:0;background:#808080;z-index:1;pointer-events:none'; document.body.appendChild(d);
  window.__gevEdge.testChecker(true, 8, 0);
});
await sleep(1600); await parkPtr();

await page.evaluate(() => {
  const dec = async (b64) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
  };
  const peaksOf = (prof, n) => { let c = 0; for (let i = 0; i < n; i++) { const l = i === 0 ? -1e9 : prof[i - 1], rr = i === n - 1 ? -1e9 : prof[i + 1]; if (prof[i] > 3 && prof[i] >= l && prof[i] > rr) c++; } return c; };
  const metrics = (A, B, rect, edgePx, axis, bandCss, dir) => {
    dir = dir || 1;
    const x0 = Math.round(rect.x + rect.w * 0.3), x1 = Math.round(rect.x + rect.w * 0.7);
    const y0 = Math.round(rect.y + rect.h * 0.3), y1 = Math.round(rect.y + rect.h * 0.7);
    const edge = Math.round(edgePx), prof = [], dprof = [], absA = [], absB = [];
    for (let k = 0; k <= 12; k++) {
      const aa = edge + k * dir; let s = 0, n = 0, chd = 0, la = 0, lb = 0;
      for (let t = Math.max(0, Math.min(aa, aa + dir)); t < Math.min(axis === 'y' ? A.h : A.w, Math.max(aa, aa + dir)); t++) {
        for (let u = axis === 'y' ? x0 : y0; u < Math.min(axis === 'y' ? x1 : y1, axis === 'y' ? A.w : A.h); u++) {
          const i = axis === 'y' ? (t * A.w + u) * 4 : (u * A.w + t) * 4;
          const dr = A.d[i] - B.d[i], dg = A.d[i + 1] - B.d[i + 1], db = A.d[i + 2] - B.d[i + 2];
          s += Math.abs(0.2126 * dr + 0.7152 * dg + 0.0722 * db); n++;
          chd = Math.max(chd, Math.abs(dr - db));
          la += 0.2126 * A.d[i] + 0.7152 * A.d[i + 1] + 0.0722 * A.d[i + 2];
          lb += 0.2126 * B.d[i] + 0.7152 * B.d[i + 1] + 0.0722 * B.d[i + 2];
        }
      }
      prof.push(n ? +(s / n).toFixed(2) : 0); dprof.push(chd);
      absA.push(n ? +(la / n).toFixed(2) : 0);
      absB.push(n ? +(lb / n).toFixed(2) : 0);
    }
    const bd = Math.round(bandCss);
    let peak = 0, peakK = -1;
    for (let k = 0; k < bd; k++) if (prof[k] > peak) { peak = prof[k]; peakK = k; }
    const bs = prof.slice(1, Math.min(9, prof.length));
    let cMax = 0, cSum = 0, cN = 0;
    for (let yy = Math.round(rect.y + rect.h * 0.4); yy < Math.round(rect.y + rect.h * 0.6); yy++) {
      for (let xx = Math.round(rect.x + rect.w * 0.35); xx < Math.round(rect.x + rect.w * 0.65); xx++) {
        const i = (yy * A.w + xx) * 4;
        cMax = Math.max(cMax, Math.abs(A.d[i] - B.d[i]), Math.abs(A.d[i + 1] - B.d[i + 1]), Math.abs(A.d[i + 2] - B.d[i + 2]));
        cSum += Math.abs(0.2126 * (A.d[i] - B.d[i]) + 0.7152 * (A.d[i + 1] - B.d[i + 1]) + 0.0722 * (A.d[i + 2] - B.d[i + 2])); cN++;
      }
    }
    /* ── 单带判据（Phase6C1b 口径，本轮从 gate3-v3 原样接回，阈值不放宽）──────
       ① absPeaks：渲染绝对亮度剖面（有镜头时的真实亮度，跨卡宽 30–70% 取均值，3 抽平滑，
          凸起 ≥4 灰阶才计数）——抓「第二条高光/白带」这类加亮度型第二圈。
       ② ridgePeaks：on/off 对比剖面的**可见谱线**条数——平台/阶梯按 1% 主峰容差并成一条脊，
          脊高需 ≥ 主峰 45%（带外缘 1px 的 ~19 灰阶肩部 = 33% 不算第二条线）。
       灵敏度由 T3c 负控（注入 2px/0.35 白第二圈）验证，避免「看不见即通过」。 */
    const ap = absA.slice(0, bd);
    const sm = ap.map((v, i) => +(((ap[Math.max(0, i - 1)] + v + ap[Math.min(ap.length - 1, i + 1)]) / 3)).toFixed(2));
    const apMin = Math.min(...sm);
    const ABS_PROM = 4;
    let absPeaks = 0; const absMaxK = [];
    for (let i = 0; i < sm.length; i++) {
      const l = i === 0 ? -1e9 : sm[i - 1], rr = i === sm.length - 1 ? -1e9 : sm[i + 1];
      if (sm[i] >= l && sm[i] > rr && sm[i] - apMin >= ABS_PROM) { absPeaks++; absMaxK.push(i); }
    }
    const RIDGE_REL = 0.45;
    const ridgeOf = (p, n, rel) => {
      const mx = Math.max(...p.slice(0, n));
      const tol = Math.max(0.5, mx * 0.01), thr = mx * rel;
      const at = []; let i = 0;
      while (i < n) {
        let j = i;
        while (j + 1 < n && Math.abs(p[j + 1] - p[i]) <= tol) j++;
        const left = i === 0 ? -1e9 : p[i - 1], right = j === n - 1 ? -1e9 : p[j + 1];
        if (p[i] >= left && p[i] > right && p[i] >= thr) at.push(i);
        i = j + 1;
      }
      return { count: at.length, at, thr: +thr.toFixed(2) };
    };
    const rg = ridgeOf(prof, bd, RIDGE_REL);
    return { peak, peakK, peaks: peaksOf(prof, bd), ridgePeaks: rg.count, ridgeAt: rg.at, ridgeThr: rg.thr,
      bandMean: +(bs.reduce((a, b) => a + b, 0) / (bs.length || 1)).toFixed(2), prof, dprof,
      absProf: ap, absSm: sm, absPeaks, absMaxK, absProm: ABS_PROM, absMin: apMin,
      centerMax: cMax, centerMean: +(cSum / Math.max(1, cN)).toFixed(2), centerN: cN };
  };
  /* 2D band 区域 max|ΔR−ΔB|（色散专用：位移方向沿边法线，单行剖面会漏） */
  const disp2D = (A, B, rect, bandD) => {
    const band = Math.round(bandD);
    /* 坐标必须取整：截图是 device px（K=1.25），rS 是小数；用小数索引 data[] 会读到 undefined → NaN → 假 0/1 */
    rect = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) };
    const scan = (xs, xe, ys, ye) => {
      let mx = 0, pk = null;
      for (let y = Math.max(0, ys); y < ye && y < A.h; y++) for (let x = Math.max(0, xs); x < xe && x < A.w; x++) {
        const i = (y * A.w + x) * 4; const v = Math.abs((A.d[i] - B.d[i]) - (A.d[i + 2] - B.d[i + 2]));
        if (v > mx) { mx = v; pk = [x, y]; }
      }
      return { max: mx, at: pk };
    };
    const bx0 = Math.round(rect.x + rect.w * 0.3), bx1 = Math.round(rect.x + rect.w * 0.7);
    const by0 = Math.round(rect.y + rect.h * 0.3), by1 = Math.round(rect.y + rect.h * 0.7);
    return {
      top: scan(bx0, bx1, rect.y, rect.y + band), bot: scan(bx0, bx1, rect.y + rect.h - band, rect.y + rect.h),
      left: scan(rect.x, rect.x + band, by0, by1), right: scan(rect.x + rect.w - band, rect.x + rect.w, by0, by1),
    };
  };
  window.__pc = { dec, metrics, disp2D };
});

const K = await page.evaluate(async (b64) => (await window.__pc.dec(b64)).w / innerWidth, await shot());
const rS = { x: r.x * K, y: r.y * K, w: r.w * K, h: r.h * K };
const bandS = band * K;
const env = await page.evaluate(() => ({ dpr: devicePixelRatio, innerW: innerWidth, innerH: innerHeight, lens: window.__gevEdge.stats().scale, canvas: window.__gevEdge.stats().canvas, bandAlpha: window.__gevEdge.cfg().bandAlpha, dispPx: window.__gevEdge.cfg().dispPx, pdb: window.__gevEdge.stats().pdb }));
console.log('ENV', JSON.stringify(env), 'K =', K);

const pair = async () => {
  const on = await shot();
  await page.evaluate(() => window.__gevEdge.off()); await sleep(650);
  const off = await shot();
  await page.evaluate(() => window.__gevEdge.on()); await sleep(750);
  return { on, off };
};

/* ── A) 8px 棋盘（C1 主判据：可见度/单峰/中心） ─────────────────── */
const p1 = await pair();
const A = await page.evaluate(async (on, off, r, band) => {
  const A = await window.__pc.dec(on), B = await window.__pc.dec(off);
  return {
    top: window.__pc.metrics(A, B, r, r.y, 'y', band, 1),
    left: window.__pc.metrics(A, B, r, r.x, 'x', band, 1),
    bot: window.__pc.metrics(A, B, r, r.y + r.h, 'y', band, -1),
    right: window.__pc.metrics(A, B, r, r.x + r.w, 'x', band, -1),
    disp: window.__pc.disp2D(A, B, r, band),
  };
}, p1.on, p1.off, rS, bandS);
const Aon1 = p1.on;
await sleep(500);
const Aon2 = await shot();          // 同状态连拍（噪声底）
const Anoise = await page.evaluate(async (a, b, r, band) => {
  const A = await window.__pc.dec(a), B = await window.__pc.dec(b);
  return { top: window.__pc.metrics(A, B, r, r.y, 'y', band, 1), left: window.__pc.metrics(A, B, r, r.x, 'x', band, 1) };
}, Aon2, Aon1, rS, bandS);

/* ── A2) 负控（T3c）：注入一条真实强度的合成第二圈 ────────────────
   Phase6C3 回补：C2 gate v5 丢掉了 C1b 已有的这条负控，导致 T3「≤1」无法区分
   「真的只有一条」和「判据根本看不见第二条」。这里原样接回 C1b/gate3-v3 的实现：
   顶沿内侧 7px、2px 高、0.35 白，与 A_off（有底衬、无镜头、无第二圈）对比，
   剖面必须出现 2 条脊（ridgePeaks ≥2 或 absPeaks ≥2）。 */
await page.evaluate((r) => {
  const d = document.createElement('div'); d.id = 'pc-ring2';
  d.style.cssText = `position:fixed;left:${r.x + 8}px;top:${r.y + 7}px;width:${r.w - 16}px;height:2px;`
    + 'background:rgba(255,255,255,0.35);z-index:9999;pointer-events:none';
  document.body.appendChild(d);
}, r);
await sleep(450);
const Qon = await shot();
await page.evaluate(() => { const d = document.getElementById('pc-ring2'); if (d) d.remove(); });
const CTL = await page.evaluate(async (on, off, r, band) => {
  const A = await window.__pc.dec(on), B = await window.__pc.dec(off);
  return {
    top: window.__pc.metrics(A, B, r, r.y, 'y', band, 1),
    left: window.__pc.metrics(A, B, r, r.x, 'x', band, 1),
    bot: window.__pc.metrics(A, B, r, r.y + r.h, 'y', band, -1),
    right: window.__pc.metrics(A, B, r, r.x + r.w, 'x', band, -1),
  };
}, Qon, p1.off, rS, bandS);
writeFileSync(`${OUT}/gate4${TAG}-Q-negctl-ring2-1x.png`, Buffer.from(Qon, 'base64'));
await sleep(400);

/* ── A3) hover 态光学对照（T1b / T3b）────────────────────────────
   Phase6C3 回补：hover 态必须与非 hover 走同一条判据，不能只报非 hover 读数。
   真指针移到 data-panel 卡头中心（不是合成事件），同一棋盘、同一仪器。 */
const hpHover = await page.evaluate(() => {
  const b = document.getElementById('data-panel').querySelector('.panel-header').getBoundingClientRect();
  return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
});
await page.mouse.move(hpHover.x, hpHover.y, { steps: 5 });
await sleep(800);
const Hon = await shot();
await page.evaluate(() => window.__gevEdge.off());
await sleep(650);
const Hoff = await shot();
await page.evaluate(() => window.__gevEdge.on());
await sleep(850);
const H = await page.evaluate(async (on, off, r, band) => {
  const A = await window.__pc.dec(on), B = await window.__pc.dec(off);
  return {
    top: window.__pc.metrics(A, B, r, r.y, 'y', band, 1),
    left: window.__pc.metrics(A, B, r, r.x, 'x', band, 1),
    bot: window.__pc.metrics(A, B, r, r.y + r.h, 'y', band, -1),
    right: window.__pc.metrics(A, B, r, r.x + r.w, 'x', band, -1),
  };
}, Hon, Hoff, rS, bandS);
await parkPtr();   /* 必须把指针移出卡外，否则后续 8x 截图/条纹测量都在 hover 态下拍 */
await sleep(700);

/* ── B) 2px 高频条纹（色散主判据：与通道间距同尺度） ───────────── */
const DISP = {};
const STRIPE_SELF = {};
for (const [name, axis] of [['hstripes', 1], ['vstripes', 0]]) {
  const stripeCfg = await page.evaluate((ax) => window.__gevEdge.testStripes(ax, 2), axis);
  await sleep(1400); await parkPtr();
  /* 仪器自检（Round-2 评审 #3）：读回底衬像素，证明「标签 ↔ 实际条纹方向」一致。
     竖条纹 = 同 x 不同 y 同色、相邻列异色；横条纹 = 同 y 相邻 x 同色、相邻行异色。 */
  STRIPE_SELF[name] = await page.evaluate(() => {
    const px = (x, y) => window.__gevEdge.probeTestBg(x, y);
    /* a=(100.5,300) 基准；b 只改 y(+2 行)，c 只改 x(+2 列)。
       横条纹：a==c（同行任意 x 同色）且 a!=b（相邻行异色）
       竖条纹：a==b（同列任意 y 同色）且 a!=c（相邻列异色） */
    const a = px(100.5, 300), b = px(100.5, 302), c = px(102.5, 300);
    const eq = (p, q) => Array.isArray(p) && Array.isArray(q) && p.join() === q.join();
    return { mode: window.__gevEdge.cfg().testBgMode,
      probe: { base_a: a, nextRow_b: b, nextCol_c: c },
      sameCol_diffRow: eq(a, b), sameRow_diffCol: eq(a, c) };
  });
  STRIPE_SELF[name].cfg = stripeCfg;
  const { on, off } = await pair();
  DISP[name] = await page.evaluate(async (on, off, r, band) => {
    const A = await window.__pc.dec(on), B = await window.__pc.dec(off);
    return window.__pc.disp2D(A, B, r, band);
  }, on, off, rS, bandS);
  if (name === 'hstripes') writeFileSync(`${OUT}/gate4${TAG}-A-2px-hstripes-on-1x.png`, Buffer.from(on, 'base64'));
  else writeFileSync(`${OUT}/gate4${TAG}-A-2px-vstripes-on-1x.png`, Buffer.from(on, 'base64'));
}
const dispTop = DISP.hstripes.top.max, dispBot = DISP.hstripes.bot.max;
const dispLeft = DISP.vstripes.left.max, dispRight = DISP.vstripes.right.max;

/* ── C) 真地图（交叉验证，不冻结） ───────────────────────────────
   Round-2 评审 #4：真地图的色散读数跨跑不稳（c2a 顶 56/下 66 已超 45，c2b 13/8），
   因为它取决于地下那块纹理的局部梯度（内容相关），不是确定性仪器。现在同一份 gate
   里连测两次，把两次都写进 JSON（真实离散度），并且在报告里如实说明它不作阈值判据。 */
await page.evaluate(() => { window.__gevEdge.testChecker(false, 8); const d = document.getElementById('pc-under'); if (d) d.remove(); });
await sleep(1600); await parkPtr();
const okMap = async () => { const { on, off } = await pair(); return page.evaluate(async (on, off, r, band) => {
  const A = await window.__pc.dec(on), B = await window.__pc.dec(off);
  return { top: window.__pc.metrics(A, B, r, r.y, 'y', band, 1), left: window.__pc.metrics(A, B, r, r.x, 'x', band, 1),
    bot: window.__pc.metrics(A, B, r, r.y + r.h, 'y', band, -1), right: window.__pc.metrics(A, B, r, r.x + r.w, 'x', band, -1),
    disp: window.__pc.disp2D(A, B, r, band) };
}, on, off, rS, bandS); };
const C = await okMap();
await sleep(2000); await parkPtr();
const C2 = await okMap();
const realmapSpread = {
  byEdge: {
    top: [C.disp.top.max, C2.disp.top.max], bot: [C.disp.bot.max, C2.disp.bot.max],
    left: [C.disp.left.max, C2.disp.left.max], right: [C.disp.right.max, C2.disp.right.max],
  },
  note: '真地图色散是内容相关量（取决于地下纹理沿法线的局部梯度），不是确定性阈值判据；主判据是 2px 条纹。',
};

/* ── D) 8x 截图（棋盘态，A_on1） ───────────────────────────────── */
await page.evaluate(() => { window.__gevEdge.testChecker(true, 8, 0); });
await sleep(1200); await parkPtr();
const shot8 = await shot();
const crops = await page.evaluate(async (b64, rect) => {
  const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  const out = {};
  const box = (name, x, y, w, h) => {
    const cv = document.createElement('canvas'); cv.width = Math.round(w * 8); cv.height = Math.round(h * 8);
    const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false;
    cx.drawImage(bmp, Math.round(x), Math.round(y), Math.round(w), Math.round(h), 0, 0, cv.width, cv.height);
    out[name] = cv.toDataURL('image/png');
  };
  const s = rect.w / 320, cw = 44 * s, ch = 36 * s;
  box('tl', rect.x - 4 * s, rect.y - 4 * s, cw, ch);
  box('tr', rect.x + rect.w - 40 * s, rect.y - 4 * s, cw, ch);
  box('bl', rect.x - 4 * s, rect.y + rect.h - 32 * s, cw, ch);
  box('br', rect.x + rect.w - 40 * s, rect.y + rect.h - 32 * s, cw, ch);
  box('top', rect.x + rect.w * 0.5 - 22 * s, rect.y - 6 * s, 44 * s, 34 * s);
  box('left', rect.x - 4 * s, rect.y + rect.h * 0.5 - 18 * s, cw, 36 * s);
  return out;
}, shot8, rS);
for (const k of Object.keys(crops)) writeFileSync(`${OUT}/gate4${TAG}-A-${k}-8x.png`, Buffer.from(String(crops[k]).split(',')[1], 'base64'));

/* ── E) 结构 + 收尾 ───────────────────────────────────────────── */
const style = await page.evaluate(() => {
  const el = document.getElementById('data-panel'); const cs = getComputedStyle(el);
  const inner = [...el.querySelectorAll('*')].filter((x) => { const s = getComputedStyle(x); return s.backdropFilter && s.backdropFilter !== 'none'; });
  return { bg: cs.backgroundColor, bf: cs.backdropFilter, border: cs.borderTopWidth, outline: cs.outlineWidth, filter: cs.filter, innerBackdrop: inner.length, shadowLayers: (cs.boxShadow || 'none') };
});
await page.evaluate(() => { const s = document.getElementById('pc-blank'); if (s) s.remove(); });
const edgeStats = await page.evaluate(() => { const s = window.__gevEdge.stats(); return {
  fps: s.fps, drawFps: s.drawFps, drawP50: s.drawP50, drawP95: s.drawP95, frames: s.frames, drawN: s.drawN, err: s.err,
  drawMax: s.drawMax, drawMaxAt: s.drawMaxAt, drawFirstMs: s.drawFirstMs, drawLog: s.drawLog,
  upMax: s.upMax, upMaxAt: s.upMaxAt,
  peakWindows: s.peakWindows, bootAt: s.bootAt, pdb: s.pdb, dispPx: s.dispPx }; });
const noiseMax = Math.max(...Anoise.top.prof.slice(0, 10), ...Anoise.left.prof.slice(0, 10));
const centerMax = Math.max(A.top.centerMax, A.left.centerMax, A.bot.centerMax, A.right.centerMax);

/* ── F) 断言 ──────────────────────────────────────────────────── */
rec('T1 顶沿峰值 ≥30（8px 棋盘、非 hover、未冻结）', A.top.peak >= 30 && A.top.peakK <= 4, { peak: A.top.peak, peakK: A.top.peakK, prof: A.top.prof });
rec('T2 顶沿 band 1–8px Δ 均值 ≥8', A.top.bandMean >= 8, { bandMean: A.top.bandMean });
rec('T3 单峰（平台合并后 ≤1）', A.top.peaks <= 1, { peaks: A.top.peaks, prof: A.top.prof.slice(0, 10) });
/* ── Phase6C3 回补：C1b 已有的三条视觉断言（v5 丢了，导致门控覆盖缩水）──────────
   RDG/ABS 双口径：① ridgePeaks = on/off 对比剖面的可见谱线脊数（平台并脊、45% 主峰门槛）；
   ② absPeaks = 渲染绝对亮度剖面的凸起脊数（抓加亮度型第二圈）。阈值与 gate3-v3 逐条一致。 */
const RDG = (m) => m.ridgePeaks <= 1, ABS = (m) => m.absPeaks <= 1;
rec('T3a 四边单带（脊数 ≤1：对比剖面可见谱线 + 绝对亮度剖面双口径）',
  RDG(A.top) && RDG(A.left) && RDG(A.bot) && RDG(A.right) && ABS(A.top) && ABS(A.left) && ABS(A.bot) && ABS(A.right),
  { ridgePeaks: { top: A.top.ridgePeaks, left: A.left.ridgePeaks, bot: A.bot.ridgePeaks, right: A.right.ridgePeaks },
    ridgeAt: { top: A.top.ridgeAt, left: A.left.ridgeAt, bot: A.bot.ridgeAt, right: A.right.ridgeAt },
    ridgeThr: { top: A.top.ridgeThr, left: A.left.ridgeThr, bot: A.bot.ridgeThr, right: A.right.ridgeThr },
    absPeaks: { top: A.top.absPeaks, left: A.left.absPeaks, bot: A.bot.absPeaks, right: A.right.absPeaks },
    absSm: { top: A.top.absSm, left: A.left.absSm, bot: A.bot.absSm, right: A.right.absSm },
    deltaPeaks_refOnly: { top: A.top.peaks, left: A.left.peaks, bot: A.bot.peaks, right: A.right.peaks } });
rec('T3c 负控：注入合成第二圈后顶沿脊数必须 ≥2（证明 T3 判据看得见第二圈）',
  CTL.top.ridgePeaks >= 2 || CTL.top.absPeaks >= 2,
  { ridgePeaks: CTL.top.ridgePeaks, ridgeAt: CTL.top.ridgeAt, absPeaks: CTL.top.absPeaks, absMaxK: CTL.top.absMaxK, prof: CTL.top.prof.slice(0, 12) });
rec('T1b hover 态顶沿峰值 ≥30（与 T1 同口径；C1b 起为硬判据）',
  H.top.peak >= 30 && H.top.peakK <= 4,
  { peak: H.top.peak, peakK: H.top.peakK, nohover: A.top.peak, prof: H.top.prof });
rec('T3b hover 态四边单带（同一双口径；hover 时卡内不得出现第二圈高光）',
  RDG(H.top) && RDG(H.left) && RDG(H.bot) && RDG(H.right) && ABS(H.top) && ABS(H.left) && ABS(H.bot) && ABS(H.right),
  { ridgePeaks: { top: H.top.ridgePeaks, left: H.left.ridgePeaks, bot: H.bot.ridgePeaks, right: H.right.ridgePeaks },
    absPeaks: { top: H.top.absPeaks, left: H.left.absPeaks, bot: H.bot.absPeaks, right: H.right.absPeaks },
    absSm: { top: H.top.absSm, left: H.left.absSm, bot: H.bot.absSm, right: H.right.absSm } });
rec('T4 四边都有折射（峰值 >0）', A.top.peak > 0 && A.left.peak > 0 && A.bot.peak > 0 && A.right.peak > 0,
  { top: A.top.peak, left: A.left.peak, bot: A.bot.peak, right: A.right.peak });
const CENTER_TOL = 1;
rec(`T5 中心无污染（中心 Δ max ≤ ${CENTER_TOL}）`, centerMax <= CENTER_TOL, { centerMax, noiseMax });
rec('T6 确定性噪声 ≤1（棋盘态连拍）', noiseMax <= 1, { noiseMax });
rec('T7 单层玻璃：0 border / 0 outline / 0 backdrop-filter / 卡内 0 第二层',
  style.border === '0px' && style.outline === '0px' && (!style.bf || style.bf === 'none') && style.innerBackdrop === 0, style);
rec('T8 FPS ≥50（idle，rAF p50）', fpsIdle.fps >= 50, fpsIdle);
rec('T9 FPS ≥50（hover）', fpsHover.fps >= 50, fpsHover);
rec('T10 无长帧冻结（稳态 3×8s idle + 8s hover，worst ≤100ms，逐窗披露）',
  fpsIdle.worstMs <= 100 && fpsHover.worstMs <= 100,
  { idleWindows: idleWindows.map((w) => ({ n: w.window, worst: w.worstMs, p95: w.p95ms, fps: w.fps, over60: w.over60, lens: w.lens.drawMax, loaf: w.loaf })), idleWorst: fpsIdle.worstMs, hoverWorst: fpsHover.worstMs, hoverLoaf, hoverLens });
/* ── Phase6C3-B/D：冷启动 ramp 长帧（本卡主交付）──────────────────────────
   B1 遮罩口径：就绪门必须在「3D Tiles 首批内容 + 相机落位 + 瓦片静默」之后才收；
   B2 覆盖：冷启动期所有 >100ms 长帧都发生在遮罩不透明度 ≥0.95 之下（用户不可见）；
   B3 进入后 warm 窗（ready+3…+7s）worst ≤100ms 且 fps ≥50；
   B4 进入后 ramp 窗（ready+7…+15s）worst ≤100ms —— 从 v6 的 INFO 升为硬断言。 */
const settledReason = String((boot && boot.reason) || '');
const bootContentOk = !!boot && (boot.viewContentAt != null || boot.tilesLoadedAt != null);
rec('B1 冷启动就绪门：遮罩在「最终视角真的有影像」（画布内容探针 / tilesLoaded）+ 相机落位之后才收（非超时兜底）',
  !!boot && /^(view-content|tiles-loaded)$/.test(settledReason) && boot.tilesetAt != null
  && boot.cineDoneAt != null && boot.interactiveAt != null && bootContentOk,
  { reason: settledReason, viewContentOk: bootContentOk,
    viewContentAt: boot && boot.viewContentAt, tilesLoadedAt: boot && boot.tilesLoadedAt,
    probeAtReveal: boot && boot.probeAtReveal,
    marks: (boot && boot.marks || []).map((m) => m.name + '@' + m.t),
    tilesetAt: boot && boot.tilesetAt, firstContentAt: boot && boot.firstContentAt,
    cineDoneAt: boot && boot.cineDoneAt, settledAt: boot && boot.settledAt, interactiveAt: boot && boot.interactiveAt });
rec('B2 冷启动期 >100ms 长帧全部发生在遮罩下（maskOp ≥0.95 → 用户不可见）',
  !!boot && bootBigVisible.length === 0,
  { longOver100: bootBig.slice(0, 12), totalOver50: bootLF.length, worst: Math.max(0, ...bootLF.map((f) => f.dt)), visible: bootBigVisible });
rec('I3 冷启动 >100ms 长帧存在性（仅 INFO：更快的机器/热缓存可能一帧都没有，不作判据）', true,
  { longOver100: bootBig.length, worst: Math.max(0, ...bootLF.map((f) => f.dt)), visibleOver100: bootBigVisible.length }, true);
rec('B3 进入后 warm 窗（ready+3…+7s）worst ≤100ms 且 fps ≥50', warm.worstMs <= 100 && warm.fps >= 50, { warm });
rec('B4 进入后 ramp 窗（ready+7…+15s）worst ≤100ms（硬断言，不再是 INFO）', ramp.worstMs <= 100,
  { ramp, loafOver100: rampLoaf.filter((e) => e.dur >= 100) });
rec('T11 真地图（未冻结）四边仍有 Δ', C.top.peak > 0 && C.left.peak > 0 && C.bot.peak > 0 && C.right.peak > 0,
  { top: C.top.peak, left: C.left.peak, bot: C.bot.peak, right: C.right.peak });
rec('T12 渲染无 JS 报错', errs.filter((e) => !/Failed to load resource|favicon/i.test(e)).length === 0, errs.slice(0, 4));
/* 色散（C2 主判据）：2px 高频底衬、逐边对齐条纹方向、band 区域 2D max */
const dispOk = (v) => v >= 6 && v <= 45;
rec(`T13 色散 6–45（顶 ${dispTop}/下 ${dispBot}/左 ${dispLeft}/右 ${dispRight}，2px 条纹）`,
  dispOk(dispTop) && dispOk(dispBot) && dispOk(dispLeft) && dispOk(dispRight),
  { top: dispTop, bot: dispBot, left: dispLeft, right: dispRight, range: [6, 45], detail: DISP });
/* 仪器自检（Round-2 评审 #3）：标签与实现一致 —— 读回底衬像素验证条纹方向 */
const selfH = STRIPE_SELF.hstripes, selfV = STRIPE_SELF.vstripes;
rec('T14 仪器自检：hstripes/vstripes 标签 ↔ 实际条纹方向一致',
  !!selfH && !!selfV && selfH.sameRow_diffCol === true && selfH.sameCol_diffRow === false
  && selfV.sameCol_diffRow === true && selfV.sameRow_diffCol === false && selfH.cfg.mode === 1 && selfV.cfg.mode === 2,
  { hstripes: selfH, vstripes: selfV });
rec('I1 色散对照：8px 棋盘 / 真地图（口径外，仅记录）', true,
  { checker8: A.disp, realmap: C.disp, realmap2: C2.disp, realmapSpread, note: '8px 棋盘对 0.40px 通道间距是瞎的；真地图梯度更缓且内容相关（跨跑不稳，不作判据）' }, true);
rec('I2 warm-up/ramp 期最差帧 + lens 自记峰值（完整披露，不隐藏）', true,
  { warmup4s: warm, ramp8s: ramp, settleMs: settle, bootPeak: peaks.boot, warmPeak: peaks.warmup, rampPeak: peaks.ramp,
    warmLoaf, rampLoaf, loafErr, bootGate: boot && { reason: boot.reason, marks: boot.marks, longFrames: boot.longFrames } }, true);

/* ── V) reveal 证据（Round-2 回修 ②）：第二次冷加载，在遮罩收起时刻取证 ──────────
   为什么单独一次加载：截图本身会往帧里注入 100–280ms 的长帧（评审 Round-2 实测），
   放在主跑里会污染 B3/B4 的 warm/ramp 窗。这里关掉 HTTP 缓存重新加载，
   既拿到 reveal+0.1/1/4/8s 的截图与像素统计，又顺手复验一次冷启动就绪门。 */
const errsBeforeV = errs.length;
await cdp.send('Network.enable').catch(() => {});
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {});
/* 标记：新文档里读不到它 —— 防止 reload 期间读到旧 execution context 的 interactive */
await page.evaluate(() => { window.__gateReloadMarker = 1; }).catch(() => {});
const tV = Date.now();
await page.reload({ waitUntil: 'load', timeout: 240000 });
let revealAt = null;
for (let i = 0; i < 4000; i++) {
  const r = await page.evaluate(() => {
    const b = window.__gevBoot && window.__gevBoot.snapshot ? window.__gevBoot.snapshot() : null;
    return { fresh: window.__gateReloadMarker === undefined, interactive: !!(b && b.interactiveAt != null) };
  }).catch(() => null);
  if (r && r.fresh && r.interactive) { revealAt = Date.now(); break; }
  await sleep(40);
}
console.log('V) reveal at +' + (revealAt ? revealAt - tV : -1) + 'ms (reload)');
const bootV = await page.evaluate(() => (window.__gevBoot && window.__gevBoot.snapshot ? window.__gevBoot.snapshot() : null));
/* 每个取样点附带页内状态：瓦片统计 / globe.show / LOAD FAILED 芯片 —— 让「空白」可归因 */
const viewState = () => page.evaluate(() => {
  const v = window.__gevViewer;
  let ts = null;
  try { const p = v.scene.primitives; for (let k = 0; k < p.length; k++) { const q = p.get(k); if (q && q.initialTilesLoaded) ts = q; } } catch (e) {}
  const st = ts && ts.statistics;
  /* 芯片诊断（v10 修正，Round-4 非阻塞项）：v9 用 `offsetWidth>0` 判「看得见」，
     但 #global-loading-status 走 split-flap：状态机 hidden=false 时字节点被翻页字
     (`.gev-flap-cells` 的 data-flap-next) 覆盖，而 gev-cn 只译文本节点 →
     **画面上是英文、textContent 是中文**，且两者都不等于 offsetWidth。
     v10 一次给全四个口径：状态机(hidden/state) / 布局(offsetW/rect) / 翻页字字形 /
     命中栈(芯片真在视口那个位置就会被 elementsFromPoint 命中)。
     另：v9 在 pxStats（页内 257ms 级别的像素统计）之后才读 DOM，芯片可见窗可能
     只有 0.25–5.2s（实测），读数会错过 → v10 截图后**立刻**读一次，pxStats 后再读一次，
     两个时刻都留档。 */
  const chip = document.getElementById('global-loading-status');
  const label = document.getElementById('global-loading-label');
  const chipText = chip ? String(chip.textContent || '').trim().slice(0, 60) : '';
  const chipVisible = !!(chip && chip.offsetWidth > 0 && chip.offsetHeight > 0
    && getComputedStyle(chip).visibility !== 'hidden');
  let chipSnap = { failChipMissing: true };
  if (chip && label) {
    const cs = getComputedStyle(chip);
    const host = label.querySelector('.gev-flap-cells');
    const cells = host ? [...host.children].map((c) => c.dataset.flapNext || '') : [];
    const r = chip.getBoundingClientRect();
    chipSnap = {
      failChipState: chip.dataset.state || null,
      failChipHidden: chip.hidden,
      failChipDisplay: cs.display,
      failChipOffsetW: chip.offsetWidth,
      failChipRect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      failChipText: String(label.textContent || '').trim().slice(0, 40),
      failChipPaintedCells: cells.join('').trim().slice(0, 40),
      failChipAtPoint: document.elementsFromPoint(Math.round(innerWidth / 2), 83).slice(0, 3)
        .map((el) => el.id || el.tagName.toLowerCase()).join(','),
      /* 状态机口径（= 产品自己认为看不看得见） */
      failChipVisible: !chip.hidden && cs.display !== 'none',
      /* 旧的布局口径，留档对比 */
      failChipVisibleLayout: chipVisible,
    };
  }
  let layerErrors = null;
  try {
    const dm = window.__godsEyeView && window.__godsEyeView.dataManager;
    const list = dm && dm.layers && dm.layers.values ? [...dm.layers.values()] : [];
    const on = list.filter((l) => l.enabled || l.error || l.keyRequired);
    if (on.length) layerErrors = on.map((l) => ({ id: l.id, enabled: !!l.enabled, err: l.error ? String(l.error).slice(0, 60) : null, key: l.keyRequired || null }));
  } catch (e) {}
  return { tilesLoaded: ts ? !!ts.tilesLoaded : null, contentReady: st && st.numberOfTilesWithContentReady,
    pending: st && st.numberOfPendingRequests, globeShow: v && v.scene && v.scene.globe ? v.scene.globe.show : null,
    failChip: /LOAD FAILED|加载失败/i.test((document.documentElement.textContent || '') + ' ' + chipText),
    failChipVisible: chipVisible, failChipLabel: chipText, ...chipSnap, failChipLayerErrors: layerErrors };
});
const pxStats = async (b64) => page.evaluate(async (b64) => {
  const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  const w = Math.min(640, bmp.width), h = Math.min(420, bmp.height);
  const x = Math.max(0, Math.round((bmp.width - w) / 2)), y = Math.max(0, Math.round((bmp.height - h) / 2));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, x, y, w, h, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;
  let sum = 0, sum2 = 0, n = 0; const uniq = new Set();
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p += 1) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    lum[p] = l;
    sum += l; sum2 += l * l; n += 1;
    uniq.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  }
  /* 锐度（INFO，不作判据）：拉普拉斯绝对均值 —— 空白/重度模糊 ≈0.2，低清可辨 ≈6，
     完全清晰 ≈12–17。用来把「B5 过没过」翻译成可读的清晰度数字。 */
  let lapSum = 0, lapN = 0;
  for (let yy = 1; yy < h - 1; yy += 1) {
    for (let xx = 1; xx < w - 1; xx += 1) {
      const p = yy * w + xx;
      lapSum += Math.abs(4 * lum[p] - lum[p - w] - lum[p + w] - lum[p - 1] - lum[p + 1]);
      lapN += 1;
    }
  }
  const m = sum / n;
  /* 像素级「芯片真的画上去了」证据（v10）：在截图里数 #global-loading-status 的
     error 文本色（#ff9b8e）墨迹。CSS 坐标走 K = bmp.width / innerWidth，避免 1.25 错位。
     这一步只报数，不作 PASS/FAIL 判据。 */
  const K = bmp.width / Math.max(1, innerWidth);
  const bandX0 = Math.max(0, Math.round((innerWidth / 2 - 110) * K));
  const bandX1 = Math.min(bmp.width, Math.round((innerWidth / 2 + 110) * K));
  const bandY0 = Math.max(0, Math.round(68 * K));
  const bandY1 = Math.min(bmp.height, Math.round(102 * K));
  const cv2 = document.createElement('canvas'); cv2.width = bmp.width; cv2.height = bmp.height;
  const cx2 = cv2.getContext('2d', { willReadFrequently: true });
  cx2.drawImage(bmp, 0, 0);
  const bd = cx2.getImageData(bandX0, bandY0, bandX1 - bandX0, bandY1 - bandY0).data;
  let ink = 0, inkMinX = 1e9, inkMaxX = -1e9;
  for (let i = 0, p = 0; i < bd.length; i += 4, p += 1) {
    const R = bd[i], G = bd[i + 1], B = bd[i + 2];
    if (R > 180 && R - G > 55 && R - B > 70 && G > 120 && G < 200) {
      ink += 1;
      const px = bandX0 + (p % (bandX1 - bandX0));
      if (px < inkMinX) inkMinX = px; if (px > inkMaxX) inkMaxX = px;
    }
  }
  return { w, h, mean: +m.toFixed(2), std: +Math.sqrt(Math.max(0, sum2 / n - m * m)).toFixed(2), uniq: uniq.size,
    lapMean: +(lapSum / Math.max(1, lapN)).toFixed(2), scaleK: +K.toFixed(3),
    chipInkPx: ink, chipInkWidthCss: ink ? +(((inkMaxX - inkMinX + 1) / K).toFixed(1)) : 0 };
}, b64);
const revealSamples = [];
for (const at of [100, 1000, 4000, 8000]) {
  const wait = at - (Date.now() - revealAt);
  if (wait > 0) await sleep(wait);
  const png = (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
  writeFileSync(`${OUT}/gate4${TAG}-reveal+${at}.png`, Buffer.from(png, 'base64'));
  /* v10：截图后立刻读一次页内状态（与截图同一瞬间，误差 ≈ 一次 evaluate RTT 3–4ms），
     pxStats 之后再读一次留档 —— 芯片可见窗短到 0.25s 时，只看后者会错过。 */
  const vsNow = await viewState();
  const st = await pxStats(png);
  const vsAfter = await viewState();
  revealSamples.push({ at, ...st, ...vsNow, afterPxStats: { failChipVisible: vsAfter.failChipVisible, failChipHidden: vsAfter.failChipHidden, failChipState: vsAfter.failChipState, failChipText: vsAfter.failChipText, failChipOffsetW: vsAfter.failChipOffsetW } });
  console.log('reveal+' + at + 'ms', JSON.stringify({ ...st, ...vsNow }));
}
const revealV = {
  revealAt: revealAt ? revealAt - tV : null,
  reason: bootV && bootV.reason,
  viewContentAt: bootV && bootV.viewContentAt,
  tilesLoadedAt: bootV && bootV.tilesLoadedAt,
  probeAtReveal: bootV && bootV.probeAtReveal,
  sched: bootV && bootV.sched,
  longFrames: bootV && bootV.longFrames,
  samples: revealSamples,
  pageErrors: errs.slice(errsBeforeV),
};
await cdp.send('Network.setCacheDisabled', { cacheDisabled: false }).catch(() => {});

/* B5：reveal 时刻（遮罩收起后 0.1s）画面中心必须有影像。
   像素基线（同一台机、同一窗口，评审与实现方都量过）：纯色空白 = std 10.19 / 22 色；
   有影像 = std 30–36 / 1.6–6.7 万色。阈值取中间（std 18 / 800 色），既不误判空白，
   也不会因为地图局部偏暗而假 FAIL。 */
const rv0 = revealSamples[0] || null;
rec('B5 reveal 时刻画面必须有影像（中心 640×420：唯一色数 ≥800 且亮度 std ≥18，遮罩收起后 0.1s）',
  !!rv0 && rv0.uniq >= 800 && rv0.std >= 18,
  { at0: rv0, samples: revealSamples, bootReason: revealV.reason, probeAtReveal: revealV.probeAtReveal,
    thresholds: { uniq: 800, std: 18, blankBaseline: '纯色空白实测 std 10.19 / 22 色',
      lapMeanInfo: '锐度 INFO：空白/重度模糊 ≈0.2（rev3 FAIL 帧 0.22）、低清可辨 ≈5.9、完全清晰 ≈12–17' } });
rec('I4 reveal 复验（第二次冷加载，INFO）：就绪门 reason / 探针 / 遮罩期长帧', true,
  { reason: revealV.reason, viewContentAt: revealV.viewContentAt, tilesLoadedAt: revealV.tilesLoadedAt,
    probeAtReveal: revealV.probeAtReveal, sched: revealV.sched, revealAtMs: revealV.revealAt,
    longOver100: (revealV.longFrames || []).filter((f) => f.dt > 100).length,
    visibleOver100: (revealV.longFrames || []).filter((f) => f.dt > 100 && f.maskOp < 0.95).length,
    pageErrors: revealV.pageErrors }, true);

const summary = {
  pass: R.filter((x) => !x.skip && x.ok).length, total: R.filter((x) => !x.skip).length,
  fails: R.filter((x) => !x.skip && !x.ok).map((x) => x.name),
  top_peak: A.top.peak, top_peakK: A.top.peakK, top_bandMean: A.top.bandMean, top_peaks: A.top.peaks,
  left_peak: A.left.peak, bot_peak: A.bot.peak, right_peak: A.right.peak,
  centerMax, noiseMax,
  disp: { top: dispTop, bot: dispBot, left: dispLeft, right: dispRight },
  disp_checker8: A.disp, disp_realmap: C.disp, disp_realmap2: C2.disp, realmapSpread,
  fpsIdle: fpsIdle.fps, fpsHover: fpsHover.fps, worstIdle: fpsIdle.worstMs, worstHover: fpsHover.worstMs,
  idleWindowWorst: idleWindows.map((w) => w.worstMs),
  warmupWorst: warm.worstMs, rampWorst: ramp.worstMs, settleMs: settle,
  bootGate: boot && { reason: boot.reason, marks: boot.marks, interactiveAt: boot.interactiveAt,
    tilesetAt: boot.tilesetAt, firstContentAt: boot.firstContentAt, cineMayStartAt: boot.cineMayStartAt,
    cineDoneAt: boot.cineDoneAt, settledAt: boot.settledAt, decideAt: boot.decideAt,
    sched: boot.sched, maskOpacityAtRead: boot.maskOpacity, schedRestoredAt: boot.schedRestoredAt,
    tilesLoadedAt: boot.tilesLoadedAt, viewContentAt: boot.viewContentAt,
    probeAtReveal: boot.probeAtReveal, viewProbeLog: boot.viewProbeLog,
    longFrames: boot.longFrames, longOver100: bootBig.length, longVisibleOver100: bootBigVisible.length },
  reveal: revealV,
  lensDraw: { steadyMax: Math.max(...idleWindows.map((w) => w.lens.drawMax)), hoverMax: hoverLens.drawMax,
    bootWindow: peaks.boot && { drawMax: peaks.boot.drawMax, drawMaxAt: peaks.boot.drawMaxAt, drawN: peaks.boot.drawN },
    drawFirstMs: edgeStats.drawFirstMs, bootAt: edgeStats.bootAt },
  stripeSelf: STRIPE_SELF,
};
writeFileSync(`${OUT}/gate4${TAG}.json`, JSON.stringify({
  instrument: 'v10 · Phase6C3-followup：芯片诊断四口径 + 截图即时读（不改任何阈值）；v9 内容：C2 v6 全部断言 + 冷启动就绪门（B1：遮罩必须等「最终视角真的有影像」；B2：>100ms 长帧全部 maskOp≥0.95；B5：reveal+0.1s 中心像素必须有影像）+ ramp 硬断言（B4）+ 进入后 warm 窗（B3）；色散=2px 横/竖条纹（T14 自检）+ band 2D max；长帧=3×8s idle 窗 + LoAF 归因；lens draw 峰值分段（resetPeaks）',
  measurementState: 'T1–T7 非 hover（指针停 (4,620)）；T1b/T3b 为 hover 态（真指针停在 data-panel 卡头中心）同口径硬判据；T3c 为注入合成第二圈的负控；T8/T9/T10 指针位按 label；色散在 2px 条纹底衬；B5 的 reveal 取证来自第二次冷加载（Network.setCacheDisabled），避免截图开销污染 B3/B4',
  thresholds: { top_peak: '>=30', top_peak_hover: '>=30（T1b，hover 硬判据）', band1_8: '>=8', four_edges: '>0', single_peak: '<=1',
    single_band: '四边各 ≤1，双口径（对比剖面可见谱线脊数 / 渲染绝对亮度剖面脊数）；灵敏度由 T3c 负控（注入 2px/0.35 白第二圈后必须 ≥2）证明',
    centerMax: `<=${CENTER_TOL}`, noise: '<=1', fps: '>=50', worst: '<=100', disp: '6..45 每边',
    boot: 'B1 遮罩收起 reason ∈ {view-content, tiles-loaded} 且 viewContentAt/tilesLoadedAt 有值（=最终视角真的有影像，不是全局 contentReady 计数）；B2 冷启动期 >100ms 长帧全部 maskOp≥0.95（不要求存在）；B5 reveal+0.1s 中心 640×420 唯一色数 ≥800 且 std ≥18（空白基线 22 色 / 10.19）；B3/B4 warm 与 ramp 窗 worst ≤100ms（硬断言）' },
  summary, env: { ...env, K }, gpu, rect: r, band,
  stateA_checker8: A, stateA_noise: Anoise, stateB_hover_checker: H, stateQ_negctl_ring2: CTL,
  stateDisp_2px: DISP, stripeSelf: STRIPE_SELF, stateC_realmap: C, stateC_realmap2: C2,
  fps: { warmup4s: warm, ramp8s: ramp, idle: fpsIdle, idleWindows, hover: fpsHover, hoverLoaf, hoverLens, settleMs: settle, settleWindows: tries,
    loafErr, warmLoaf, rampLoaf, peaks },
  style, edgeStats, errs, results: R,
}, null, 1));

const counted = R.filter((x) => !x.skip);
console.log('\n' + counted.filter((x) => x.ok).length + '/' + counted.length + ' PASS   FAIL:' + (summary.fails.length ? JSON.stringify(summary.fails) : ' none'));
console.log('disp top/bot/left/right', dispTop, dispBot, dispLeft, dispRight, '| 8px checker', JSON.stringify({ top: A.disp.top.max, left: A.disp.left.max }),
  '| realmap', JSON.stringify(realmapSpread.byEdge));
console.log('fps idle(min)/hover', fpsIdle.fps, fpsHover.fps, '| idle windows worst', JSON.stringify(fpsIdle.windows), '| hover worst', fpsHover.worstMs);
console.log('lens: drawFirst', edgeStats.drawFirstMs, '· bootDrawMax', peaks.boot && peaks.boot.drawMax,
  '@', peaks.boot && peaks.boot.drawMaxAt, '· steadyMax', Math.max(...idleWindows.map((w) => w.lens.drawMax)), '· warmup worst', warm.worstMs, '· ramp worst', ramp.worstMs);
await browser.close();
process.exit(summary.fails.length ? 1 : 0);
