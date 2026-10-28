#!/usr/bin/env node
/** 对比两次 qa-expand-audit 结果（材质改动前后）：重叠面积 / 收起复原 rect / 按钮命中 / 窄态 */
import fs from 'node:fs';
const A = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const B = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const norm = (r) => JSON.stringify(r);
const cmpStates = (a, b, key) => {
  const out = { count: [a.length, b.length], mismatch: [] };
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    const ovx = (x.overlaps || []).map((o) => o.area ?? o.px2 ?? o);
    const ovy = (y.overlaps || []).map((o) => o.area ?? o.px2 ?? o);
    if (norm(ovx) !== norm(ovy)) out.mismatch.push({ i, key, overlaps: [ovx, ovy] });
    const selfA = x.self || {}, selfB = y.self || {};
    for (const f of ['hitOk', 'covered', 'cut', 'btnX', 'scrollable', 'bottomOk']) {
      if (selfA[f] !== selfB[f]) out.mismatch.push({ i, key, field: f, a: selfA[f], b: selfB[f] });
    }
  }
  return out;
};
const out = {
  single: cmpStates(A.single || [], B.single || [], 'single'),
  combos: cmpStates(A.combos || [], B.combos || [], "combos"),
  restoreEqual: norm(A.restore) === norm(B.restore),
  restoreDiffA: A.restoreDiff, restoreDiffB: B.restoreDiff,
  errors: [A.errors, B.errors],
};
console.log(JSON.stringify(out, null, 1));
