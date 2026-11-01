#!/usr/bin/env node
/* 指纹对比：node scripts/lc/_cssfp-diff.mjs a.json b.json [--max 40]
   输出：元素级差异（新增/消失/属性变化），按属性聚合计数。 */
import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2);
const MAX = Number((process.argv.includes('--max') ? process.argv[process.argv.indexOf('--max') + 1] : 40));
const A = JSON.parse(readFileSync(a, 'utf8')).els;
const B = JSON.parse(readFileSync(b, 'utf8')).els;
const EPS = { opacity: 0.01, transform: 0.01, translate: 0.01 };
const props = new Map();
const rows = [];
for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
  const x = A[k], y = B[k];
  if (!x || !y) { rows.push({ el: k, kind: x ? 'removed' : 'added' }); props.set(x ? 'removed' : 'added', (props.get(x ? 'removed' : 'added') || 0) + 1); continue; }
  const changed = [];
  for (const p of Object.keys(x)) {
    let eq;
    if (typeof x[p] === 'object') eq = JSON.stringify(x[p]) === JSON.stringify(y[p]);
    else if (EPS[p] != null) {
      /* JS 驱动的连续量（呼吸/插值）会有 1e-4 级抖动，按 epsilon 收敛 */
      const fx = parseFloat(x[p]), fy = parseFloat(y[p]);
      eq = Number.isFinite(fx) && Number.isFinite(fy) ? Math.abs(fx - fy) <= EPS[p] : x[p] === y[p];
    } else eq = x[p] === y[p];
    if (!eq) changed.push({ p, from: x[p], to: y[p] });
  }
  if (changed.length) { rows.push({ el: k, kind: 'changed', changed }); for (const c of changed) props.set(c.p, (props.get(c.p) || 0) + 1); }
}
console.log(JSON.stringify({
  elements: { a: Object.keys(A).length, b: Object.keys(B).length },
  diffElements: rows.length,
  byProp: Object.fromEntries([...props.entries()].sort((p, q) => q[1] - p[1])),
  sample: rows.slice(0, MAX),
}, null, 1));
process.exitCode = rows.length ? 1 : 0;
