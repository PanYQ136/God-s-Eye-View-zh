// 只比较两份指纹共有的元素（忽略新增/移除的瞬态节点），输出属性级差异
import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')));
const A = a.els || a, B = b.els || b;
const byProp = {}; const sample = [];
for (const k of Object.keys(A)) {
  if (!(k in B)) continue;
  for (const p of new Set([...Object.keys(A[k]), ...Object.keys(B[k])])) {
    const x = JSON.stringify(A[k][p]), y = JSON.stringify(B[k][p]);
    if (x !== y) { byProp[p] = (byProp[p] || 0) + 1; if (sample.length < 6) sample.push({ el: k, prop: p, a: A[k][p], b: B[k][p] }); }
  }
}
console.log(JSON.stringify({ shared: Object.keys(A).filter((k) => k in B).length, diffElements: sample.length ? Object.keys(byProp).length : 0, changed: Object.values(byProp).reduce((x, y) => x + y, 0), byProp, sample }, null, 1).slice(0, 1200));
