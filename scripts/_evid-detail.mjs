import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('.gev-logs/u3/report.json', 'utf8'));
const r = (o) => (o ? `[${o.x},${o.y} ${o.w}x${o.h} f=${o.floating}]` : 'null');
for (const s of d.steps) {
  if (s.kind === 'click-open' && (s.card === 'location-bar' || s.card === 'control-panel' || s.card === 'cctv-panel'))
    console.log('open', s.card, r(s.after), 'ov=' + s.overlaps.length);
  if (s.kind === 'group-switch') console.log('switch', s.a, '->', s.b, 'b=', r(s.bAfter), r(s.after && s.after[s.b]), 'ov=' + s.overlaps.length);
  if (s.kind === 'rapid') console.log('rapidA', r(s.after && s.after['data-panel']), 'ov=' + s.overlaps.length);
  if (s.kind === 'rapid-stress') console.log('stress afterOv=' + s.afterOverlaps.length, 'midOv=' + s.midOverlaps.length, 'moving=' + s.movingTarget);
  if (s.kind === 'keyboard-esc') console.log('esc', r(s.after), JSON.stringify(s.focusAfterEsc));
  if (s.kind === 'reload-memory') console.log('reload after=', JSON.stringify(s.floatingAfterReload), 'halfOpen=', JSON.stringify(s.halfOpenAfterReload), 'ov=' + s.overlaps.length);
  if (s.kind === 'double-click') console.log('dbl', s.card, r(s.after), 'ov=' + s.overlaps.length);
}
console.log('initial:', JSON.stringify(d.initialFloating), 'halfOpen:', JSON.stringify(d.initialHalfOpen));
console.log('layoutChecks:', JSON.stringify(d.layoutChecks.map((L) => ({ tag: L.tag, ov: L.overlaps.length, hdr: L.headersOk }))));
