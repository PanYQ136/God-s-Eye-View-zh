#!/usr/bin/env node
/**
 * phase2-measure.mjs —— Phase 2 候选量化（中心透明度 / 边缘彩边 / 文字可读 / FPS）
 *
 * 对 A/B/C 三个候选静态页（1536×730，同一张地图背景，同一 layout）：
 *  1) FPS：页面内 rAF 计数 3s × 3 次取中位数（背景地图逐帧平移 → 玻璃必须每帧重算）；
 *     不用 glassStats，也不读 HUD。
 *  2) 中心透明度：冻结动画后截「带玻璃」/「字隐」/「body.m-bg 全隐」三张同帧图：
 *       lumKeep   = L_glass / L_bg            （中心亮度保留比 = 验收表「中心像素亮度比」）
 *       stdRatio  = std_glass / std_bg        （细节保留，>1 = saturate 提了局部对比）
 *       pearsonR  = corr(L_glass, L_bg)       （中心还是不是同一张地图）
 *       alphaMeas = (P_glass-P_bg)/(P_fill-P_bg) 三通道均值（含 blur/saturate 误差，标注近似）
 *  3) 边缘彩边：dsf=2/4 截 data-panel 右边缘「无内容带」：
 *       每通道边缘位置 = 带内 |dx| 加权质心 → R-B / G-B 位移(CSS px)
 *       fringe = max(|R-B|_glass − |R-B|_bg) / max(|G-B|_glass − |G-B|_bg)  （玻璃新增色差）
 *  4) 文字可读：WCAG 对比度 = 计算文字色 vs notext 图局部合成背景；
 *       另给 renderedContrast（真实渲染字形 p97/p3 亮度 vs 局部背景）
 *       与 brightFillContrast（App 亮底档 fill=0.76 的解析投影，供 lead 取舍）。
 *
 * 用法: node scripts/phase2-measure.mjs [--headful]
 * 产物: .gev-logs/phase2/{shots/,metrics.json,compare.png}
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve('.gev-logs/phase2');
const SHOTS = path.join(ROOT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const CAND = path.join(ROOT, 'candidates');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VARIANTS = [
  { key: 'A', file: 'A-clear-css.html', name: 'A 清透 CSS', fill: [10, 16, 24], alpha: 0.14 },
  { key: 'B', file: 'B-325-original.html', name: 'B 3:25 原版', fill: [12, 18, 26], alpha: 0.52 },
  { key: 'C', file: 'C-edge-hybrid.html', name: 'C 边缘混合', fill: [10, 16, 24], alpha: 0.12 },
];

const browser = await puppeteer.launch({
  headless: !process.argv.includes('--headful'),
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: [
    '--no-sandbox',
    '--enable-gpu',
    '--use-angle=d3d11',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--window-size=1560,860',
    '--window-position=1900,40',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion',
  ],
  protocolTimeout: 900000,
});

/* ── 像素工具 ─────────────────────────────────────────────────────────── */
const srgb2lin = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const lumOf = (r, g, b) => 0.2126 * srgb2lin(r) + 0.7152 * srgb2lin(g) + 0.0722 * srgb2lin(b);
const contrast = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
};

