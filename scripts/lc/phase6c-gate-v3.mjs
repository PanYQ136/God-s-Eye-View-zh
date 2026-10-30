#!/usr/bin/env node
/* Phase6C / C1 Gate v3 — 液态玻璃边缘可见度（按 Round-1 评审修正的仪器）
   ── 与 v2 的差别（评审 6 条）────────────────────────────────────────────
   1. 测量态声明：主判据一律在**非 hover**（指针停在 (4,400)，离卡外）下量；
      另出一份 hover 态对照（评审 #2/#3）。v2 全程 hover → 顶沿被卡壳 12px 高光带压住。
   2. 主判据纹理换成**棋盘**（testChecker, 8px 格）：平灰对纯位移是瞎的（位移纯色仍是纯色），
      棋盘横竖都有高频结构 → 四条边都能在确定性条件下测（评审 #4）。
   3. 「边缘÷中心」楼层数（edge/0.35）废弃；改成 **centerMax 必须为 0** + 边缘 Δ 与
      同状态连拍噪声对比（评审 #5）。
   4. 断言与报告口径一致：所有 FAIL 原样打印并写进 JSON；噪声分状态记录
      （棋盘态 0，真地图态自身在动），fps 明确是 rAF p50（评审 #6）。
   5. 峰值计数合并平台（v2 把 58.66/58.66 平台数成 2 个峰 → 假「双线」）。
   6. `Page.captureScreenshot` 出图 1685×968 vs CSS 1348×774（K=1.25）→ 所有取样坐标乘 K；
      右/下边剖面 dir=-1（band 在卡内侧）。

   用法: node scripts/lc/phase6c-gate-v3.mjs [tag]
   产物: .gev-logs/lc/phase6c/gate3[-tag].json + gate3[-tag]-*.png
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] ? '-' + process.argv[2] : '';
const W = 1348, VH = 774;
const OUT = '.gev-logs/lc/phase6c';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = [];
const rec = (name, ok, detail, skip) => {
  R.push({ name, ok: !!ok, skip: !!skip, detail });
  console.log(`${skip ? 'INFO' : ok ? 'PASS' : 'FAIL'}  ${name}${ok || skip ? '' : '  <- ' + JSON.stringify(detail).slice(0, 420)}`);
};

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${VH + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
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
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
    && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
await sleep(5000);
const cdp = await page.createCDPSession();
const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
rec('G0 GPU = RTX 3060（非软件渲染）', !!gpu && /RTX 3060/.test(gpu.renderer || '') && gpu.software === false,
  gpu && { renderer: gpu.renderer, software: gpu.software, tier: gpu.tier });

const shot1x = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const clickHeader = async (id) => {
  const p = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const t = el.querySelector('.panel-header,.pp-header-row') || el;
    const b = t.getBoundingClientRect();
    return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
  }, id);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await sleep(80); await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1200);
};
/* 非 hover：指针停在卡外（评审 #2：v2 在 clickHeader 后指针一直停在卡上） */
const parkPtr = async () => { await page.mouse.move(4, 620, { steps: 3 }); await sleep(450); };

/* ── 1) FPS（先测，避免注入底衬影响） ─────────────────────────────── */
const fpsSample = (label) => page.evaluate(async (label) => {
  const t0 = performance.now();
  const ft = []; let last = t0, worst = 0;
  await new Promise((res) => {
    const tick = (ts) => { const dt = ts - last; last = ts; if (dt > 0) { ft.push(dt); worst = Math.max(worst, dt); } if (ts - t0 < 8000) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick);
  });
  const s = ft.slice().sort((a, b) => a - b);
  const p50 = s[Math.floor(s.length * 0.5)];
  return { label, frames: ft.length, fps: +(1000 / p50).toFixed(1), p50ms: +p50.toFixed(2), p95ms: +s[Math.floor(s.length * 0.95)].toFixed(1), worstMs: +worst.toFixed(1), quantile: 'rAF p50' };
}, label);
await parkPtr();
const fpsIdle = await fpsSample('idle-nohover');
const hp = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: Math.round(b.x + 40), y: Math.round(b.y + 20) }; });
await page.mouse.move(hp.x, hp.y, { steps: 6 }); await sleep(250);
const fpsHover = await fpsSample('hover');
await parkPtr();
const edgeStats0 = await page.evaluate(() => { const s = window.__gevEdge.stats(); return { fps: s.fps, drawFps: s.drawFps, frames: s.frames, err: s.err }; });

