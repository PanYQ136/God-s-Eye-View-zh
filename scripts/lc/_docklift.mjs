#!/usr/bin/env node
/* 把 dock 文件里「压平材质外壳」的规则搬到 overrides 层（其余留在原层 = components）。
   用法: node scripts/lc/_docklift.mjs <file.css> [--dry]
   规则：只处理顶层块（@media 等分组块内部不动），按选择器前缀白名单匹配。 */
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const dry = process.argv.includes('--dry');
const KEEP_BELOW = [/dock-popover-content/, /dock-pin-btn/, /gev-voice-error/, /gev-voice-help/, /voice-error-tray/];
const LIFT = [
  /^#command-dock\s*>/, /^#command-dock\s+\.(panel|location|gev-voice|gev-mic|dock-label|dock-tray|btn-|style-btn|button-grid|search-toggle|location-(city|search|pills|pill|toolbar|bar-divider)|poi-)/,
  /^#command-dock\s+#(gev-voice|location-bar|control-panel)/,
  /^#command-dock\s*\{/,
];

const src = readFileSync(file, 'utf8');
const lines = src.split('\n');
/* 顶层块切分：靠花括号深度 */
const blocks = [];
let depth = 0, start = 0, sel = '';
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (depth === 0 && l.trim() && !sel && !l.trim().startsWith('@') && !l.trim().startsWith('/*') && l.includes('{')) sel = l.trim().replace(/\s*\{$/, '');
  const opens = (l.match(/{/g) || []).length;
  const closes = (l.match(/}/g) || []).length;
  depth += opens - closes;
  if (depth === 0 && opens + closes > 0) {
    blocks.push({ start, end: i, sel });
    start = i + 1; sel = '';
  }
}
const lifted = [], kept = [];
for (const b of blocks) {
  const raw = lines.slice(b.start, b.end + 1).join('\n');
  const s = b.sel || '';
  const isMedia = /^@/.test(s) || /^@/.test(lines[b.start].trim());
  const mustStay = KEEP_BELOW.some((r) => r.test(s)) || isMedia;
  const canLift = !mustStay && s && LIFT.some((r) => r.test(s));
  (canLift ? lifted : kept).push(raw);
}
if (dry) {
  console.log(JSON.stringify({ file, lifted: lifted.map((x) => x.split('\n')[0].slice(0, 70)), keptCount: kept.length }, null, 1));
  process.exit(0);
}
if (!lifted.length) { console.log(file + ': nothing to lift'); process.exit(0); }
const out = kept.join('\n\n') + '\n\n/* Phase8D #13：以下规则把卡片压成扁平 dock 托盘，必须压过 material 层 → 显式放 overrides */\n@layer overrides {\n' + lifted.join('\n\n') + '\n}\n';
writeFileSync(file, out);
console.log(`${file}: lifted ${lifted.length} blocks, kept ${kept.length}`);