async function raw(p) {
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}
function regionStats(img, x, y, w, h) {
  let n = 0,
    sr = 0,
    sg = 0,
    sb = 0;
  const lums = [];
  for (let yy = y; yy < y + h; yy++) {
    if (yy < 0 || yy >= img.h) continue;
    for (let xx = x; xx < x + w; xx++) {
      if (xx < 0 || xx >= img.w) continue;
      const o = (yy * img.w + xx) * img.ch;
      sr += img.data[o];
      sg += img.data[o + 1];
      sb += img.data[o + 2];
      lums.push(lumOf(img.data[o], img.data[o + 1], img.data[o + 2]));
      n++;
    }
  }
  const mean = (a) => a.reduce((p, c) => p + c, 0) / a.length;
  const m = mean(lums);
  const sd = Math.sqrt(mean(lums.map((v) => (v - m) * (v - m))));
  return { n, r: sr / n, g: sg / n, b: sb / n, lum: m, sd, lums };
}
function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  let ma = 0,
    mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0,
    da = 0,
    db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma,
      y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db || 1e-12);
}
/** 垂直边缘：每行用 R/B 通道剖面的归一化互相关求亚像素错位（色散位移），跨行取中位 */
function channelShift(img, x0, x1, y0, y1, maxLag) {
  const shifts = { RB: [], GB: [] };
  const L = x1 - x0;
  const norm = (a) => {
    const m = a.reduce((p, c) => p + c, 0) / a.length;
    const s = Math.sqrt(a.reduce((p, c) => p + (c - m) * (c - m), 0) / a.length) || 1;
    return a.map((v) => (v - m) / s);
  };
  for (let y = y0; y < y1; y++) {
    const prof = { R: [], G: [], B: [] };
    for (let x = x0; x < x1; x++) {
      const o = (y * img.w + x) * img.ch;
      prof.R.push(img.data[o]);
      prof.G.push(img.data[o + 1]);
      prof.B.push(img.data[o + 2]);
    }
    const R = norm(prof.R),
      G = norm(prof.G),
      B = norm(prof.B);
    const best = (A, C) => {
      let bl = 0,
        bs = -Infinity;
      const arr = [];
      for (let lag = -maxLag; lag <= maxLag; lag++) {
        let s = 0,
          n = 0;
        for (let i = Math.max(0, -lag); i < Math.min(L, L - lag); i++) {
          s += A[i] * C[i + lag];
          n++;
        }
        const v = n ? s / n : -Infinity;
        arr.push({ lag, v });
        if (v > bs) {
          bs = v;
          bl = lag;
        }
      }
      // 抛物线亚像素
      const at = (l) => (arr.find((o) => o.lag === l) || { v: bs }).v;
      const d0 = at(bl - 1),
        d1 = at(bl + 1);
      const den = d0 - 2 * bs + d1;
      const sub = den !== 0 ? bl + (0.5 * (d0 - d1)) / den : bl;
      return sub;
    };
    shifts.RB.push(best(R, B));
    shifts.GB.push(best(G, B));
  }
  const med = (a) => (a.length ? median(a) : NaN);
  return { RB: med(shifts.RB), GB: med(shifts.GB), rows: shifts.RB.length };
}
function bandFringe(glass, bg, x0, x1, y0, y1) {
  let maxRB = 0,
    maxGB = 0,
    maxHue = 0;
  const widths = [];
  const hueOf = (r, g, b) => Math.atan2(r - g, g - b) * (180 / Math.PI);
  for (let y = y0; y < y1; y++) {
    let n = 0;
    for (let x = x0; x < x1; x++) {
      const o = (y * glass.w + x) * glass.ch;
      if (o + 3 >= glass.data.length) continue;
      const gR = glass.data[o],
        gG = glass.data[o + 1],
        gB = glass.data[o + 2];
      const bR = bg.data[o],
        bG = bg.data[o + 1],
        bB = bg.data[o + 2];
      const dRB = Math.abs(gR - gB) - Math.abs(bR - bB);
      const dGB = Math.abs(gG - gB) - Math.abs(bG - bB);
      if (dRB > 12) n++;
      maxRB = Math.max(maxRB, dRB);
      maxGB = Math.max(maxGB, dGB);
      // 色相偏移（色散/彩边的直接量）：仅在两图都有足够彩度处比较
      const cg = Math.hypot(gR - gG, gG - gB),
        cbg = Math.hypot(bR - bG, bG - bB);
      if (cg > 10 && cbg > 10) {
        let d = Math.abs(hueOf(gR, gG, gB) - hueOf(bR, bG, bB));
        if (d > 180) d = 360 - d;
        if (d > 8) n++;
        maxHue = Math.max(maxHue, d);
      }
    }
    widths.push(n);
  }
  return { maxRB, maxGB, maxHueDeg: +maxHue.toFixed(1), widthPx: widths.length ? median(widths) : 0 };
}

const results = [];
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 300));
});