/* ── 2) 打开 data-panel（真指针） ─────────────────────────────────── */
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(600);
let ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
if (ph !== 'open') { await clickHeader('data-panel'); await sleep(900); }
ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
rec('C0 真指针点击展开 data-panel', ph === 'open', { phase: ph });
const canvasCount = await page.evaluate(() => document.querySelectorAll('#gev-edge-lens').length);
const surfCount = await page.evaluate(() => window.__gevEdge.stats().count);
rec('C0b 单层：1 个折射 canvas / 9 个面（一卡一面）', canvasCount === 1 && surfCount === 9, { canvasCount, surfCount });
const lensErr = await page.evaluate(() => window.__gevEdge.stats().err);
rec('C1 lens 无 shader 报错', !lensErr, { err: lensErr });
await parkPtr();

const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const band = await page.evaluate(() => {
  const s = window.__gevEdge.stats();
  const f = (s.surfaces || []).find((x) => x.id === 'data-panel');
  return f ? f.band : s.band;
});

/* ── 3) 页内测量内核 ──────────────────────────────────────────────── */
await page.evaluate(() => {
  const dec = async (b64) => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
  };
  /* 平台感知峰值计数：平台只算 1 个峰（v2 的 `>=` 双比较把 58.66/58.66 数成 2 个 → 假双线） */
  const peaksOf = (prof, n) => {
    let c = 0;
    for (let i = 0; i < n; i++) {
      const l = i === 0 ? -1e9 : prof[i - 1], rr = i === n - 1 ? -1e9 : prof[i + 1];
      if (prof[i] > 3 && prof[i] >= l && prof[i] > rr) c++;
    }
    return c;
  };
  const metrics = (A, B, rect, edgePx, axis, bandCss, dir) => {
    dir = dir || 1;
    const x0 = Math.round(rect.x + rect.w * 0.3), x1 = Math.round(rect.x + rect.w * 0.7);
    const y0 = Math.round(rect.y + rect.h * 0.3), y1 = Math.round(rect.y + rect.h * 0.7);
    const edge = Math.round(edgePx);
    const prof = [], dprof = [], absA = [], absB = [];
    for (let k = 0; k <= 12; k++) {
      const aa = edge + k * dir;
      let s = 0, n = 0, chd = 0, la = 0, lb = 0;
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
      prof.push(n ? +(s / n).toFixed(2) : 0);
      dprof.push(chd);
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
    /* T3（本轮口径修正）：单带判定走**渲染绝对亮度剖面**，不走 on/off Δ 剖面。
       Δ 剖面在边沿最外 1 device px 有 ~19 灰阶的合成抖动（抗锯齿/发丝），按 peaksOf 会被数成
       第二个峰 → 「Δ 剖面凹陷」被误读成双线；而真出现第二圈高光时 Δ 剖面反而可能被抵消看不见。
       这里的口径：absA = 有镜头时该 scanline 的实际渲染亮度（跨卡宽 30–70% 取均值），先做 3 抽平滑，
       再数「带内相对最暗处的凸起 ≥ ABS_PROM 灰阶」的局部极大。真双圈（外圈+内圈亮带）会出 2 个，
       单条连续亮带只会出 1 个。 */
    const ap = absA.slice(0, bd);
    const sm = ap.map((v, i) => +(((ap[Math.max(0, i - 1)] + v + ap[Math.min(ap.length - 1, i + 1)]) / 3)).toFixed(2));
    const apMin = Math.min(...sm);
    const ABS_PROM = 4;
    let absPeaks = 0; const absMaxK = [];
    for (let i = 0; i < sm.length; i++) {
      const l = i === 0 ? -1e9 : sm[i - 1], rr = i === sm.length - 1 ? -1e9 : sm[i + 1];
      if (sm[i] >= l && sm[i] > rr && sm[i] - apMin >= ABS_PROM) { absPeaks++; absMaxK.push(i); }
    }
    /* ridgePeaks（本轮主判据）：渲染「带」在 on/off 对比剖面里的**可见谱线**条数。
       与 peaksOf 的差别：
         · 平台/阶梯按容差并成一条脊（bot 的 59.05/58.66/58.66 是同一根主峰，peaksOf 数成 2 → 假双线）；
         · 脊高必须 ≥ 主峰 45%（外侧那 1 device px 的 19 灰阶肩部 = 33%，是带的外缘滚降，不是第二条线）；
       真出现第二圈（外圈+内圈两条强度可比的亮带）会得到 2，滚降/肩部/平台都只有 1。
       以 T3c 负控（注入 2px / 0.35 白第二圈）实测验证灵敏度。 */
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
    return { peak, peakK, peaks: peaksOf(prof, bd), ridgePeaks: rg.count, ridgeAt: rg.at, ridgeThr: rg.thr, bandMean: +(bs.reduce((a, b) => a + b, 0) / (bs.length || 1)).toFixed(2), prof, dprof, absProf: ap, absSm: sm, absPeaks, absMaxK, absProm: ABS_PROM, absMin: apMin, centerMax: cMax, centerMean: +(cSum / Math.max(1, cN)).toFixed(2), centerN: cN };
  };
  window.__pc = { dec, metrics };
});

