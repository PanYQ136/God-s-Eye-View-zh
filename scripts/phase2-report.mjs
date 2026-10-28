#!/usr/bin/env node
/**
 * phase2-report.mjs —— 从 metrics.json + isolation/edge-isolation.json 生成 README 用的 markdown 表
 * 用法: node scripts/phase2-report.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.gev-logs/phase2');
const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'metrics.json'), 'utf8'));
const iso = JSON.parse(fs.readFileSync(path.join(ROOT, 'isolation/edge-isolation.json'), 'utf8'));
const passes = ['metrics-pass1.json', 'metrics-pass2.json', 'metrics-pass3.json'].map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')));
const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const V = ['A', 'B', 'C'];
const byKey = (d, k) => d.variants.find((v) => v.key === k);

console.log('### FPS（应用 rAF，主协议 3s × 3 次取中位；补充 2s × 5 次）\n');
console.log('| 候选 | 主协议 runs (3s) | 主协议中位 | 三次独立复算中位 | 补充 (2s×5) 中位 | 无玻璃基线 | 占基线 |');
console.log('|---|---|---|---|---|---|---|');
for (const k of V) {
  const v = byKey(m, k);
  const passMedians = passes.map((p) => p.variants.find((x) => x.key === k).fps.primary.median);
  console.log(
    `| ${k} | ${v.fps.primary.runs.join(' / ')} | **${v.fps.primary.median}** | ${passMedians.join(' / ')} → **${med(passMedians)}** | ${v.fps.supplementary.median} | ${v.fps.baselineNoGlass.median} | ${((100 * v.fps.primary.median) / v.fps.baselineNoGlass.median).toFixed(0)}% |`,
  );
}

console.log('\n### 中心亮度保留（两种采样窗）\n');
console.log('| 候选 | 24×24 中心采样点（9 卡中压在亮地形的 2 卡均值） | data-panel 24×24 | data-panel 整区 72000px（线性光） | data-panel 整区（gamma 均值） | 整区逐像素均值(gamma) |');
console.log('|---|---|---|---|---|---|');
for (const k of V) {
  const v = byKey(m, k);
  const f = iso.fullRegionLumKeep[k];
  const dc = v.centers.find((c) => c.id === 'data-panel');
  console.log(`| ${k} | ${v.centerSummary.lumKeepAvg} | ${dc.lumKeep} | ${f.lumKeepFull} | ${f.lumKeepFullGammaMean} | ${f.lumKeepPerPxGamma} |`);
}

console.log('\n### 边缘彩边（data-panel 右边无内容带，dsf 2/4 同帧纯背景对照）\n');
console.log('| 候选 | 2x 彩边宽 | 4x 彩边宽 | fringe R-B | fringe G-B | 色相最大偏移 | R-B 位移 |');
console.log('|---|---|---|---|---|---|---|');
for (const k of V) {
  const e = byKey(m, k).edges;
  console.log(`| ${k} | ${e['2x'].fringeWidth_cssPx} px | ${e['4x'].fringeWidth_cssPx} px | ${e['4x'].fringeRB} | ${e['4x'].fringeGB} | ${e['4x'].maxHueDeg}° | ${e['4x'].shiftRB_cssPx} px |`);
}

console.log('\n### 文字可读性（40 个文字盒，压最亮地形）\n');
console.log('| 候选 | 最低 | 中位 | <4.5 条数 | 亮底档 fill .76 投影最低 |');
console.log('|---|---|---|---|---|');
for (const k of V) {
  const t = byKey(m, k).textSummary;
  console.log(`| ${k} | ${t.min} | ${t.median} | ${t.under45}/${t.count} | ${t.minBrightFill} |`);
}

console.log('\n### C 的边缘层作用域（2×2 解耦，内区 72000px）\n');
const tp = iso.threePart;
console.log('| 段 | 比较 | 变化像素 | 占比 | maxΔ |');
console.log('|---|---|---|---|---|');
console.log(`| ① 平坦中心（两帧无字） | ${tp.part1_flatCenter.pair} | **${tp.part1_flatCenter.changed}** | 0% | ${tp.part1_flatCenter.maxDelta} |`);
console.log(`| ③ 文字 AA（两帧带字） | ${tp.part3_textAA.pair} | **${tp.part3_textAA.changed}** | 0% | ${tp.part3_textAA.maxDelta} |`);
console.log(`| legacy（round3 口径，混杂） | ${tp.legacy_round3_metric.pair} | ${tp.legacy_round3_metric.changed} | ${tp.legacy_round3_metric.pct}% | ${tp.legacy_round3_metric.maxDelta} |`);
console.log(`| 对照：只关文字 | ${tp.textToggle_control.pair} | ${tp.textToggle_control.changed} | ${tp.textToggle_control.pct}% | - |`);
console.log('\n环带分箱：');
console.log('| 距边框 | 像素 | 变化 | 占比 | 其中色度>8 |');
console.log('|---|---|---|---|---|');
for (const [k, b] of Object.entries(tp.part2_ringBand.bins)) console.log(`| ${k} | ${b.px} | ${b.changed} | ${b.pct}% | ${b.chroma} |`);
console.log('\nlegacy 阈值扫描（同一内区）：', JSON.stringify(iso.sweeps.legacy.changed));
console.log('textToggle 阈值扫描：', JSON.stringify(iso.sweeps.textToggle.changed));
console.log('同帧校验：', JSON.stringify(iso.sameFrame));
console.log('compare.png：', m.compareImage.layout);