for (const v of VARIANTS) {
  errs.length = 0;
  const url = 'file:///' + path.join(CAND, v.file).replace(/\\/g, '/');
  await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });
  await sleep(700);

  // ---- FPS 主协议：应用 rAF 3s × 3 次取中位（lead round-2/5 指定口径） ----
  const runs3s = [];
  for (let i = 0; i < 3; i++) {
    runs3s.push(await page.evaluate(() => window.__fps(3000)));
    await sleep(250);
  }
  const fpsPrimary = median(runs3s.map((r) => r.fps));
  // ---- 补充协议：2s × 5 次取中位（历史口径，保留作对照列；窗口更短会剔掉更多 GC/合成抖动） ----
  const runs2s = [];
  for (let i = 0; i < 5; i++) {
    runs2s.push(await page.evaluate(() => window.__fps(2000)));
    await sleep(250);
  }
  const fpsSupp = median(runs2s.map((r) => r.fps));
  // ---- 基线：同样的逐帧平移地图但没有玻璃（与主协议同窗 3s × 3 次） ----
  await page.evaluate(() => document.body.classList.add('m-bg'));
  const baseRuns = [];
  for (let i = 0; i < 3; i++) {
    baseRuns.push(await page.evaluate(() => window.__fps(3000)));
    await sleep(200);
  }
  const baseline = median(baseRuns.map((r) => r.fps));
  await page.evaluate(() => document.body.classList.remove('m-bg'));
  await sleep(300);

  // ---- 冻结 → 三态截图（同帧） ----
  await page.evaluate(() => {
    window.__freeze = true;
    window.__forceRedraw && window.__forceRedraw(); // 固定到 t=0 帧：三张截图与每次复算都同一帧
  });
  await sleep(400);
  // 2×2 解耦：{edge on/off} × {文字 on/off}，四帧都拍，隔离「边缘层」与「文字开关」两个因子
  const shot1 = path.join(SHOTS, v.key + '-glass-1536x730.png');
  await page.screenshot({ path: shot1 });
  await page.evaluate(() => document.body.classList.add('m-notext'));
  await sleep(250);
  const shot2 = path.join(SHOTS, v.key + '-notext.png');
  await page.screenshot({ path: shot2 });
  await page.evaluate(() => document.body.classList.add('m-noedge'));
  await sleep(250);
  const shot4 = path.join(SHOTS, v.key + '-noedge.png');
  await page.screenshot({ path: shot4 });
  // 第四帧（本轮新增）：noedge + 文字 —— 没有这一帧就无法把「字形栅格化」与「文字开关」分开
  await page.evaluate(() => document.body.classList.remove('m-notext'));
  await sleep(250);
  const shot5 = path.join(SHOTS, v.key + '-noedge-text.png');
  await page.screenshot({ path: shot5 });
  await page.evaluate(() => {
    document.body.classList.remove('m-noedge');
    document.body.classList.add('m-notext', 'm-bg');
  });
  await sleep(250);
  const shot3 = path.join(SHOTS, v.key + '-bgonly.png');
  await page.screenshot({ path: shot3 });
  await page.evaluate(() => document.body.classList.remove('m-bg', 'm-notext'));
  await sleep(200);

  const geom = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.card')].map((c) => {
      const r = c.getBoundingClientRect();
      return { id: c.dataset.id, rect: [r.left, r.top, r.width, r.height], round: c.classList.contains('round') };
    });
    const texts = [];
    for (const el of document.querySelectorAll('.t')) {
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) continue;
      const s = getComputedStyle(el);
      const m = s.color.match(/[\d.]+/g).map(Number);
      texts.push({
        role: el.dataset.role || 'text',
        txt: (el.textContent || '').trim().slice(0, 14),
        card: el.closest('.card').dataset.id,
        color: [m[0], m[1], m[2], m.length > 3 ? m[3] : 1],
        rect: [r.left, r.top, r.width, r.height],
        font: s.fontSize,
        shadow: s.textShadow.slice(0, 40),
      });
    }
    return { cards, texts };
  });

  const g1 = await raw(shot1), g2 = await raw(shot2), g3 = await raw(shot3), g4 = await raw(shot4), g5 = await raw(shot5);

  // ---- 中心透明度 ----
  const centers = [];
  for (const c of geom.cards) {
    const [x, y, w, h] = c.rect;
    const bw = Math.min(24, Math.max(8, Math.round(w * 0.08)));
    const bh = Math.min(24, Math.max(8, Math.round(h * 0.08)));
    const cx = Math.round(x + w / 2 - bw / 2),
      cy = Math.round(y + h / 2 - bh / 2);
    // 中心取样用「字隐」帧（g2）：否则小卡中心正好落在文字/图标上，把玻璃亮度测成字形亮度
    const s1 = regionStats(g2, cx, cy, bw, bh),
      s3 = regionStats(g3, cx, cy, bw, bh);
    const aCh = [0, 1, 2]
      .map((i) => {
        const fill = v.fill[i];
        const p = i === 0 ? s1.r : i === 1 ? s1.g : s1.b;
        const b = i === 0 ? s3.r : i === 1 ? s3.g : s3.b;
        return Math.abs(fill - b) > 25 ? (p - b) / (fill - b) : NaN;
      })
      .filter((n) => Number.isFinite(n));
    const alphaMeas = aCh.length ? aCh.reduce((x2, z) => x2 + z, 0) / aCh.length : null;
    centers.push({
      id: c.id,
      rect: c.rect.map((n) => Math.round(n)),
      sample: [cx, cy, bw, bh],
      lumGlass: +s1.lum.toFixed(4),
      lumBg: +s3.lum.toFixed(4),
      lumKeep: +(s1.lum / (s3.lum || 1e-6)).toFixed(3),
      stdRatio: +(s1.sd / (s3.sd || 1e-6)).toFixed(3),
      pearsonR: +pearson(s1.lums, s3.lums).toFixed(3),
      alphaMeas: alphaMeas === null ? null : +alphaMeas.toFixed(3),
      alphaMeasValid: alphaMeas !== null,
    });
  }

  // ---- 文字可读性 ----
  const texts = [];
  for (const t of geom.texts) {
    const [x, y, w, h] = t.rect;
    const sx = Math.round(x + 1),
      sy = Math.round(y + h * 0.28),
      sw = Math.max(3, Math.round(w - 2)),
      sh = Math.max(3, Math.round(h * 0.44));
    const sN = regionStats(g2, sx, sy, sw, sh); // 玻璃在、字隐 → 局部合成背景
    const sG = regionStats(g1, sx, sy, sw, sh); // 实际渲染（含字形）
    const sB = regionStats(g3, sx, sy, sw, sh); // 纯地图
    const [cr, cg, cb, ca] = t.color;
    const fr = cr * ca + sN.r * (1 - ca),
      fg = cg * ca + sN.g * (1 - ca),
      fb = cb * ca + sN.b * (1 - ca);
    const lt = lumOf(fr, fg, fb),
      lb = lumOf(sN.r, sN.g, sN.b);
    const hi = pct(sG.lums, 0.97),
      lo = pct(sG.lums, 0.03);
    const glyph = Math.abs(hi - lb) > Math.abs(lo - lb) ? hi : lo;
    const proj = [0, 1, 2].map((i) => 0.76 * [14, 14, 16][i] + 0.24 * [sB.r, sB.g, sB.b][i]);
    texts.push({
      msg: t.txt,
      role: t.role,
      card: t.card,
      rect: [Math.round(x), Math.round(y), Math.round(w), Math.round(h)],
      font: t.font,
      color: t.color,
      shadow: t.shadow,
      localBg: [Math.round(sN.r), Math.round(sN.g), Math.round(sN.b)],
      mapBg: [Math.round(sB.r), Math.round(sB.g), Math.round(sB.b)],
      lumText: +lt.toFixed(4),
      lumBg: +lb.toFixed(4),
      contrast: +contrast(lt, lb).toFixed(2),
      renderedContrast: +contrast(glyph, lb).toFixed(2),
      brightFillContrast: +contrast(lt, lumOf(proj[0], proj[1], proj[2])).toFixed(2),
    });
  }
  texts.sort((a, b) => a.contrast - b.contrast);

  // ---- 中心是否被边缘折射层污染：2×2 解耦（U2 硬证据） ----
  // 四个帧：g1=edge开+字、g2=edge开+无字、g4=edge关+无字、g5=edge关+字。
  // 「中心是否被污染」必须比「两帧都无字」的 g2 vs g4；「文字栅格化是否被改变」必须比「两帧都有字」的 g1 vs g5。
  // 旧口径 g1 vs g4 混入「文字开关」，数值不可用于结论（详见 scripts/phase2-edge-isolation.mjs）。
  const dataCardG = geom.cards.find((c) => c.id === 'data-panel');
  const [dcx, dcy, dcw, dch] = dataCardG.rect;
  const diffPx = (a, b, ax, ay, aw, ah) => {
    let n = 0;
    for (let y = Math.round(ay); y < Math.round(ay + ah); y++) {
      for (let x = Math.round(ax); x < Math.round(ax + aw); x++) {
        if (x < 0 || y < 0 || x >= a.w || y >= a.h) continue;
        const o = (y * a.w + x) * a.ch;
        if (Math.abs(a.data[o] - b.data[o]) > 1 || Math.abs(a.data[o + 1] - b.data[o + 1]) > 1 || Math.abs(a.data[o + 2] - b.data[o + 2]) > 1) n++;
      }
    }
    return n;
  };
  const interior = [dcx + 40, dcy + 40, dcw - 80, dch - 80];
  const centerChromatic = {
    region: 'data-panel interior (inset 40px, 72000px)',
    edgeOnVsOff_noText: diffPx(g2, g4, ...interior), // ① 纯边缘层效果（两帧都无字）
    edgeOnVsOff_withText: diffPx(g1, g5, ...interior), // ③ 文字栅格化效果（两帧都有字）
    legacy_withTextVsNoText: diffPx(g1, g4, ...interior), // round3 口径（混杂，仅留作对照）
    ring16_noText: diffPx(g2, g4, dcx + dcw - 16, dcy + 40, 16, dch - 80),
    interiorArea: Math.round((dcw - 80) * (dch - 80)),
    edgeOffShots: [path.relative(ROOT, shot4), path.relative(ROOT, shot5)],
    note: '三段式拆分（平坦中心 / 环带 / 文字 AA）+ 距离剖面 + 色度分离见 node scripts/phase2-edge-isolation.mjs → isolation/edge-isolation.json',
  };

  // ---- 边缘彩边（data-panel 右边，无内容带） ----
  const [dx, dy, dw, dh] = dataCardG.rect;
  const band = { x: dx + dw - 44, y: dy + dh - 130, w: 44, h: 110 };
  const edges = {};
  for (const dsf of [2, 4]) {
    await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: dsf });
    await sleep(500);
    await page.evaluate(() => {
      window.__freeze = true;
      window.__forceRedraw && window.__forceRedraw();
    });
    await sleep(250);
    const clip = { x: band.x, y: band.y, width: band.w, height: band.h };
    const gp = path.join(SHOTS, `${v.key}-edge${dsf}x.png`);
    await page.screenshot({ path: gp, clip });
    await page.evaluate(() => document.body.classList.add('m-bg'));
    await sleep(250);
    const bp = path.join(SHOTS, `${v.key}-edge${dsf}x-bgonly.png`);
    await page.screenshot({ path: bp, clip });
    await page.evaluate(() => document.body.classList.remove('m-bg'));
    await sleep(200);
    const gi = await raw(gp),
      bi = await raw(bp);
    const x0 = Math.round(16 * dsf),
      x1 = Math.round(42 * dsf),
      y0 = Math.round(10 * dsf),
      y1 = Math.round(100 * dsf);
    const sh = channelShift(gi, x0, x1, y0, y1, Math.round(10 * dsf));
    const fr = bandFringe(gi, bi, x0, x1, y0, y1);
    edges[dsf + 'x'] = {
      rows: sh.rows,
      shiftRB_devicePx: +sh.RB.toFixed(2),
      shiftRB_cssPx: +(sh.RB / dsf).toFixed(2),
      shiftGB_cssPx: +(sh.GB / dsf).toFixed(2),
      fringeRB: fr.maxRB,
      fringeGB: fr.maxGB,
      fringeWidth_cssPx: +(fr.widthPx / dsf).toFixed(2),
      maxHueDeg: fr.maxHueDeg,
      crop: path.relative(ROOT, gp),
      cropBg: path.relative(ROOT, bp),
    };
  }
  // 右上角特写（4x）
  await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 4 });
  await sleep(600);
  await page.evaluate(() => window.__forceRedraw && window.__forceRedraw());
  await sleep(250);
  const corner = path.join(SHOTS, `${v.key}-corner4x.png`);
  await page.screenshot({ path: corner, clip: { x: dx + dw - 40, y: dy, width: 40, height: 40 } });
  await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
  await sleep(300);

  results.push({
    key: v.key,
    name: v.name,
    declaredAlpha: v.alpha,
    fps: {
      verdictMetric: 'primary.median',
      primary: {
        protocol: 'app rAF count (window.__fps), window 3s × 3 runs, median — lead-specified protocol',
        windowMs: 3000,
        runs: runs3s.map((r) => +r.fps.toFixed(1)),
        median: +fpsPrimary.toFixed(1),
      },
      supplementary: {
        protocol: 'app rAF count (window.__fps), window 2s × 5 runs, median — legacy short-window column',
        windowMs: 2000,
        runs: runs2s.map((r) => +r.fps.toFixed(1)),
        median: +fpsSupp.toFixed(1),
      },
      baselineNoGlass: {
        protocol: 'same page, body.m-bg (no glass), window 3s × 3 runs, median',
        windowMs: 3000,
        runs: baseRuns.map((r) => +r.fps.toFixed(1)),
        median: +baseline.toFixed(1),
      },
    },
    centers,
    centerSummary: (() => {
      // 只在「背景有亮度」(L_bg>0.05) 的卡上做平均：黑太空区 lumKeep 会被 backdrop blur 拉爆，不具可比性
      const lit = centers.filter((c) => c.lumBg > 0.05);
      const avg = (arr) => (arr.length ? arr.reduce((a, c) => a + c, 0) / arr.length : null);
      const aLit = lit.filter((c) => c.alphaMeasValid).map((c) => c.alphaMeas);
      return {
        cardsTotal: centers.length,
        cardsLit: lit.length,
        lumKeepAvg: +(avg(lit.map((c) => c.lumKeep)) ?? NaN).toFixed(3),
        lumKeepMin: +Math.min(...lit.map((c) => c.lumKeep)).toFixed(3),
        lumKeepMax: +Math.max(...lit.map((c) => c.lumKeep)).toFixed(3),
        stdRatioAvg: +(avg(lit.map((c) => c.stdRatio)) ?? NaN).toFixed(3),
        pearsonAvg: +(avg(lit.map((c) => c.pearsonR)) ?? NaN).toFixed(3),
        pearsonMin: +Math.min(...lit.map((c) => c.pearsonR)).toFixed(3),
        alphaMeasAvg: aLit.length ? +avg(aLit).toFixed(3) : null,
        note: 'lumKeep/stdRatio/pearson 只在 L_bg>0.05 的卡上统计；alphaMeas 为近似值（backdrop blur/saturate 有偏）',
      };
    })(),
    texts,
    textSummary: {
      count: texts.length,
      min: texts[0].contrast,
      minRendered: +Math.min(...texts.map((t) => t.renderedContrast)).toFixed(2),
      minBrightFill: +Math.min(...texts.map((t) => t.brightFillContrast)).toFixed(2),
      under45: texts.filter((t) => t.contrast < 4.5).length,
      median: +median(texts.map((t) => t.contrast)).toFixed(2),
      worst: texts.slice(0, 5).map((t) => ({ msg: t.msg, card: t.card, role: t.role, contrast: t.contrast, mapBg: t.mapBg })),
    },
    centerChromatic,
    edges,
    corner: path.relative(ROOT, corner),
    shots: {
      glass: path.relative(ROOT, shot1),
      notext: path.relative(ROOT, shot2),
      bgonly: path.relative(ROOT, shot3),
      noedge: path.relative(ROOT, shot4),
      noedgeText: path.relative(ROOT, shot5),
    },
    consoleErrors: [...errs],
  });
  const r = results.at(-1);
  console.log(
    v.name,
    '| fps primary(3s×3)', r.fps.primary.median, '(base', r.fps.baselineNoGlass.median + ')',
    '| supp(2s×5)', r.fps.supplementary.median,
    '| lumKeep', r.centerSummary.lumKeepAvg,
    '| stdRatio', r.centerSummary.stdRatioAvg,
    '| r', r.centerSummary.pearsonAvg,
    '| alphaMeas', r.centerSummary.alphaMeasAvg,
    '| text-min', r.textSummary.min, 'med', r.textSummary.median,
    'u45', r.textSummary.under45 + '/' + r.textSummary.count,
    '| rendered-min', r.textSummary.minRendered,
    '| brightFill-min', r.textSummary.minBrightFill,
    '| centerEdge/noText', r.centerChromatic.edgeOnVsOff_noText + '/' + r.centerChromatic.interiorArea,
    'withText', r.centerChromatic.edgeOnVsOff_withText,
    'legacy', r.centerChromatic.legacy_withTextVsNoText,
    '| edge4x', JSON.stringify({ s: r.edges['4x'].shiftRB_cssPx, fRB: r.edges['4x'].fringeRB, fGB: r.edges['4x'].fringeGB, w: r.edges['4x'].fringeWidth_cssPx }),
    '| errs', errs.length,
  );
}

