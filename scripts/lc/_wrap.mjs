#!/usr/bin/env node
/* 就地把匹配的顶层规则块包进指定层（用于「必须压过 material 层」的少数规则）。
   用法: node scripts/lc/_wrap.mjs <file.css> <layer> <regex...> */
import { readFileSync, writeFileSync } from 'node:fs';
const [file, layer, ...pats] = process.argv.slice(2);
const res = pats.map((p) => new RegExp(p));
const lines = readFileSync(file, 'utf8').split('\n');
const blocks = [];
let depth = 0, start = 0, sel = '';
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (depth === 0 && !sel && l.trim() && !l.trim().startsWith('@') && !l.trim().startsWith('/*') && l.includes('{')) {
    sel = l.trim().replace(/\s*\{$/, '');
  }
  depth += (l.match(/{/g) || []).length - (l.match(/}/g) || []).length;
  if (depth === 0 && /[{}]/.test(l)) { blocks.push({ start, end: i, sel }); start = i + 1; sel = ''; }
}
const out = [];
let cursor = 0, wrapped = 0;
for (const b of blocks) {
  const s = b.sel || '';
  if (!s || /^@/.test(s)) continue;
  const hit = res.some((r) => r.test(s));
  if (!hit) continue;
  out.push(lines.slice(cursor, b.start).join('\n'));
  out.push(`@layer ${layer} {\n${lines.slice(b.start, b.end + 1).join('\n')}\n}`);
  cursor = b.end + 1;
  wrapped++;
}
out.push(lines.slice(cursor).join('\n'));
writeFileSync(file, out.join('\n'));
console.log(`${file}: wrapped ${wrapped} blocks in @layer ${layer}`);
