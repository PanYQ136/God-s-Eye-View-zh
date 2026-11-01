#!/usr/bin/env node
/* Phase8D 工具：#13 样式层叠迁移的机械部分
   用法:
     node scripts/lc/_imp.mjs --count
     node scripts/lc/_imp.mjs --layer <file> <layerName>      包一层 @layer（备份后可逆）
     node scripts/lc/_imp.mjs --strip <file>                 删掉文件内全部 !important
     node scripts/lc/_imp.mjs --restore <file>               从备份还原
   备份目录: .gev-logs/lc/phase8d/bak/<path>.orig */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';

const BAK = '.gev-logs/lc/phase8d/bak';
const LIST = [
  'style.css',
  'src/ui/styles/foundation.css', 'src/ui/styles/controls.css', 'src/ui/styles/location.css',
  'src/ui/styles/status.css', 'src/ui/styles/cockpit.css', 'src/ui/styles/overlays.css',
  'src/ui/styles/layers.css', 'src/ui/styles/radio.css', 'src/ui/styles/cctv.css',
  'src/ui/styles/scenes.css', 'src/ui/styles/bhote-koshi.css', 'src/ui/styles/recent-imagery.css',
  'src/ui/styles/recording.css', 'src/ui/styles/responsive.css', 'src/ui/styles/command-dock.css',
  'src/ui/styles/command-dock-compact.css', 'src/ui/styles/command-dock-trays.css',
  'src/ui/styles/command-dock-sliding.css', 'src/ui/styles/voice-cost.css',
  'src/ui/styles/first-run.css', 'src/ui/styles/provider-settings.css', 'src/ui/styles/weather.css',
  'src/ui/styles/cyber.css', 'src/ui/styles/mobile-portrait.css',
  'public/gev-cn.css', 'public/gev-responsive.css', 'public/gev-fix.css', 'public/gev-panel-win.css',
  'src/lc/material.css',
];

const [, , cmd, a, b] = process.argv;
const count = (s) => (s.match(/!important/g) || []).length;

if (cmd === '--count') {
  let total = 0;
  const rows = [];
  for (const f of LIST) {
    if (!existsSync(f)) continue;
    const n = count(readFileSync(f, 'utf8'));
    total += n;
    if (n) rows.push([n, f]);
  }
  rows.sort((x, y) => y[0] - x[0]);
  for (const [n, f] of rows) console.log(String(n).padStart(4), f);
  console.log(String(total).padStart(4), '<TOTAL>');
} else if (cmd === '--strip') {
  const f = a;
  const src = readFileSync(f, 'utf8');
  backup(f);
  const out = src.replace(/\s*!important/g, '');
  writeFileSync(f, out);
  console.log(`${f}: ${count(src)} -> ${count(out)}`);
} else if (cmd === '--layer') {
  const f = a;
  const layer = b;
  const src = readFileSync(f, 'utf8');
  backup(f);
  const out = `@layer ${layer} {\n${src}\n}\n`;
  writeFileSync(f, out);
  console.log(`${f}: wrapped in @layer ${layer}`);
} else if (cmd === '--restore') {
  const f = a;
  restore(f);
  console.log(`${f}: restored (${count(readFileSync(f, 'utf8'))} !important)`);
} else {
  console.log('usage: --count | --layer <file> <layer> | --strip <file> | --restore <file>');
}

function backup(f) {
  const dst = path.join(BAK, f + '.orig');
  if (existsSync(dst)) return;
  mkdirSync(path.dirname(dst), { recursive: true });
  copyFileSync(f, dst);
}
function restore(f) {
  const src = path.join(BAK, f + '.orig');
  if (!existsSync(src)) throw new Error('no backup for ' + f);
  copyFileSync(src, f);
}
