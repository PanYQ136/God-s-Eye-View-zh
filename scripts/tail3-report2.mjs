#!/usr/bin/env node
/** 打印 tail3.json 的关键读数（第 2 版：含 lumaAB） */
import fs from 'node:fs';
const P = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/tail3.json';
const d = JSON.parse(fs.readFileSync(P, 'utf8'));
console.log('errors:', JSON.stringify(d.errors.slice(0, 4)), 'chrome:', d.chrome);
for (const k of ['darkCollapsed', 'expandedStructure', 'darkCollapsedAfter', 'brightCollapsed']) {
  const s = d[k];
  if (!s) { console.log(k, 'MISSING'); continue; }
  console.log('\n== ' + k + ' glassLum=' + s.glassLum + ' glOn=' + s.glassOn);
  for (const c of s.cards) {
    if (!c.present) { console.log('  ' + c.id + ' absent'); continue; }
    console.log('  ' + c.id.padEnd(22) + ' col=' + String(c.collapsed).padEnd(5) +
      ' lcBg=' + String(c.lcBg).padEnd(24) + ' lum=' + String(c.lcLum).padEnd(7) +
      ' innerBg=' + String(c.innerBg).padEnd(24) + ' sw/cw=' + c.sw + '/' + c.cw + ' d=' + c.swDelta +
      ' tray=' + (c.tray ? c.tray.display + '/' + c.tray.visibility + '/' + c.tray.opacity : '-'));
  }
}
console.log('\n== lumaAB ==');
for (const scene of ['dark', 'bright']) {
  const A = d.lumaAB[scene];
  console.log(' scene ' + scene);
  for (const a of A.after) {
    const b = A.before.find((x) => x.id === a.id);
    if (!b) continue;
    console.log('   ' + a.id.padEnd(22) + ' after=' + String(a.meanLum).padEnd(8) + ' before=' + String(b.meanLum).padEnd(8) + ' delta=' + (a.meanLum - b.meanLum).toFixed(4));
  }
}
console.log('\n== tray open (samples) ==');
console.log(' disclosureFound=' + d.tray.disclosureFound + ' before=' + JSON.stringify(d.tray.before) + ' collapsed=' + d.tray.collapsed + ' trayRect=' + JSON.stringify(d.tray.trayRect));
for (const s of d.tray.samples) console.log('  t=' + s.t + 'ms display=' + s.display + ' vis=' + s.visibility + ' op=' + s.opacity + ' anims=' + JSON.stringify(s.anims));
console.log(' after=' + JSON.stringify(d.tray.after) + ' innerScroll=' + JSON.stringify(d.tray.innerScroll));
console.log('\n== tray close (samples) ==');
for (const s of d.trayClose.samples) console.log('  t=' + s.t + 'ms display=' + s.display + ' vis=' + s.visibility + ' op=' + s.opacity);
console.log(' collapsed=' + d.trayClose.collapsed + ' innerScroll=' + JSON.stringify(d.trayClose.innerScroll));
console.log('\n== glStats ==', JSON.stringify(d.glStats));
