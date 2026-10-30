import { readFileSync, writeFileSync } from 'node:fs';
const O = '.gev-logs/lc/boot';
const groups = { dev4173: ['a6a', 'a6b'], prod4174: ['p6a', 'p6b'] };
const med = (xs) => {
  const s = [...xs].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(1)) : null;
};
const out = {};
for (const [label, tags] of Object.entries(groups)) {
  const rows = [];
  for (const tag of tags) {
    const d = JSON.parse(readFileSync(`${O}/accept6-${tag}.json`, 'utf8'));
    d.raw.forEach((r, i) => rows.push({ ...r, runId: `${tag}-${i + 1}` }));
  }
  const L = rows.map((r) => r.loadingMs);
  const agg = {
    runs: rows.length,
    loadingMs: L,
    loadingMedian: med(L),
    loadingMin: Math.min(...L),
    loadingMax: Math.max(...L),
    pass5s: `${L.filter((x) => x <= 5000).length}/${L.length}`,
    b5Std: rows.map((r) => r.b5.std),
    b5Uniq: rows.map((r) => r.b5.uniq),
    b5Pass: `${rows.filter((r) => r.b5Pass).length}/${rows.length}`,
    w1Fps: rows.map((r) => r.w1.fpsMean),
    w1Worst: rows.map((r) => r.w1.worst),
    w1Over100: rows.map((r) => r.w1.over100),
    w1Over100List: rows.map((r) => r.w1.over100List),
    w1Over100MaskOp: rows.map((r) => r.w1.over100MaskOp),
    runsWithOver100InW1: rows.filter((r) => r.w1.over100 > 0).length,
    w2RampWorst: rows.map((r) => r.w2.worst),
    w2Over100: rows.map((r) => r.w2.over100),
    w2Over100List: rows.map((r) => r.w2.over100List),
    rampPass: rows.filter((r) => r.w2.worst <= 100).length + '/' + rows.length,
    tilesetToContent: rows.map((r) => r.tilesetToContent),
    tilesetToContentMedian: med(rows.map((r) => r.tilesetToContent)),
    reasons: rows.map((r) => r.reason),
    gpu: [...new Set(rows.map((r) => r.gpuRenderer))],
    errors: rows.flatMap((r) => r.errors || []).slice(0, 6),
    shots: rows.map((r) => r.screenshot),
    raw: rows,
  };
  out[label] = agg;
  console.log(
    `\n### ${label}  runs=${agg.runs} loading=${L.join(',')} median=${agg.loadingMedian} ≤5s=${agg.pass5s}\n` +
      `B5 std=[${agg.b5Std.join(',')}] uniq=[${agg.b5Uniq.join(',')}] pass=${agg.b5Pass}\n` +
      `W1(0-10s) fps=[${agg.w1Fps.join(',')}] worst=[${agg.w1Worst.join(',')}] over100=[${agg.w1Over100.join(',')}] runsWithOver100=${agg.runsWithOver100InW1}\n` +
      `W1 over100 时刻=[${agg.w1Over100List.map((l) => '[' + l.join(' ') + ']').join(' ')}] maskOp=[${agg.w1Over100MaskOp.map((m) => m ?? '-').join(',')}]\n` +
      `W2(7-15s ramp) worst=[${agg.w2RampWorst.join(',')}] over100=[${agg.w2Over100.join(',')}] pass=${agg.rampPass}\n` +
      `tileset→content=[${agg.tilesetToContent.join(',')}] median=${agg.tilesetToContentMedian}\n` +
      `reason=${agg.reasons.join(',')} gpu=${agg.gpu.length} 种`,
  );
}
writeFileSync(`${O}/accept6-final.json`, JSON.stringify(out, null, 1));
