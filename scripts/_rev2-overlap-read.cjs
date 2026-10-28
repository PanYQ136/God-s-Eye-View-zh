const d = require('../.gev-logs/rev2-accept/overlap.json');
for (const [k, v] of Object.entries(d)) {
  if (k === 'at') continue;
  if (!v.cards) { console.log(k, 'at', JSON.stringify(v.at)); continue; }
  console.log('==', k, v.at ? 'at ' + JSON.stringify(v.at) : '');
  for (const id of ['pp-toggles', 'cctv-panel', 'global-context-panel', 'location-bar', 'control-panel', 'gev-voice-control', 'command-dock', 'gev-voice-button']) {
    const c = v.cards[id];
    console.log('  ', id, c ? JSON.stringify(c.rect) + ' ' + (c.open ? 'OPEN' : 'mini') + ' ' + c.cls : 'null');
  }
  for (const [id, h] of Object.entries(v.hits)) console.log('   hit', id, '->', h.hit, '| owner', h.owner, '| onOwnHeader', h.onOwnHeader);
}
