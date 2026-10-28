#!/usr/bin/env node
/**
 * phase2-edge-isolation.mjs —— 「C 的边缘折射层对中心的污染」可复算三段式（U2 硬证据 / U12）
 *
 * 背景（review round 3 B1）：上一轮交付写「中心 0/72000 像素被污染」。那个 0 是
 * 「glass+无字  vs  noedge 帧」比出来的，而 noedge 帧当时**也**处于 m-notext（无字）状态；
 * lead 用「glass(带字) vs noedge(无字)」比同一块 72000px 就得到 8633 px 变化。
 * 两个数字都不假，但都混进了「文字开/关」这个混杂因子，谁都没说明边缘层本身对中心做了什么。
 *
 * 本轮用 2×2 完整解耦（新增第四帧：noedge + 带字）：
 *        glass+字      glass+无字
 *        noedge+字     noedge+无字
 * 三段式：
 *   ① 平坦中心：两帧都无字，边缘层 on/off → 折射是否漏进内区（内缩 40px，72000px）
 *   ② 环带：同上两帧，按到边框距离分箱（0-15 / 16-23 / 24-39 / ≥40）
 *   ③ 文字 AA：两帧都带字，边缘层 on/off → 字形栅格化是否被改变
 * 另给 legacy 列（glass+字 vs noedge+无字 = round3 的 8633 口径）与 textToggle 对照列，
 * 让「8633 是怎么来的」也能复算。
 *
 * 用法: node scripts/phase2-edge-isolation.mjs [--variant=C]
 * 输入: .gev-logs/phase2/shots/{V}-{glass-1536x730,notext,noedge,noedge-text,bgonly}.png
 *        （前四个由 phase2-measure.mjs 生成；bgonly 用于中心透明度的背景基准）
 * 产物: .gev-logs/phase2/isolation/edge-isolation.json
 *       .gev-logs/phase2/isolation/{diff-pure-lens-x4,chroma-vs-achromatic-textAA-x4,state-on-off-bottom-x2}.png
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve('.gev-logs/phase2');
const SHOTS = path.join(ROOT, 'shots');
const OUT = path.join(ROOT, 'isolation');
fs.mkdirSync(OUT, { recursive: true });
const VR = (process.argv.find((a) => a.startsWith('--variant=')) || '--variant=C').split('=')[1];

const srgb2lin = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const lumOf = (r, g, b) => 0.2126 * srgb2lin(r) + 0.7152 * srgb2lin(g) + 0.0722 * srgb2lin(b);
const abs = Math.abs;

async function raw(p) {
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels, path: p };
}
const px = (img, x, y) => {
  const o = (y * img.w + x) * img.ch;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
};
const dmax = (a, b) => Math.max(abs(a[0] - b[0]), abs(a[1] - b[1]), abs(a[2] - b[2]));
const cb = (p) => 128 - 0.168736 * p[0] - 0.331264 * p[1] + 0.5 * p[2];
const cr = (p) => 128 + 0.5 * p[0] - 0.418688 * p[1] - 0.081312 * p[2];
const dchroma = (a, b) => Math.max(abs(cb(a) - cb(b)), abs(cr(a) - cr(b)));

const metrics = JSON.parse(fs.readFileSync(path.join(ROOT, 'metrics.json'), 'utf8'));
const layout = JSON.parse(fs.readFileSync(path.join(ROOT, 'layout.json'), 'utf8'));
const [CX, CY, CW, CH] = layout.cards.find((c) => c.id === 'data-panel').rect.map(Math.round);
const INSET = 40;
const IW = CW - 2 * INSET;
const IH = CH - 2 * INSET;

const glassT = await raw(path.join(SHOTS, `${VR}-glass-1536x730.png`)); // 边缘层 on  + 文字
const glassN = await raw(path.join(SHOTS, `${VR}-notext.png`)); //         边缘层 on  + 无字
const noEdgeN = await raw(path.join(SHOTS, `${VR}-noedge.png`)); //        边缘层 off + 无字
const noEdgeT = await raw(path.join(SHOTS, `${VR}-noedge-text.png`)); //   边缘层 off + 文字
const bgOnly = await raw(path.join(SHOTS, `${VR}-bgonly.png`)); //         无卡片整体 + 无字
const imgs = { glassT, glassN, noEdgeN, noEdgeT, bgOnly };
const dims = Object.fromEntries(Object.entries(imgs).map(([k, i]) => [k, `${i.w}x${i.h}`]));
const allSameSize = Object.values(dims).every((d) => d === '1536x730');

/* 同帧校验：卡外空地（无卡片覆盖）逐像素差 */
const blank = { x: 600, y: 150, w: 400, h: 300 };
function regionMaxDelta(a, b, r) {
  let m = 0,
    sum = 0,
    n = 0;
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const d = dmax(px(a, x, y), px(b, x, y));
      m = Math.max(m, d);
      sum += d;
      n++;
    }
  return { max: m, mean: +(sum / n).toFixed(3) };
}
const sameFrame = {
  blankRegion: blank,
  'glassT~glassN': regionMaxDelta(glassT, glassN, blank),
  'glassT~noEdgeT': regionMaxDelta(glassT, noEdgeT, blank),
  'glassN~noEdgeN': regionMaxDelta(glassN, noEdgeN, blank),
  'glassT~noEdgeN': regionMaxDelta(glassT, noEdgeN, blank),
  'glassN~bgOnly': regionMaxDelta(glassN, bgOnly, blank),
  note: '卡外空地 maxΔ；≤2 = 同帧冻结成功（同一 layout、同一地图帧）。卡内差异才是被测对象',
};

