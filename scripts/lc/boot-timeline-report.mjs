#!/usr/bin/env node
/* 由 baseline-*.json 生成可交付的报告表（中位数检查点 + 阶段 + 长任务归桶）
   用法: node scripts/lc/boot-timeline-report.mjs .gev-logs/lc/boot/baseline-prod.json [more.json...]
   产物: 控制台 markdown + 同名 .md
*/
import { readFileSync, writeFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) files.push('.gev-logs/lc/boot/baseline-prod.json');

/* 里程碑（用于「大头是谁」的汇总，不含子阶段重叠，直接对总和负责） */
const MILESTONES = [
  ['nav', 'app:ready', '启动前半程：HTML/CSS/模块/Viewer/tileset/App 各阶段'],
  ['app:ready', 'gate:cine:done', 'app ready 之后相机飞行剩余部分'],
  ['gate:cine:done', 'gate:view:content', '相机落位 → 最终视角真正出图'],
  [
    'gate:view:content',
    'gate:view:settled',
    '内容稳定期（SETTLE_MS，未计入等待）',
  ],
  ['gate:view:settled', 'gate:mask:gone', '判定 → 遮罩淡出到不可见'],
];

/* 关键检查点对的说明（只影响可读性，不影响数值） */
const STAGE_NOTES = {
  'net:responseStart → net:domInteractive': 'HTML/CSS 解析到 DOM 可交互',
  'net:domInteractive → gate:eval': '模块图①（gate + cesium）',
  'gate:eval → viewer:module-eval': '模块图②（主应用链路）',
  'viewer:module-eval → main:entry': 'main 模块求值',
  'main:entry → scene:begin': 'App 组合 + 状态恢复',
  'scene:begin → viewer:construct:begin': '容器/credit 准备',
  'viewer:construct:begin → viewer:construct:end':
    'Cesium.Viewer 构造（WebGL + 首套 shader）',
  'viewer:construct:end → viewer:ready': '场景参数/防护层安装',
  'viewer:ready → tileset:fetch:begin': '进入 tileset 请求',
  'tileset:fetch:begin → net:dcl': 'tileset 元数据请求与 DCL 竞速',
  'net:dcl → net:load': 'load 事件前剩余资源（App 数据/样式/图片）',
  'net:load → tileset:fetch:end': 'ion/Google tileset 元数据返回',
  'tileset:fetch:end → tileset:added': 'primitives.add',
  'tileset:added → gate:tileset:added': 'gate 发现 tileset',
  'gate:tileset:added → gate:cine:go': 'gate 放行相机（等 2 帧）',
  'gate:cine:go → basemap:setStack:begin':
    '底图源解析（网络探测）+ 相机飞行并行段',
  'basemap:setStack:begin → basemap:setStack:end': '底图源激活',
  'basemap:setStack:end → scene:ready': 'scene 收尾',
  'scene:ready → app:phase:controls': '进入 controls 阶段',
  'app:phase:controls → app:phase:data': 'controls 构造',
  'app:phase:data → app:phase:tools': 'data 构造',
  'app:phase:tools → chrome:begin': 'tools 构造',
  'chrome:begin → app:ready': '启动条/遮罩控制挂载',
  'app:ready → gate:cine:done': '相机飞行剩余',
  'gate:cine:done → gate:tileset:firstContent': '落位后等首批瓦片',
  'gate:cine:done → gate:view:content': '落位后等最终视角出图',
  'gate:tileset:firstContent → gate:view:content': '首批瓦片 → 探针达标',
  'gate:view:content → gate:tileset:firstContent': '探针达标 → 首批瓦片回调',
  'gate:view:content → gate:view:settled': '内容稳定期（SETTLE_MS=700）',
  'gate:tileset:firstContent → gate:view:settled':
    '内容稳定期（SETTLE_MS=700）',
  'gate:view:settled → mask:hide-request': 'gate 就绪 → 遮罩收起请求',
  'mask:hide-request → mask:hidden': '加 .hidden 类',
  'mask:hidden → gate:mask:gone': '遮罩淡出（opacity<0.05）',
};

const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(1);
};