const measurePair = async (onB64, offB64, rS, bandS) => page.evaluate(async (onB64, offB64, r, band) => {
  const A = await window.__pc.dec(onB64), B = await window.__pc.dec(offB64);
  return {
    size: [A.w, A.h],
    top: window.__pc.metrics(A, B, r, r.y, 'y', band, 1),
    left: window.__pc.metrics(A, B, r, r.x, 'x', band, 1),
    bot: window.__pc.metrics(A, B, r, r.y + r.h, 'y', band, -1),
    right: window.__pc.metrics(A, B, r, r.x + r.w, 'x', band, -1),
  };
}, onB64, offB64, rS, bandS);

/* ── 4) 棋盘（确定性）+ 128 灰底衬 + 隐藏卡内内容 ─────────────────── */
await page.evaluate(() => {
  const s = document.createElement('style'); s.id = 'pc-blank';
  s.textContent = '#data-panel > *{visibility:hidden!important}';
  document.head.appendChild(s);
  const d = document.createElement('div'); d.id = 'pc-under';
  d.style.cssText = 'position:fixed;inset:0;background:#808080;z-index:1;pointer-events:none';
  document.body.appendChild(d);
  window.__gevEdge.testChecker(true, 8);
});
await sleep(1600);
await parkPtr();
const A_on1 = await shot1x();
const K = await page.evaluate(async (b64) => (await window.__pc.dec(b64)).w / innerWidth, A_on1);
const rS = { x: r.x * K, y: r.y * K, w: r.w * K, h: r.h * K };
const bandS = band * K;
const env = await page.evaluate(() => ({ dpr: window.devicePixelRatio, innerW: innerWidth, innerH: innerHeight, lens: window.__gevEdge.stats().scale, canvas: window.__gevEdge.stats().canvas, bandAlpha: window.__gevEdge.cfg().bandAlpha }));
console.log('ENV', JSON.stringify(env), 'K =', K, 'rect(css)', JSON.stringify(r));
await sleep(350);
const A_on2 = await shot1x();
await page.evaluate(() => window.__gevEdge.off());
await sleep(700);
const A_off = await shot1x();
await page.evaluate(() => window.__gevEdge.on());
await sleep(800);
const A = await measurePair(A_on1, A_off, rS, bandS);
const Anoise = await measurePair(A_on2, A_on1, rS, bandS);

/* ── 4b) 负控：合成第二圈（顶沿内侧 7px、2px 高、0.35 白，真实强度）──
   目的：证明 T3 的「脊数 ≤1」判据**看得见**第二圈，而不是「看不见即通过」。
   与 A_off（有底衬、无镜头、无第二圈）对比，剖面里若判据出 2 条脊即说明灵敏度成立。 */