/* 文字盒（与 metrics.json 同源）：把「字形像素」与「背景像素」分开 */
const textRects = (metrics.variants.find((x) => x.key === VR).texts || [])
  .filter((t) => t.card === 'data-panel' && Array.isArray(t.rect) && t.rect.length === 4)
  .map((t) => t.rect);
const inTextRect = (x, y) => textRects.some((r) => x >= r[0] - 2 && x <= r[0] + r[2] + 2 && y >= r[1] - 2 && y <= r[1] + r[3] + 2);

const bins = [
  { label: '0-15px', lo: 0, hi: 15 },
  { label: '16-23px', lo: 16, hi: 23 },
  { label: '24-39px', lo: 24, hi: 39 },
  { label: '>=40px', lo: 40, hi: 1e9 },
];
const mkBins = () => Object.fromEntries(bins.map((b) => [b.label, { px: 0, changed: 0, chroma: 0 }]));
const sweepT = [0, 1, 2, 4, 8, 16];
const pctOf = (a, b) => +((100 * a) / (b || 1)).toFixed(2);

/** 比较两帧在 data 卡范围内的差异（整卡分箱 + 内区计数 + 阈值扫描） */
function analyze(a, b) {
  const prof = mkBins();
  const interior = { px: 0, changed: 0, changedInTextRect: 0, changedOutsideTextRect: 0, chroma: 0, maxDelta: 0 };
  const sweep = {};
  for (const t of sweepT) sweep[t] = 0;
  let maxDelta = 0;
  let maxChroma = 0;
  for (let y = CY; y < CY + CH; y++) {
    for (let x = CX; x < CX + CW; x++) {
      const A = px(a, x, y);
      const B = px(b, x, y);
      const d = dmax(A, B);
      const dC = dchroma(A, B);
      const dEdge = Math.min(x - CX, y - CY, CX + CW - 1 - x, CY + CH - 1 - y);
      const bin = bins.find((z) => dEdge >= z.lo && dEdge <= z.hi);
      prof[bin.label].px++;
      if (d > 1) {
        prof[bin.label].changed++;
        if (dC > 8) prof[bin.label].chroma++;
      }
      if (d > maxDelta) maxDelta = d;
      if (dC > maxChroma) maxChroma = dC;
      if (x >= CX + INSET && x < CX + CW - INSET && y >= CY + INSET && y < CY + CH - INSET) {
        interior.px++;
        for (const t of sweepT) if (d > t) sweep[t]++;
        if (d > 1) {
          interior.changed++;
          if (dC > 8) interior.chroma++;
          if (inTextRect(x, y)) interior.changedInTextRect++;
          else interior.changedOutsideTextRect++;
        }
        if (d > interior.maxDelta) interior.maxDelta = d;
      }
    }
  }
  return {
    pairs: `${path.basename(a.path)} vs ${path.basename(b.path)}`,
    interior: {
      px: interior.px,
      changed: interior.changed,
      pct: pctOf(interior.changed, interior.px),
      changedInTextRect: interior.changedInTextRect,
      changedOutsideTextRect: interior.changedOutsideTextRect,
      pctInTextRect: pctOf(interior.changedInTextRect, interior.changed),
      chroma: interior.chroma,
      maxDelta: interior.maxDelta,
    },
    byDistance: Object.fromEntries(
      Object.entries(prof).map(([k, v]) => [k, { px: v.px, changed: v.changed, pct: pctOf(v.changed, v.px), chroma: v.chroma }]),
    ),
    sweep: { region: 'interior 240x300 = 72000px', thresholds: sweepT, changed: sweep },
    maxDelta,
    maxChroma: +maxChroma.toFixed(1),
  };
}