for (const file of files) {
  const d = JSON.parse(readFileSync(file, 'utf8'));
  const runs = d.runs;
  /* 检查点中位数 */
  const cp = new Map();
  for (const r of runs) {
    for (const c of r.timeline?.checkpoints || []) {
      if (!cp.has(c.name)) cp.set(c.name, []);
      cp.get(c.name).push(c.t);
    }
  }
  const med = (name) => median(cp.get(name) || []);
  const totals = runs.map((r) => r.timeline?.total).filter(Number.isFinite);
  const totalMed = median(totals);

  const lines = [];
  const out = (s = '') => {
    lines.push(s);
    console.log(s);
  };

  out(
    `## 冷启动分阶段基线 · ${d.summary.tag}（${runs.length} 次冷启动，锚点 = navigationStart）`,
  );
  out('');
  out(`- URL: \`${d.summary.url}\``);
  out(`- GPU: \`${d.summary.gpu[0]}\``);
  out(
    `- 总 loading 中位数: **${totalMed} ms**（min ${Math.min(...totals)} / max ${Math.max(...totals)}）`,
  );
  out(
    `- 阶段之和 / 总 loading 覆盖误差: **${d.summary.coverageErrorPct.median}% / max ${d.summary.coverageErrorPct.max}%**（阈值 5%）`,
  );
  out(
    `- 独立校验（harness 墙钟轮询遮罩消失）: 中位数 ${d.summary.wallReveal.median} ms，与时间线差 **${d.summary.wallVsTimelinePct}%**`,
  );
  out('');
  out('### 检查点绝对偏移（ms，中位数）');
  out('');
  out('| 检查点 | 中位偏移 | 样本 n |');
  out('| --- | ---: | ---: |');
  for (const [name, xs] of [...cp.entries()].sort(
    (a, b) => median(a[1]) - median(b[1]),
  )) {
    out(`| \`${name}\` | ${median(xs)} | ${xs.length} |`);
  }

  out('');
  out('### 里程碑（对总和负责，无重叠）');
  out('');
  out('| 里程碑 | 说明 | 中位 ms | 占总比 |');
  out('| --- | --- | ---: | ---: |');
  for (const [a, b, label] of MILESTONES) {
    const ta = a === 'nav' ? 0 : med(a);
    const tb = med(b);
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) continue;
    const ms = +(tb - ta).toFixed(1);
    out(
      `| \`${a} → ${b}\` | ${label} | ${ms} | ${totalMed ? +((ms / totalMed) * 100).toFixed(1) : '-'}% |`,
    );
  }

  out('');
  out('### 阶段（按检查点中位偏移排序后逐段差分，覆盖整条时间线）');
  out('');
  out('| 阶段 | 说明 | 中位 ms | 占总比 |');
  out('| --- | --- | ---: | ---: |');
  const ordered = [...cp.entries()]
    .map(([name, xs]) => ({ name, t: median(xs), n: xs.length }))
    .sort((x, y) => x.t - y.t);
  let sum = 0;
  for (let i = 1; i < ordered.length; i++) {
    const key = `${ordered[i - 1].name} → ${ordered[i].name}`;
    const ms = +(ordered[i].t - ordered[i - 1].t).toFixed(1);
    if (ms < 0) continue;
    sum += ms;
    out(
      `| \`${key}\` | ${STAGE_NOTES[key] || ''} | ${ms} | ${totalMed ? +((ms / totalMed) * 100).toFixed(1) : '-'}% |`,
    );
  }
  out(
    `| **合计** |  | **${+sum.toFixed(1)}** | **${totalMed ? +((sum / totalMed) * 100).toFixed(1) : '-'}%** |`,
  );

  /* 长任务归桶（按检查点中位偏移切段） */
  const cuts = [...cp.entries()]
    .map(([name, xs]) => ({ name, t: median(xs) }))
    .filter((c) => c.name !== 'nav')
    .sort((x, y) => x.t - y.t);
  const bucket = (t) => {
    let label = 'nav → 首个检查点';
    for (let i = 0; i < cuts.length; i++) {
      if (t >= cuts[i].t) label = `${cuts[i].name} 之后`;
      else {
        label = `→ ${cuts[i].name}`;
        break;
      }
    }
    return label;
  };
  const tasks = [];
  for (const r of runs)
    for (const lt of r.timeline?.longTasks || [])
      tasks.push({ ...lt, run: r.run });
  tasks.sort((x, y) => y.dur - x.dur);
  out('');
  out('### 主线程长任务 Top10（>50ms，归到检查点区间）');
  out('');
  out('| 开始 ms | 时长 ms | 区间 |');
  out('| ---: | ---: | --- |');
  for (const t of tasks.slice(0, 10))
    out(`| ${t.start} | ${t.dur} | ${bucket(t.start)} |`);
  const byBucket = {};
  for (const t of tasks) {
    const b = bucket(t.start);
    byBucket[b] ||= { n: 0, total: 0, max: 0 };
    byBucket[b].n++;
    byBucket[b].total += t.dur;
    byBucket[b].max = Math.max(byBucket[b].max, t.dur);
  }
  out('');
  out('#### 长任务按区间汇总（全部 6 次）');
  out('');
  out('| 区间 | 条数 | 合计 ms | 最长 ms |');
  out('| --- | ---: | ---: | ---: |');
  for (const [k, v] of Object.entries(byBucket).sort(
    (a, b) => b[1].total - a[1].total,
  ))
    out(`| ${k} | ${v.n} | ${v.total} | ${v.max} |`);

  /* 帧 */
  const worst = runs.map((r) => r.timeline?.worstFrame);
  const longFrameCounts = runs.map(
    (r) => (r.timeline?.longFrames || []).length,
  );
  const gatedLong = runs.map(
    (r) =>
      (r.timeline?.longFrames || []).filter((f) => (f.maskOp ?? 0) >= 0.95)
        .length,
  );
  out('');
  out('### 帧');
  out('');
  out(`- 每次启动记录帧数: ${runs.map((r) => r.timeline?.frames).join(' / ')}`);
  out(`- 最差单帧: ${worst.join(' / ')} ms`);
  out(
    `- >50ms 帧数: ${longFrameCounts.join(' / ')}；其中遮罩 ≥0.95 之下的: ${gatedLong.join(' / ')}`,
  );

  /* 资源 */
  const res = runs[0]?.timeline?.resources;
  if (res) {
    out('');
    out('### 资源（首次运行）');
    out('');
    out(
      `- 请求数 ${res.count}，传输 ${res.mb} MB，最晚响应结束 ${res.lastResponseEnd} ms`,
    );
    out(
      `- 分组: ${Object.entries(res.groups)
        .map(([k, v]) => `${k} n=${v.n} ${v.mb}MB`)
        .join(' / ')}`,
    );
    out('');
    out('| 最慢请求 | ms | 组 |');
    out('| --- | ---: | --- |');
    for (const x of res.slowest.slice(0, 8))
      out(`| \`${x.name}\` | ${x.dur} | ${x.group} |`);
  }

  const md = lines.join('\n') + '\n';
  const mdFile = file.replace(/\.json$/, '.md');
  writeFileSync(mdFile, md);
  console.log('\n写出:', mdFile, '\n');
}