await page.evaluate((r) => {
  const d = document.createElement('div'); d.id = 'pc-ring2';
  d.style.cssText = `position:fixed;left:${r.x + 8}px;top:${r.y + 7}px;width:${r.w - 16}px;height:2px;`
    + 'background:rgba(255,255,255,0.35);z-index:9999;pointer-events:none';
  document.body.appendChild(d);
}, r);
await sleep(450);
const Q_on = await shot1x();
await page.evaluate(() => { const d = document.getElementById('pc-ring2'); if (d) d.remove(); });
const CTL = await measurePair(Q_on, A_off, rS, bandS);
writeFileSync(`${OUT}/gate3${TAG}-Q-negctl-ring2-1x.png`, Buffer.from(Q_on, 'base64'));
await sleep(350);

/* ── 5) hover 态对照（同一棋盘、同一仪器，只改指针位置） ───────────── */
const hdr = await page.evaluate(() => {
  const b = document.getElementById('data-panel').querySelector('.panel-header').getBoundingClientRect();
  return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
});
await page.mouse.move(hdr.x, hdr.y, { steps: 4 }); await sleep(700);
const Bhover_on = await shot1x();
await page.evaluate(() => window.__gevEdge.off());
await sleep(700);
const Bhover_off = await shot1x();
await page.evaluate(() => window.__gevEdge.on());
await sleep(800);
const H = await measurePair(Bhover_on, Bhover_off, rS, bandS);
await parkPtr();
await sleep(600);

/* ── 6) 真地图 + 未冻结（交叉验证；噪声自身在动，只作参考） ────────── */
await page.evaluate(() => { document.getElementById('pc-under').remove(); window.__gevEdge.testChecker(false, 8); });
await sleep(1600);
const C_on = await shot1x();
await page.evaluate(() => window.__gevEdge.off());
await sleep(700);
const C_off = await shot1x();
await page.evaluate(() => window.__gevEdge.on());
await sleep(900);
const C_on2 = await shot1x();
const Cm = await measurePair(C_on, C_off, rS, bandS);
const Cnoise = await measurePair(C_on2, C_on, rS, bandS);

/* ── 6b) 平坦 128 底（只测得到 rim 镜面高光，位移对纯色恒为 0）────────── */
await page.evaluate(() => { window.__gevEdge.testBg(true, 8, 128); });
await sleep(1500);
await parkPtr();
const F_on = await shot1x();
await page.evaluate(() => window.__gevEdge.off());
await sleep(700);
const F_off = await shot1x();
await page.evaluate(() => window.__gevEdge.on());
await sleep(800);
const Fm = await measurePair(F_on, F_off, rS, bandS);
await page.evaluate(() => { window.__gevEdge.testChecker(true, 8); });
await sleep(900);
await parkPtr();

