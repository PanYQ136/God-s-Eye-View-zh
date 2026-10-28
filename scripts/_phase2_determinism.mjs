#!/usr/bin/env node
/**
 * _phase2_determinism.mjs —— 三次独立复算的逐字段差异（只排除 fps 与 measuredAt）
 * 用法: node scripts/_phase2_determinism.mjs
 * 输出: .gev-logs/phase2/determinism.json + 控制台摘要
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('.gev-logs/phase2');
const files = ['metrics-pass1.json', 'metrics-pass2.json', 'metrics-pass3.json'].map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')));
const SKIP = new Set(['measuredAt', 'fps', 'consoleErrors', 'corner', 'crop', 'cropBg']);
const diffs = [];

function walk(a, b, p) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (a !== b) diffs.push({ path: p, a, b, delta: +(b - a).toFixed(6) });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return diffs.push({ path: p, a: `len ${a.length}`, b: `len ${b.length}`, delta: null });
    for (let i = 0; i < a.length; i++) walk(a[i], b[i], `${p}[${i}]`);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (SKIP.has(k)) continue;
      walk(a[k], b[k], p ? `${p}.${k}` : k);
    }
    return;
  }
  if (a !== b) diffs.push({ path: p, a, b, delta: null });
}

walk(files[0], files[1], '');
walk(files[0], files[2], '');
const maxDelta = diffs.reduce((m, d) => Math.max(m, Math.abs(d.delta || 0)), 0);
const nonNumeric = diffs.filter((d) => d.delta === null);
const out = {
  comparedAt: new Date().toISOString(),
  files: ['metrics-pass1.json', 'metrics-pass2.json', 'metrics-pass3.json'],
  ignoredKeys: [...SKIP],
  differingFieldCount: diffs.length,
  maxAbsDelta: +maxDelta.toFixed(6),
  nonNumericDiffs: nonNumeric.length,
  diffs: diffs.slice(0, 200),
};
fs.writeFileSync(path.join(ROOT, 'determinism.json'), JSON.stringify(out, null, 1));
console.log('differing fields (excluding fps/measuredAt/paths):', diffs.length, '| max abs delta', maxDelta, '| non-numeric', nonNumeric.length);
for (const d of diffs.slice(0, 20)) console.log(' ', d.path, d.a, '->', d.b, '(Δ', d.delta, ')');
