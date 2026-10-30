#!/usr/bin/env node
/* 归因：把某段 [t0,t1] 内到达/在飞的资源列表打印出来（全量资源来自 harness） */
import { readFileSync } from 'node:fs';

const file = process.argv[2] || '.gev-logs/lc/boot/baseline-prod.json';
const run = Number(process.argv[3] || 1);
const t0 = Number(process.argv[4] || 0);
const t1 = Number(process.argv[5] || 2000);
const d = JSON.parse(readFileSync(file, 'utf8'));
const r = d.runs.find((x) => x.run === run);
const rows = (r.resources || []).filter((x) => x.end >= t0 && x.start <= t1);
console.log(
  `run${run} 区间 [${t0},${t1}] 内相关资源 ${rows.length} 条（按 end 排序）`,
);
for (const x of rows.sort((a, b) => a.end - b.end)) {
  console.log(
    `start ${String(x.start).padStart(8)} end ${String(x.end).padStart(8)} dur ${String(x.dur).padStart(7)} bytes ${String(x.bytes).padStart(8)} ${x.type.padEnd(9)} ${x.name.slice(0, 78)}`,
  );
}
const cp = Object.fromEntries(r.timeline.checkpoints.map((c) => [c.name, c.t]));
console.log('\ncheckpoints:', JSON.stringify(cp, null, 0));
