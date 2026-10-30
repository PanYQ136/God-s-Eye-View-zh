#!/usr/bin/env node
/* 聚合 fps-loaf 输出：长帧的脚本归因、无脚本长帧、main-thread blocking 分布 */
import { readFileSync } from 'node:fs';
const p = process.argv[2] || '.gev-logs/lc/fps-loaf/long.json';
const d = JSON.parse(readFileSync(p, 'utf8'));
const raw = d.rawLoaf || [];
const starts = raw.map((x) => x.start).sort((a, b) => a - b);
console.log('loaf entries', raw.length, 'start range', starts[0], starts[starts.length - 1]);
const minStart = Number(process.argv[3] || 0);
const loaf = raw.filter((x) => x.dur > 80 && x.start >= minStart);
console.log('dur>80ms entries (start>=' + minStart + '):', loaf.length);
const agg = new Map();
for (const e of loaf) {
  for (const s of e.scripts || []) {
    const k = `${s.fn || '(anon)'} @ ${s.url}:${s.line}`;
    agg.set(k, (agg.get(k) || 0) + s.dur);
  }
}
const rows = [...agg.entries()].sort((a, b) => b[1] - a[1]);
let tot = 0;
for (const [, v] of rows) tot += v;
console.log('total script ms inside long frames:', tot.toFixed(1));
for (const [k, v] of rows.slice(0, 12)) console.log('  ' + v.toFixed(1).padStart(9) + 'ms  ' + k);
const blocks = loaf.map((e) => e.blocking).sort((a, b) => b - a).slice(0, 15);
console.log('top blocking ms:', blocks.join(', '));
console.log('top styleLayout ms:', loaf.map((e) => e.styleLayout).sort((a, b) => b - a).slice(0, 8).join(', '));
const noScript = loaf.filter((e) => !e.scripts || e.scripts.reduce((s, x) => s + x.dur, 0) < 5);
console.log('long frames with <5ms script:', noScript.length, 'durs:', noScript.slice(0, 12).map((e) => e.dur).join(', '));
console.log('longtask:', (d.rawLong || []).length, (d.rawLong || []).map((x) => x.dur).sort((a, b) => b - a).slice(0, 10).join(', '));
console.log('frame:', JSON.stringify(d.summary.frame));
console.log('overlayDiag:', JSON.stringify(d.summary.overlayDiag));
console.log('detectionDiag:', JSON.stringify(d.summary.detectionDiag));
