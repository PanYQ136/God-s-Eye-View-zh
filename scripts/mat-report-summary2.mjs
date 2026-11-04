#!/usr/bin/env node
/** 汇总 report.json（v2：含 chips + ui） */
import fs from 'node:fs';
const p = process.argv[2] || 'evidence/_collab/t_fdd76e7a/after2/report.json';
const r = JSON.parse(fs.readFileSync(p, 'utf8'));
const rows = [];
for (const [k, ph] of Object.entries(r.phases)) {
  if (!ph || !ph.contrast) continue;
  const bad = [];
  for (const row of ph.contrast.rows) for (const t of row.texts) if (t.declared < 4.5) bad.push(`${row.id}:${t.t}=${t.declared}`);
  const chipBad = (ph.chips || []).filter((c) => c.declared < 4.5).map((c) => `${c.sel}:${c.t}=${c.declared}`);
  rows.push({ phase: k, lum: ph.lum, mat: ph.mat, worst: ph.contrast.worst, pass: ph.contrast.pass, bad: bad.slice(0, 8), chipWorst: ph.chips && ph.chips.length ? Math.min(...ph.chips.map((c) => c.declared)) : null, chipBad });
}
const cards = {};
for (const [k, ph] of Object.entries(r.phases)) if (ph && ph.cards) cards[k] = ph.cards;
const diffCards = (a, b) => {
  const A = cards[a], B = cards[b];
  if (!A || !B) return 'n/a';
  let n = 0, max = 0;
  for (const id of Object.keys(A)) {
    if (!B[id]) continue;
    for (let i = 0; i < 4; i++) { const d = Math.abs(A[id][i] - B[id][i]); max = Math.max(max, d); if (d > 0.6) n++; }
  }
  return { fieldsOff: n, maxDelta: +max.toFixed(2) };
};
const uiDiff = (a, b) => {
  const A = r.phases[a]?.ui || [], B = r.phases[b]?.ui || [];
  if (A.length !== B.length) return { countA: A.length, countB: B.length, diff: 'length mismatch' };
  const out = [];
  for (let i = 0; i < A.length; i++) {
    const d = A[i].r.map((v, j) => +(v - B[i].r[j]).toFixed(2));
    const ov = [A[i].sw - B[i].sw, A[i].cw - B[i].cw, A[i].sh - B[i].sh, A[i].ch - B[i].ch];
    if (d.some((v) => Math.abs(v) > 0.6) || ov.some((v) => v !== 0)) out.push({ k: A[i].k, d, overflowDelta: ov });
  }
  return { count: A.length, mismatches: out.length, sample: out.slice(0, 6) };
};
console.log(JSON.stringify({
  rows,
  layoutCards: {
    'dark vs dark-before': diffCards('dark', 'dark-before'),
    'bright vs bright-before': diffCards('bright', 'bright-before'),
    'white vs white-before': diffCards('white', 'white-before'),
  },
  layoutUi: {
    'dark vs dark-before': uiDiff('dark', 'dark-before'),
    'white vs white-before': uiDiff('white', 'white-before'),
  },
  uiCount: (r.phases.dark.ui || []).length,
  errors: r.errors, errorCount: r.errorCount,
  fps: r.fps,
  trays: { control: r.phases.tray?.['control-panel']?.opened, location: r.phases.tray?.['location-bar']?.opened },
}, null, 1));