const pureLens = analyze(glassN, noEdgeN); // ①② 两帧都无字：边缘层几何差异
const textAA = analyze(glassT, noEdgeT); // ③ 两帧都带字：字形栅格化差异
const legacy = analyze(glassT, noEdgeN); // round3 口径（混杂）
const textToggle = analyze(glassT, glassN); // 对照：只关文字、不关边缘层

/* 全区域内区 lumKeep（中心通透度；多口径，回答「29.3% 是 24×24 采样点」） */
const fullRegion = {};
for (const vk of ['A', 'B', 'C']) {
  const g = await raw(path.join(SHOTS, `${vk}-notext.png`));
  const b = await raw(path.join(SHOTS, `${vk}-bgonly.png`));
  let lG = 0;
  let lB = 0;
  let gamG = 0;
  let gamB = 0;
  let rLin = 0;
  let rGam = 0;
  let n = 0;
  let nLit = 0;
  const vg = [];
  const vb = [];
  for (let y = CY + INSET; y < CY + CH - INSET; y++)
    for (let x = CX + INSET; x < CX + CW - INSET; x++) {
      const a = px(g, x, y);
      const b2 = px(b, x, y);
      const lg = lumOf(a[0], a[1], a[2]);
      const lb = lumOf(b2[0], b2[1], b2[2]);
      const gg = (0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]) / 255;
      const gb = (0.2126 * b2[0] + 0.7152 * b2[1] + 0.0722 * b2[2]) / 255;
      vg.push(lg);
      vb.push(lb);
      lG += lg;
      lB += lb;
      gamG += gg;
      gamB += gb;
      n++;
      if (gb > 0.05) {
        rLin += lg / (lb || 1e-6);
        rGam += gg / gb;
        nLit++;
      }
    }
  const mG = lG / n;
  const mB = lB / n;
  let sdG = 0;
  let sdB = 0;
  for (let i = 0; i < n; i++) {
    sdG += (vg[i] - mG) ** 2;
    sdB += (vb[i] - mB) ** 2;
  }
  sdG = Math.sqrt(sdG / n);
  sdB = Math.sqrt(sdB / n);
  const dc = metrics.variants.find((x) => x.key === vk).centers.find((c) => c.id === 'data-panel');
  fullRegion[vk] = {
    region: [CX + INSET, CY + INSET, IW, IH],
    px: n,
    lumKeepFull: +(mG / (mB || 1e-6)).toFixed(3),
    stdRatioFull: +(sdG / (sdB || 1e-6)).toFixed(3),
    lumKeepFullGammaMean: +((gamG / n) / (gamB / n || 1e-6)).toFixed(3),
    lumKeepPerPxLinear: +(rLin / nLit).toFixed(3),
    lumKeepPerPxGamma: +(rGam / nLit).toFixed(3),
    litPx: nLit,
    lumKeep24x24Sample: dc.lumKeep,
    sample: dc.sample,
    note: 'lumKeepFull = 240×300 内区（无字帧 vs 纯背景帧）平均亮度比，sRGB 反伽马线性光（与 phase2-measure.mjs 的 lumOf 同定义）；另三列是别的口径，仅供对齐历史/lead 数字',
  };
}