/* ── 7) 截图产物（棋盘态 8x + 1x） ────────────────────────────────── */
writeFileSync(`${OUT}/gate3${TAG}-A-checker-on-1x.png`, Buffer.from(A_on1, 'base64'));
writeFileSync(`${OUT}/gate3${TAG}-A-checker-off-1x.png`, Buffer.from(A_off, 'base64'));
writeFileSync(`${OUT}/gate3${TAG}-B-hover-on-1x.png`, Buffer.from(Bhover_on, 'base64'));
writeFileSync(`${OUT}/gate3${TAG}-C-realmap-on-1x.png`, Buffer.from(C_on, 'base64'));
const crops = (b64, rect, scale) => page.evaluate(async (b64, rect, s) => {
  const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  const out = {};
  const box = (name, x, y, w, h) => {
    const cv = document.createElement('canvas'); cv.width = Math.round(w * s); cv.height = Math.round(h * s);
    const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false;
    cx.drawImage(bmp, Math.round(x), Math.round(y), Math.round(w), Math.round(h), 0, 0, cv.width, cv.height);
    out[name] = cv.toDataURL('image/png');
  };
  const px = (n) => Math.round(n * (rect.w / 320));  // 卡片宽度归一到 320 时的像素
  const cw = 44 * (rect.w / 320), ch = 36 * (rect.w / 320);
  box('tl', rect.x - 4 * (rect.w / 320), rect.y - 4 * (rect.w / 320), cw, ch);
  box('tr', rect.x + rect.w - 40 * (rect.w / 320), rect.y - 4 * (rect.w / 320), cw, ch);
  box('bl', rect.x - 4 * (rect.w / 320), rect.y + rect.h - 32 * (rect.w / 320), cw, ch);
  box('br', rect.x + rect.w - 40 * (rect.w / 320), rect.y + rect.h - 32 * (rect.w / 320), cw, ch);
  box('top', rect.x + rect.w * 0.5 - 22 * (rect.w / 320), rect.y - 6 * (rect.w / 320), 44 * (rect.w / 320), 34 * (rect.w / 320));
  box('left', rect.x - 4 * (rect.w / 320), rect.y + rect.h * 0.5 - 18 * (rect.w / 320), cw, 36 * (rect.w / 320));
  return out;
}, b64, rect, scale);
const cA = await crops(A_on1, rS, 8);
for (const k of Object.keys(cA)) writeFileSync(`${OUT}/gate3${TAG}-A-${k}-8x.png`, Buffer.from(String(cA[k]).split(',')[1], 'base64'));
const cH = await crops(Bhover_on, rS, 8);
for (const k of Object.keys(cH)) {
  writeFileSync(`${OUT}/gate3${TAG}-B-${k}-hover-8x.png`, Buffer.from(String(cH[k]).split(',')[1], 'base64'));
}

/* ── 8) 单层玻璃结构 + 收尾统计 ───────────────────────────────────── */
const style = await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const cs = getComputedStyle(el);
  const inner = [...el.querySelectorAll('*')].filter((x) => {
    const s = getComputedStyle(x);
    return s.backdropFilter && s.backdropFilter !== 'none';
  });
  return { bg: cs.backgroundColor, bf: cs.backdropFilter, border: cs.borderTopWidth, outline: cs.outlineWidth, filter: cs.filter, innerBackdrop: inner.length,
    hoverBefore: (function () { const s = getComputedStyle(el, ':hover'); return { height: s.height, bg: String(s.background).slice(0, 120), z: cs.zIndex }; })() };
});
await page.evaluate(() => { const s = document.getElementById('pc-blank'); if (s) s.remove(); });
const edgeStats = await page.evaluate(() => { const s = window.__gevEdge.stats(); return { fps: s.fps, drawFps: s.drawFps, frames: s.frames, err: s.err }; });
const dispMax = Math.max(...A.top.dprof.slice(0, 10));
const noiseMax = Math.max(...Anoise.top.prof.slice(0, 10), ...Anoise.left.prof.slice(0, 10));

/* ── 9) 断言（主判据 = 棋盘 / 非 hover / 未冻结） ─────────────────── */
rec('T1 顶沿峰值 ≥30（棋盘 8px、非 hover、未冻结）', A.top.peak >= 30 && A.top.peakK <= 4,
  { peak: A.top.peak, peakK: A.top.peakK, prof: A.top.prof });
rec('T2 顶沿 band 1–8px Δ 均值 ≥8', A.top.bandMean >= 8, { bandMean: A.top.bandMean, prof: A.top.prof.slice(0, 10) });
/* T3（Phase6C1b 口径修正）：四边单带。两个口径都要 ≤1：
   ① ridgePeaks = 渲染对比剖面里的**可见谱线**条数（平台并脊 + 45% 主峰门槛，见 metrics 注释）；
   ② absPeaks  = **渲染绝对亮度**剖面（3 抽平滑、≥4 灰阶凸起）的脊数 —— 专抓「第二条高光/白带」这类
      加亮度型的第二圈。说明：左/下/右是位移型折射，对称棋盘下位移不改变均值亮度（实测 absSm 波动 <2 灰阶），
      所以亮度口径在这三边恒为 0；若只用亮度口径，这三边就是「看不见即通过」的真空判据 —— 正是本卡要避免的。
      因此单带判定以 ① 为主（四边都有效、且经 T3c 负控验证），② 只作亮度型第二圈的附加硬约束。 */
