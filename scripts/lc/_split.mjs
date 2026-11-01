#!/usr/bin/env node
/* 把一个「没有文件级层」的样式表拆成：
     @layer components { <其余全部> }
   + 若干 @layer overrides { <命中 keep 正则的顶层规则> }
   用途：dock 文件里绝大多数规则属于组件层，少数「压平材质外壳」的规则必须压过 material 层。
   用法: node scripts/lc/_split.mjs <file.css> <keepRegex...> */
import { readFileSync, writeFileSync } from 'node:fs';
const [file, ...pats] = process.argv.slice(2);
const keep = pats.map((p) => new RegExp(p));
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
const base = [], lifted = [], kept = new Set();
for (const b of blocks) {
  const raw = lines.slice(b.start, b.end + 1).join('\n');
  const s = b.sel || '';
  const isGroup = !s || /^@/.test(s);
  if (!isGroup && keep.some((r) => r.test(s))) { lifted.push(raw); b.start >= 0 && kept.add(b); }
  else base.push(raw);
}
if (!lifted.length) { console.log(file + ': no match, unchanged'); process.exit(0); }
/* 保留文件头部注释（第一个块之前的行） */
const head = lines.slice(0, blocks.length ? blocks[0].start : lines.length).join('\n').trim();
let out = `${head}\n\n/* Phase8D #13：本文件默认属于 components 层；带 overrides 的规则
   必须压过 material 层（材质唯一来源），因此显式提升层级。 */\n@layer components {\n${base.join('\n\n')}\n}\n`;
for (const b of lifted) out += `\n@layer overrides {\n${b}\n}\n`;
writeFileSync(file, out);
console.log(`${file}: components=${base.length} overrides=${lifted.length}`);