/* 出图 */
const mkDiff = (a, b, mode) => {
  const buf = Buffer.alloc(CW * CH * 4);
  for (let y = 0; y < CH; y++)
    for (let x = 0; x < CW; x++) {
      const A = px(a, CX + x, CY + y);
      const B = px(b, CX + x, CY + y);
      const d = dmax(A, B);
      const dC = dchroma(A, B);
      let col = [0, 0, 0];
      if (d > 1) {
        if (mode === 'chroma') col = dC > 8 ? [Math.min(255, dC * 4), 0, 0] : [0, Math.min(255, d * 2), 0];
        else col = [Math.min(255, d * 3), Math.min(255, d * 3), Math.min(255, d * 3)];
      }
      const o = (y * CW + x) * 4;
      buf[o] = col[0];
      buf[o + 1] = col[1];
      buf[o + 2] = col[2];
      buf[o + 3] = 255;
    }
  return sharp(buf, { raw: { width: CW, height: CH, channels: 4 } }).resize(CW * 4, CH * 4, { kernel: 'nearest' });
};
await mkDiff(glassN, noEdgeN, 'gray').png().toFile(path.join(OUT, 'diff-pure-lens-x4.png'));
await mkDiff(glassT, noEdgeT, 'chroma').png().toFile(path.join(OUT, 'chroma-vs-achromatic-textAA-x4.png'));

const stripH = 30;
const stY = CY + CH - stripH;
const band = async (img) =>
  sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
    .extract({ left: CX, top: stY, width: CW, height: stripH })
    .resize(CW * 2, stripH * 2, { kernel: 'nearest' })
    .png()
    .toBuffer();
await sharp({ create: { width: CW * 2, height: stripH * 4 + 12, channels: 3, background: '#000' } })
  .composite([
    { input: await band(glassN), left: 0, top: 0 },
    { input: await band(noEdgeN), left: 0, top: stripH * 2 + 12 },
  ])
  .png()
  .toFile(path.join(OUT, 'state-on-off-bottom-x2.png'));

const ringWidth = (() => {
  const b = pureLens.byDistance;
  let w = 0;
  for (const [k, v] of [
    ['0-15px', 15],
    ['16-23px', 23],
    ['24-39px', 39],
  ])
    if (b[k].changed > 0) w = v;
  return w;
})();

