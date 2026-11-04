#!/usr/bin/env node
/** 汇总 qa-mat-audit 的 report.json：各 phase 的对比度明细 + 布局矩形一致性 */
import fs from 'node:fs';
const p = process.argv[2] || 'evidence/_collab/t_fdd76e7a/after/report.json';
const r = JSON.parse(fs.readFileSync(p, 'utf8'));
const out = {};
for (const [k, ph] of Object.entries(r.phases)) {
  if (!ph || !ph.contrast) continue;
  const bad = [];
  for (const row of ph.contrast.rows) for (const t of row.texts) if (t.declared < 4.5) bad.push([row.id, t.t, t.declared, t.color, t.fs]);
  out[k] = { lum: ph.lum, mat: ph.mat, worst: ph.contrast.worst, pass: ph.contrast.pass, below: bad };
}
const cards = {};
for (const [k, ph] of Object.entries(r.phases)) {
  if (ph && ph.cards) cards[k] = ph.cards;
}
// 布局 A/B：dark vs dark-before，light vs white-before 等
const diff = (a, b) => {
  const A = cards[a], B = cards[b];
  if (!A || !B) return null;
  const out = [];
  for (const id of Object.keys(A)) {
    if (!B[id]) continue;
    const d = A[id].map((v, i) => +(v - B[id][i]).toFixed(2));
    if (d.some((v) => Math.abs(v) > 0.6)) out.push({ id, after: A[id], before: B[id], d });
  }
  return out;
};
console.log(JSON.stringify({
  phases: out,
  layout: {
    'dark vs dark-before': diff('dark', 'dark-before'),
    'bright vs bright-before': diff('bright', 'bright-before'),
    'white vs white-before': diff('white', 'white-before'),
    'dark vs white (same build)': diff('dark', 'white'),
  },
  errors: r.errors,
  errorCount: r.errorCount,
  fps: r.fps,
  trays: { control: r.phases.tray?.['control-panel']?.opened, location: r.phases.tray?.['location-bar']?.opened },
  stylesAfter: {
    card: r.phases.dark.styles.card,
    tray: r.phases.tray?.['control-panel']?.styles?.tray,
    ppToggle: r.phases.dark.styles.ppToggle,
    chipLocate: r.phases.dark.styles.chipLocate,
    warp: r.phases.dark.styles.warp,
  },
}, null, 1));