// ---- A / B / C 三联并排（真正的 3×1，各 760×361，带标签） ----
const small = [];
for (const v of VARIANTS) small.push(await sharp(path.join(SHOTS, v.key + '-glass-1536x730.png')).resize(760, 361).toBuffer());
const gap = 10;
const labelH = 28;
const cmpW = 760 * 3 + gap * 2;
const cmpLabels = `<svg width="${cmpW}" height="${labelH}" xmlns="http://www.w3.org/2000/svg">
<rect width="100%" height="100%" fill="#000"/>
<text x="10" y="19" font-family="Segoe UI, Arial" font-size="15" fill="#eaeef5">A 清透 CSS</text>
<text x="${770 + 10}" y="19" font-family="Segoe UI, Arial" font-size="15" fill="#eaeef5">B 3:25 原版</text>
<text x="${1540 + 10}" y="19" font-family="Segoe UI, Arial" font-size="15" fill="#eaeef5">C 边缘混合</text>
</svg>`;
await sharp({ create: { width: cmpW, height: 361 + labelH, channels: 3, background: '#000' } })
  .composite([
    { input: Buffer.from(cmpLabels), left: 0, top: 0 },
    { input: small[0], left: 0, top: labelH },
    { input: small[1], left: 760 + gap, top: labelH },
    { input: small[2], left: (760 + gap) * 2, top: labelH },
  ])
  .png()
  .toFile(path.join(ROOT, 'compare.png'));

