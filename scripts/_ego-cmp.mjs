import fs from 'node:fs';

function load(tag) {
  const p = `.gev-logs/ego/${tag}/summary.json`;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
const A = load(process.argv[2] || 'r6');
const B = load(process.argv[3] || 'r7');
const out = { a: A.tag, b: B.tag, viewports: [] };
for (let i = 0; i < A.runs.length; i++) {
  const a = A.runs[i], b = B.runs.find((r) => r.viewport.join('x') === a.viewport.join('x'));
  if (!b) { out.viewports.push({ vp: a.viewport, err: 'missing in b' }); continue; }
  const diffs = [];
  for (const id of Object.keys(a.initialRects)) {
    const ra = a.initialRects[id], rb = b.initialRects[id];
    if (JSON.stringify(ra) !== JSON.stringify(rb)) diffs.push({ what: 'initial:' + id, a: ra, b: rb });
  }
  for (let k = 0; k < a.steps.length; k++) {
    const sa = a.steps[k], sb = b.steps[k];
    if (JSON.stringify(sa.rect) !== JSON.stringify(sb.rect)) diffs.push({ what: 'step' + sa.n + ':' + sa.id, a: sa.rect, b: sb.rect });
  }
  if (JSON.stringify(a.finalFloating) !== JSON.stringify(b.finalFloating)) diffs.push({ what: 'finalFloating', a: a.finalFloating, b: b.finalFloating });
  out.viewports.push({ vp: a.viewport, diffs, identical: diffs.length === 0, failuresA: a.failures.length, failuresB: b.failures.length });
}
console.log(JSON.stringify(out, null, 1));
