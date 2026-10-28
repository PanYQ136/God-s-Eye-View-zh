#!/usr/bin/env node
/** 打印 tail3.json 的关键读数 */
import fs from 'node:fs';
const P = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/tail3.json';
const d = JSON.parse(fs.readFileSync(P, 'utf8'));
console.log('errors:', JSON.stringify(d.errors.slice(0, 4)));
console.log('chrome:', d.chrome);
for (const k of ['darkCollapsed', 'expandedStructure', 'darkCollapsedAfter', 'brightCollapsed']) {
  const s = d[k];
  if (!s) { console.log(k, 'MISSING'); continue; }
  console.log('\n== ' + k + ' glassLum=' + s.glassLum + ' glOn=' + s.glassOn);
  for (const c of s.cards) {
    if (!c.present) { console.log('  ' + c.id + ' absent'); continue; }
    console.log('  ' + c.id.padEnd(22) +
      ' col=' + String(c.collapsed).padEnd(5) +
      ' lcBg=' + String(c.lcBg).padEnd(24) +
      ' lum=' + String(c.lcLum).padEnd(7) +
      ' innerBg=' + String(c.innerBg).padEnd(24) +
      ' bgImg=' + String(c.innerBgImage).padEnd(6) +
      ' sw/cw=' + c.sw + '/' + c.cw + ' d=' + c.swDelta +
      ' tray=' + (c.tray ? c.tray.display + '/' + c.tray.visibility + '/' + c.tray.opacity : '-'));
  }
}
console.log('\n== tray open ==');
console.log(JSON.stringify(d.tray, null, 1));
console.log('\n== tray close ==');
console.log(JSON.stringify(d.trayClose, null, 1));
console.log('\n== contrast dark ==');
for (const r of d.darkContrast) console.log('  ', JSON.stringify(r));
console.log('\n== contrast bright ==');
for (const r of d.brightContrast) console.log('  ', JSON.stringify(r));
console.log('\n== glStats ==', JSON.stringify(d.glStats));