fs.writeFileSync(
  path.join(ROOT, 'metrics.json'),
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      viewport: [1536, 730],
      method: {
        fps: 'app rAF count via window.__fps(windowMs). primary = 3s × 3 runs, median (variants[].fps.primary.runs.length === 3, this is the verdict metric). supplementary = 2s × 5 runs, median (legacy short window). baselineNoGlass = 3s × 3 runs, median. No glassStats, no HUD. Background canvas pans every frame, so glass must recompose every frame.',
        center: 'frozen frame; glass vs body.m-bg; lumKeep=L_glass/L_bg, stdRatio=std_glass/std_bg, pearsonR=corr(map identity), alphaMeas=(P_glass-P_bg)/(P_fill-P_bg) approx (blur/saturate bias)',
        centerChromatic:
          '4 frozen frames = {edge on/off} × {text on/off}. center contamination = edgeOn+noText vs edgeOff+noText (part1); glyph rasterization = edgeOn+text vs edgeOff+text (part3); legacy = edgeOn+text vs edgeOff+noText (confounded by text on/off, kept for traceability only). Interior = data-panel inset 40px = 72000px; changed = max channel |Δ| > 1. Distance bins / chroma split / images: scripts/phase2-edge-isolation.mjs',
        edge: 'dsf 2/4 crop of data-panel right edge, content-free band (y=dy+dh-130..-20, x=dw-44..dw); per-channel edge centroid; fringe = max(|R-B|glass - |R-B|bg)',
        text: 'WCAG contrast of computed color vs local composited bg (notext shot); renderedContrast = p97/p3 glyph luminance vs local bg; brightFillContrast = analytic projection with App bright-mode fill 0.76',
      },
      compareImage: {
        file: 'compare.png',
        layout: 'A | B | C 3×1 side by side, each 760×361, 10px gaps, 28px label row → 2300×389',
        note: 'round3 指出之前是 2×2 带黑格（1530×732）却写成「三联并排」；本轮改成真正的 3×1 并加标签',
      },
      variants: results,
    },
    null,
    1,
  ),
);
await browser.close();
