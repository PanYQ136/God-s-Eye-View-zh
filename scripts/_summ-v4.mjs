import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync('.gev-logs/final2/v4/report-b.json', 'utf8'));
console.log('failures', r.failures);
console.log('fps', JSON.stringify(r.fps));
console.log('pt', r.pointerTrust.total, r.pointerTrust.trusted);
console.log('byCard', JSON.stringify(r.pointerTrust.byCard));
for (const [k, v] of Object.entries(r.timeline)) {
  console.log('switch', k, 'maxSimul', JSON.stringify(v.maxSimul), 'changes', v.changes, 'frames', v.frames, 'endOpen', JSON.stringify(v.endOpen));
}
const { rowList, btns, ...ppRest } = r.pp.before;
console.log('pp', JSON.stringify(ppRest));
console.log('pp rows', JSON.stringify(rowList));
console.log('pp btns', JSON.stringify(btns));
console.log('pp after', JSON.stringify(r.pp.after));
console.log('collapse diff', JSON.stringify(r.collapse.diff));
console.log('rapid end', JSON.stringify(r.rapid.end.openBy), 'overlaps', JSON.stringify(r.rapid.end.overlaps));
console.log('reload open', JSON.stringify(Object.entries(r.reload.cards).filter(([, v]) => v && !v.collapsed).map(([k]) => k)));
const a = JSON.parse(fs.readFileSync('.gev-logs/final2/v4/report-a.json', 'utf8'));
console.log('--- stage a ---');
console.log('centerDiff', JSON.stringify(a.centerDiff));
console.log('material issues', JSON.stringify({
  blur: a.material.initial.blur, dark: a.material.initial.dark,
  whiteFill: a.material.initial.whiteFill, x: a.material.initial.xGlyph,
}));
for (const s of a.steps) {
  if (!s.label.startsWith('click')) continue;
  console.log(s.label, 'audit', JSON.stringify({ blur: s.audit.blur.length, dark: s.audit.dark.length, whiteFill: s.audit.whiteFill.length, x: s.audit.xGlyph.length }), 'hit', s.point.hitCard, 'rect', JSON.stringify(s.state.cards[s.label.slice(6)].rect));
}
