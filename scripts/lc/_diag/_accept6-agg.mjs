import { readFileSync, writeFileSync } from 'node:fs';
const O = '.gev-logs/lc/boot';
const rows = [];
for (const tag of ['a6a', 'a6b']) {
  const d = JSON.parse(readFileSync(`${O}/accept6-${tag}.json`, 'utf8'));
  d.raw.forEach((r, i) => rows.push({ ...r, runId: `${tag}-${i + 1}` }));
}
const f = (x) => (x == null ? 'null' : x);
const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(1);
};
console.log('run        loading  B5std  B5uniq  W1fps  W1worst  W1>100  W2rampWorst  W2fps  tileset→content  reason');
for (const r of rows)
  console.log(
    `${r.runId.padEnd(10)} ${String(f(r.loadingMs)).padStart(7)} ${String(f(r.b5 && r.b5.std)).padStart(6)} ${String(f(r.b5 && r.b5.uniq)).padStart(7)} ` +
      `${String(f(r.w1 && r.w1.fpsMean)).padStart(6)} ${String(f(r.w1 && r.w1.worst)).padStart(8)} ${String(f(r.w1 && r.w1.over100)).padStart(7)} ` +
      `${String(f(r.w2 && r.w2.worst)).padStart(12)} ${String(f(r.w2 && r.w2.fpsMean)).padStart(6)} ${String(f(r.tilesetToContent)).padStart(16)}  ${r.reason}`,
  );
const L = rows.map((r) => r.loadingMs);
const agg = {
  runs: rows.length,
  loadingMs: L,
  loadingMedian: med(L),
  loadingMin: Math.min(...L),
  loadingMax: Math.max(...L),
  pass5s: L.filter((x) => x <= 5000).length + '/' + L.length,
  b5Std: rows.map((r) => r.b5.std),
  b5Uniq: rows.map((r) => r.b5.uniq),
  b5Pass: rows.filter((r) => r.b5Pass).length + '/' + rows.length,
  w1Fps: rows.map((r) => r.w1.fpsMean),
  w1Worst: rows.map((r) => r.w1.worst),
  w1Over100: rows.map((r) => r.w1.over100),
  w1Over100Sum: rows.reduce((a, r) => a + r.w1.over100, 0),
  w2RampWorst: rows.map((r) => r.w2.worst),
  w2Over100Sum: rows.reduce((a, r) => a + r.w2.over100, 0),
  tilesetToContent: rows.map((r) => r.tilesetToContent),
  tilesetToContentMedian: med(rows.map((r) => r.tilesetToContent)),
  decideToMaskGone: rows.map((r) => r.decideToMaskGone),
  maskLongFrames: rows.map((r) => r.maskLongFrames),
  maskLongFramesVisible: rows.map((r) => r.maskLongFramesVisible),
  gpu: [...new Set(rows.map((r) => r.gpuRenderer))],
  reasons: rows.map((r) => r.reason),
  errors: rows.flatMap((r) => r.errors || []).slice(0, 10),
  shots: rows.map((r) => r.screenshot),
};
writeFileSync(`${O}/accept6-final.json`, JSON.stringify({ agg, rows }, null, 1));
console.log('\n' + JSON.stringify(agg, null, 1));