const ABS = (m) => m.absPeaks <= 1, RDG = (m) => m.ridgePeaks <= 1;
rec('T3 四边单带（脊数 ≤1：对比剖面可见谱线 + 绝对亮度剖面双口径）',
  RDG(A.top) && RDG(A.left) && RDG(A.bot) && RDG(A.right) && ABS(A.top) && ABS(A.left) && ABS(A.bot) && ABS(A.right),
  { ridgePeaks: { top: A.top.ridgePeaks, left: A.left.ridgePeaks, bot: A.bot.ridgePeaks, right: A.right.ridgePeaks },
    ridgeAt: { top: A.top.ridgeAt, left: A.left.ridgeAt, bot: A.bot.ridgeAt, right: A.right.ridgeAt },
    ridgeThr: { top: A.top.ridgeThr, left: A.left.ridgeThr, bot: A.bot.ridgeThr, right: A.right.ridgeThr },
    absPeaks: { top: A.top.absPeaks, left: A.left.absPeaks, bot: A.bot.absPeaks, right: A.right.absPeaks },
    absSm: { top: A.top.absSm, left: A.left.absSm, bot: A.bot.absSm, right: A.right.absSm },
    deltaPeaks_refOnly: { top: A.top.peaks, left: A.left.peaks, bot: A.bot.peaks, right: A.right.peaks } });
/* T3c 负控：注入一条真实强度的合成第二圈（顶沿内侧 7px、2px 高、0.35 白），判据必须看见 2 条脊。
   没有这条，T3 的「≤1」无法区分「真的只有一条」和「判据根本看不见第二条」。 */
rec('T3c 负控：注入合成第二圈后顶沿脊数必须 ≥2（证明 T3 判据看得见第二圈）',
  CTL.top.ridgePeaks >= 2 || CTL.top.absPeaks >= 2,
  { ridgePeaks: CTL.top.ridgePeaks, ridgeAt: CTL.top.ridgeAt, absPeaks: CTL.top.absPeaks, absMaxK: CTL.top.absMaxK, prof: CTL.top.prof.slice(0, 12) });
/* T1b（Phase6C1b 新增，硬判据）：hover 态顶沿同样要 ≥30。
   C1 时 hover 只有 28.18，因为卡壳 :hover::before 12px 白带压住 lens 顶沿；C1b 删掉该白带后
   hover 与非 hover 走同一条判据，不再有「报告说未授权、判据却按非 hover 裁」的口径分裂。 */
rec('T1b hover 态顶沿峰值 ≥30（删掉卡壳第二层白带后与 T1 同口径）',
  H.top.peak >= 30 && H.top.peakK <= 4,
  { peak: H.top.peak, peakK: H.top.peakK, nohover: A.top.peak, prof: H.top.prof });
rec('T3b hover 态四边单带（同一双口径；hover 时卡内不得出现第二圈高光）',
  RDG(H.top) && RDG(H.left) && RDG(H.bot) && RDG(H.right) && ABS(H.top) && ABS(H.left) && ABS(H.bot) && ABS(H.right),
  { ridgePeaks: { top: H.top.ridgePeaks, left: H.left.ridgePeaks, bot: H.bot.ridgePeaks, right: H.right.ridgePeaks },
    absPeaks: { top: H.top.absPeaks, left: H.left.absPeaks, bot: H.bot.absPeaks, right: H.right.absPeaks },
    absSm: { top: H.top.absSm, left: H.left.absSm, bot: H.bot.absSm, right: H.right.absSm } });
rec('T4 四边都有折射（顶/左/下/右 峰值 >0）', A.top.peak > 0 && A.left.peak > 0 && A.bot.peak > 0 && A.right.peak > 0,
  { top: A.top.peak, left: A.left.peak, bot: A.bot.peak, right: A.right.peak,
    bandMean: { top: A.top.bandMean, left: A.left.bandMean, bot: A.bot.bandMean, right: A.right.bandMean } });
/* T5 阈值：1 灰阶 = 同状态噪声底（T6 实测 ≤0.79）的取整抖动，不是污染（Round-2 评审 #1）。
   硬写 ===0 会让判据变成硬币；这里断言 <= 噪声上限，并把实际值原样写进 JSON/报告。 */