const report = {
  script: 'scripts/phase2-edge-isolation.mjs',
  variant: VR,
  measuredAt: new Date().toISOString(),
  inputs: {
    edgeOnText: `shots/${VR}-glass-1536x730.png`,
    edgeOnNoText: `shots/${VR}-notext.png`,
    edgeOffNoText: `shots/${VR}-noedge.png`,
    edgeOffText: `shots/${VR}-noedge-text.png`,
    noCardsNoText: `shots/${VR}-bgonly.png`,
    dims,
    all1536x730: allSameSize,
  },
  sameFrame,
  dataCard: {
    id: 'data-panel',
    rect: [CX, CY, CW, CH],
    interiorRect: [CX + INSET, CY + INSET, IW, IH],
    insetPx: INSET,
    textBoxes: textRects.length,
  },
  threePart: {
    part1_flatCenter: {
      definition: '72000px 内区，两帧都无字：边缘层 on/off = 折射是否漏进中心',
      pair: pureLens.pairs,
      px: pureLens.interior.px,
      changed: pureLens.interior.changed,
      pct: pureLens.interior.pct,
      maxDelta: pureLens.interior.maxDelta,
      verdict: pureLens.interior.changed === 0 ? '0 变化：边缘层不影响中心' : '有变化：见 byDistance 分箱',
    },
    part2_ringBand: {
      definition: '同两帧（都无字）按到边框距离分箱',
      pair: pureLens.pairs,
      bins: pureLens.byDistance,
      measuredBandWidthPx: ringWidth,
      maxDelta: pureLens.maxDelta,
      note: '声明 0–12px 环 + blur(4px) 羽化；measuredBandWidthPx 取最外一个「有变化」的档上限',
    },
    part3_textAA: {
      definition: '72000px 内区，两帧都带字：边缘层 on/off = 字形栅格化是否被改变',
      pair: textAA.pairs,
      px: textAA.interior.px,
      changed: textAA.interior.changed,
      pct: textAA.interior.pct,
      changedInTextRect: textAA.interior.changedInTextRect,
      changedOutsideTextRect: textAA.interior.changedOutsideTextRect,
      maxDelta: textAA.interior.maxDelta,
      chroma: textAA.interior.chroma,
      verdict:
        textAA.interior.changed === 0
          ? '0 变化：边缘层不改变字形（无次像素 AA 退化）'
          : '字形像素有变化：Phase 3 必须复检字是否变糊',
    },
    legacy_round3_metric: {
      definition: 'round3 口径：glass+字 vs noedge+无字（混入「文字开关」混杂），内区 72000px',
      pair: legacy.pairs,
      changed: legacy.interior.changed,
      pct: legacy.interior.pct,
      chroma: legacy.interior.chroma,
      maxDelta: legacy.interior.maxDelta,
      note: '这个数字不能当成「边缘层污染中心」；其中的文字贡献见 textToggle_control',
    },
    textToggle_control: {
      definition: '对照：glass+字 vs glass+无字（不关边缘层，只关文字）',
      pair: textToggle.pairs,
      changed: textToggle.interior.changed,
      pct: textToggle.interior.pct,
      note: '用来解释 legacy 数字的量级来源',
    },
  },
  sweeps: { pureLens: pureLens.sweep, textAA: textAA.sweep, legacy: legacy.sweep, textToggle: textToggle.sweep },
  fullRegionLumKeep: fullRegion,
  images: {
    diffPureLens: 'isolation/diff-pure-lens-x4.png',
    chromaTextAA: 'isolation/chroma-vs-achromatic-textAA-x4.png',
    bottomStripOnOff: 'isolation/state-on-off-bottom-x2.png',
  },
  interpretation: {
    ring: '环带是真实折射：mask 12px + blur(4px) 羽化 + feDisplacementMap scale 26 的采样范围',
    textAA:
      '文字 AA 必须「两帧都带字」才有意义；round3 里 noedge 帧同时处于 m-notext 状态，所以那一轮的「文字失次像素 AA」推断来自混杂，以本脚本 part3 为准',
    method: 'changed = max channel |Δ| > 1；chroma = max(|ΔCb|,|ΔCr|) > 8；内区 = 卡内缩 40px（240×300 = 72000px）',
  },
};
fs.writeFileSync(path.join(OUT, 'edge-isolation.json'), JSON.stringify(report, null, 1));

console.log('== phase2 edge isolation (' + VR + ') ==');
console.log('dims all1536x730', allSameSize, JSON.stringify(dims));
console.log('sameFrame', JSON.stringify(sameFrame));
console.log('part1 flatCenter', JSON.stringify(report.threePart.part1_flatCenter));
console.log('part2 ringBand', JSON.stringify(report.threePart.part2_ringBand));
console.log('part3 textAA', JSON.stringify(report.threePart.part3_textAA));
console.log('legacy', JSON.stringify(report.threePart.legacy_round3_metric));
console.log('textToggle', JSON.stringify(report.threePart.textToggle_control));
console.log('sweeps', JSON.stringify(report.sweeps));
console.log('fullRegionLumKeep', JSON.stringify(fullRegion));
