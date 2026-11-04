#!/usr/bin/env node
/** sum-final.mjs —— 打印 final-report.json 的关键段落 */
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('evidence/_collab/t_8cf06356/final-report.json', 'utf8'));
console.log('ERR', JSON.stringify(d.errs.slice(0, 4)));
console.log('MAT', JSON.stringify(d.material));
console.log('\nEXPAND:');
for (const k in d.expand) { const v = d.expand[k]; console.log('  ' + k.padEnd(22), `(${v.x},${v.y},${v.w}x${v.h})`); }
console.log('\nEDGE (filter on vs off, data-panel 展开卡):');
for (const k in d.edge) console.log('  ' + k.padEnd(18), JSON.stringify(d.edge[k]));
console.log('\nTRANSPARENCY:', JSON.stringify(d.transparency, null, 1));
for (const tag of ['onMap', 'onWhite', 'onWhiteBright']) {
  if (!d.contrast[tag]) continue;
  console.log('\nCONTRAST ' + tag);
  for (const r of d.contrast[tag].rows) {
    const bad = r.contrast !== undefined && r.contrast < 4.5;
    console.log('   ' + String(r.card).padEnd(22), String(r.text || '').padEnd(8), 'fg', r.fg, 'bg', r.bg, 'ratio', r.contrast, bad ? 'FAIL' : 'ok');
  }
}
console.log('\nSCROLL', JSON.stringify(d.scrollbar));
console.log('\nPERF', JSON.stringify(d.perf));
console.log('\nSHOTS', JSON.stringify(d.screenshots));