const CENTER_TOL = 1;
const centerVals = [A.top.centerMax, A.left.centerMax, A.bot.centerMax, A.right.centerMax];
const centerMax = Math.max(...centerVals);
rec(`T5 中心无污染（棋盘态 中心 Δ max ≤ ${CENTER_TOL} 灰阶 = 噪声底，实际 ${centerMax}）`,
  centerMax <= CENTER_TOL,
  { center: centerVals, centerMax, tol: CENTER_TOL, noiseMaxRef: noiseMax });
rec('T6 确定性噪声：棋盘态同状态连拍 Δ ≤ 1 灰阶（亚像素合成抖动）', noiseMax <= 1, { noiseMax, prof: Anoise.top.prof.slice(0, 8) });
rec('T7 单层玻璃：0 border / 0 outline / 0 backdrop-filter / 卡内 0 第二层',
  style.border === '0px' && style.outline === '0px' && (!style.bf || style.bf === 'none') && style.innerBackdrop === 0, style);
rec('T8 FPS ≥50（idle，rAF p50）', fpsIdle.fps >= 50, fpsIdle);
rec('T9 FPS ≥50（hover）', fpsHover.fps >= 50, fpsHover);
rec('T10 无长帧冻结（idle/hover worst ≤100ms）', fpsIdle.worstMs <= 100 && fpsHover.worstMs <= 100, { idle: fpsIdle.worstMs, hover: fpsHover.worstMs });
rec('T11 真地图（未冻结）四边仍有 Δ（交叉验证；C 态底图自身在动）',
  Cm.top.peak > 0 && Cm.left.peak > 0 && Cm.bot.peak > 0 && Cm.right.peak > 0,
  { top: Cm.top.peak, left: Cm.left.peak, bot: Cm.bot.peak, right: Cm.right.peak, noiseMax: Math.max(...Cnoise.top.prof.slice(0, 10)) });
rec('T12 渲染无 JS 报错', errs.filter((e) => !/Failed to load resource|favicon/i.test(e)).length === 0, errs.slice(0, 4));
rec('I1 色散 max|ΔR−ΔB|（只记录，C2 负责 6–45）', true, { dispMax }, true);
rec('I3 平坦 128 底（rim-only 对照：位移对纯色恒为 0，故只能测到镜面高光）', true,
  { topPeak_flat128: Fm.top.peak, topBandMean_flat128: Fm.top.bandMean, prof: Fm.top.prof.slice(0, 8) }, true);
rec('I2 hover 态对照（卡壳 :hover::before 12px 高光带压顶沿 → 仅作对照，不参与 T1）', true,
  { topPeak_hover: H.top.peak, topPeak_nohover: A.top.peak, left_hover: H.left.peak, bot_hover: H.bot.peak, right_hover: H.right.peak }, true);

