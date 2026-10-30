/* 一次性统计：cap 1/2 vs 2/4 的 A/B（置换检验，双尾）
   用法: node scripts/lc/_diag/_cap-ab-stats.mjs */
const A = {
  name: 'cap1/2',
  ladder: [8012, 7940, 9444, 8579, 11820, 10859, 10498],
  wall: [20502, 21181, 23622, 21032, 28050, 27193, 26186],
};
const B = {
  name: 'cap2/4',
  ladder: [7850, 8215, 8878, 8324, 10095, 7876, 7699],
  wall: [19194, 18976, 20090, 19146, 27023, 25608, 17823],
};
const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/* 精确置换检验：两组和之差（= 均值差），穷举/随机 200k 次 */
const perm = (a, b, iters = 200000) => {
  const all = [...a, ...b];
  const nA = a.length;
  const obs = med(a) - med(b);
  let cnt = 0;
  let cntMean = 0;
  const meanA = a.reduce((s, x) => s + x, 0) / a.length;
  const meanB = b.reduce((s, x) => s + x, 0) / b.length;
  const obsMean = meanA - meanB;
  let rnd = 123456789;
  const next = () => {
    rnd = (rnd * 1103515245 + 12345) & 0x7fffffff;
    return rnd / 0x7fffffff;
  };
  for (let it = 0; it < iters; it++) {
    const arr = [...all];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    const ga = arr.slice(0, nA);
    const gb = arr.slice(nA);
    if (Math.abs(med(ga) - med(gb)) >= Math.abs(obs)) cnt += 1;
    const mA = ga.reduce((s, x) => s + x, 0) / nA;
    const mB = gb.reduce((s, x) => s + x, 0) / (arr.length - nA);
    if (Math.abs(mA - mB) >= Math.abs(obsMean)) cntMean += 1;
  }
  return { obsMedianDiff: +obs.toFixed(0), pMedian: +(cnt / iters).toFixed(3), obsMeanDiff: +obsMean.toFixed(0), pMean: +(cntMean / iters).toFixed(3) };
};
for (const key of ['ladder', 'wall']) {
  const r = perm(A[key], B[key]);
  console.log(
    `${key}: A(${A.name}) median=${med(A[key])} mean=${(A[key].reduce((s, x) => s + x, 0) / A[key].length).toFixed(0)} | ` +
      `B(${B.name}) median=${med(B[key])} mean=${(B[key].reduce((s, x) => s + x, 0) / B[key].length).toFixed(0)} | ` +
      `Δmedian=${r.obsMedianDiff} p=${r.pMedian} | Δmean=${r.obsMeanDiff} p=${r.pMean}`,
  );
}
