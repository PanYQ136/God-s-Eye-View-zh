import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const p = r.phases;
const J = (o) => JSON.stringify(o);
console.log('tag', r.tag, 'errors', r.errorCount, J(r.errors.slice(0, 3)));
console.log('fps', J(r.fps || {}));
console.log('layout equal dark/bright:', J(Object.entries(p.dark.cards).every(([k, v]) => J(v) === J(p.bright.cards[k]))));
console.log('layout dark:', J(p.dark.cards));
console.log('layout dark-before:', J(p['dark-before'].cards));
console.log('layout tray(open):', J(p.tray['control-panel'].trays));
for (const ph of ['dark', 'dark-before', 'bright', 'bright-before', 'white', 'white-before']) {
  const x = p[ph];
  if (!x) continue;
  console.log(`\n=== ${ph}  lum=${x.lum}  worst=${x.contrast.worst}  pass=${x.contrast.pass}`);
  console.log('  text ', J(x.contrast.rows.map((c) => [c.id, c.texts.map((t) => t.t + ':' + t.declared + ' (bg ' + t.base + ')')])));
  console.log('  ring ', J(x.ring.map((k) => [k.id, k.leftBand, k.rightBand, k.centerLum])));
  console.log('  cardbg', x.styles.card['background-color'], '| shadow', x.styles.card['box-shadow'].slice(0, 120));
}
for (const [id, t] of Object.entries(p.tray)) {
  const s = t.styles[id === 'control-panel' ? 'tray' : 'trayLocation'];
  console.log('\ntray', id, 'opened', t.opened, '| bg', s['background-color'], '| border', s.border, '| tray rect', J(t.trays[id].rect));
}
const s = p.dark.styles;
for (const k of ['ppToggle', 'dataToggle', 'styleBtn', 'mapChip', 'chipLocate', 'chipPerf', 'fab', 'warp']) {
  if (s[k]) console.log(k.padEnd(10), s[k]['background-color'] || s[k]['background-image'], '|', (s[k]['box-shadow'] || '').slice(0, 90), '|bf', s[k]['backdrop-filter']);
}