const summary = {
  pass: R.filter((x) => !x.skip && x.ok).length,
  total: R.filter((x) => !x.skip).length,
  fails: R.filter((x) => !x.skip && !x.ok).map((x) => x.name),
  top_peak: A.top.peak, top_peakK: A.top.peakK, top_bandMean: A.top.bandMean,
  left_peak: A.left.peak, bot_peak: A.bot.peak, right_peak: A.right.peak,
  left_bandMean: A.left.bandMean, bot_bandMean: A.bot.bandMean, right_bandMean: A.right.bandMean,
  top_peaks: A.top.peaks, centerMax, centerVals, centerTol: CENTER_TOL, noiseMax,
  absPeaks: { top: A.top.absPeaks, left: A.left.absPeaks, bot: A.bot.absPeaks, right: A.right.absPeaks },
  absPeaks_hover: { top: H.top.absPeaks, left: H.left.absPeaks, bot: H.bot.absPeaks, right: H.right.absPeaks },
  absProm: A.top.absProm, ridgeRel: 0.45,
  negctl_ring2: { ridgePeaks: CTL.top.ridgePeaks, ridgeAt: CTL.top.ridgeAt, absPeaks: CTL.top.absPeaks, absMaxK: CTL.top.absMaxK, prof: CTL.top.prof.slice(0, 12) },
  ridgePeaks: { top: A.top.ridgePeaks, left: A.left.ridgePeaks, bot: A.bot.ridgePeaks, right: A.right.ridgePeaks },
  ridgePeaks_hover: { top: H.top.ridgePeaks, left: H.left.ridgePeaks, bot: H.bot.ridgePeaks, right: H.right.ridgePeaks },
  hover_top_peak: H.top.peak, hover_top_peakK: H.top.peakK, hover_left_peak: H.left.peak, hover_bot_peak: H.bot.peak, hover_right_peak: H.right.peak,
  flat128_top_peak: Fm.top.peak,
  realmap_top_peak: Cm.top.peak, realmap_left_peak: Cm.left.peak, realmap_right_peak: Cm.right.peak,
  realmap_noiseMax: Math.max(...Cnoise.top.prof.slice(0, 10), ...Cnoise.left.prof.slice(0, 10)),
  dispMax, fpsIdle: fpsIdle.fps, fpsHover: fpsHover.fps, worstIdle: fpsIdle.worstMs, worstHover: fpsHover.worstMs,
};
writeFileSync(`${OUT}/gate3${TAG}.json`, JSON.stringify({
  instrument: 'v3.1 · 棋盘确定性解析合成（非 hover 主判据）+ hover 对照 + 真地图交叉验证；不冻结 Cesium',
  measurementState: 'T1–T6 为非 hover（指针停在卡外 (4,620)）；T1b/T3b 为 hover 态同口径硬判据（指针停在卡头）',
  thresholds: {
    top_peak: '>=30（非 hover）', top_peak_hover: '>=30（hover，Phase6C1b 起硬判据）',
    band1_8_mean: '>=8', four_edges: '>0',
    single_band: '四边各 ≤1，双口径：① 对比剖面可见谱线脊数（平台并脊容差 1% 主峰、脊高门槛 45% 主峰）② 渲染绝对亮度剖面脊数（3 抽平滑、≥4 灰阶凸起）；peaksOf 原值仅作参考。灵敏度由 T3c 负控证明',
    centerMax: `<=${CENTER_TOL}（1 灰阶 = 噪声底取整抖动）`, checker_noise: '<=1', fps: '>=50',
  },
  summary,
  env: { ...env, K, screenshot: [Math.round(W * K), Math.round(VH * K)] },
  gpu, rect: r, band,
  stateA_checker_unfrozen: A, stateA_noise: Anoise,
  stateB_hover_checker: H,
  stateC_realmap: Cm, stateC_noise: Cnoise,
  stateF_flat128_rimOnly: Fm,
  stateQ_negctl_ring2: CTL,
  style, fps: { fpsIdle, fpsHover }, edgeStats, edgeStats0, errs, results: R,
}, null, 1));

console.log('\nA(棋盘/非hover) top', A.top.peak, 'k', A.top.peakK, 'bandMean', A.top.bandMean, JSON.stringify(A.top.prof));
console.log('A left/bot/right', A.left.peak, A.bot.peak, A.right.peak, '| bandMean', A.left.bandMean, A.bot.bandMean, A.right.bandMean);
console.log('F(平灰128/rim-only) top', Fm.top.peak, 'bandMean', Fm.top.bandMean);
console.log('Q(负控 合成第二圈) top ridgePeaks', CTL.top.ridgePeaks, 'at', JSON.stringify(CTL.top.ridgeAt), 'absPeaks', CTL.top.absPeaks, JSON.stringify(CTL.top.prof.slice(0, 12)));
console.log('B(hover) top', H.top.peak, '| C(真地图) top', Cm.top.peak, 'left/bot/right', Cm.left.peak, Cm.bot.peak, Cm.right.peak);
const counted = R.filter((x) => !x.skip);
const pass = counted.filter((x) => x.ok).length;
const fails = counted.filter((x) => !x.ok).map((x) => x.name);
console.log('\n' + pass + '/' + counted.length + ' PASS   FAIL:' + (fails.length ? JSON.stringify(fails) : ' none'));
await browser.close();
process.exit(fails.length ? 1 : 0);
