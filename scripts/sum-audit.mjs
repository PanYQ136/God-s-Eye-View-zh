#!/usr/bin/env node
/** summarize audit.json (t_8cf06356) */
import fs from 'node:fs';
const J = JSON.parse(fs.readFileSync(process.argv[2] || 'evidence/_collab/t_8cf06356/audit.json', 'utf8'));
const p = (o) => `(${o.x},${o.y},${o.w}x${o.h})`;
console.log('ERRS', J.errs.slice(0, 5));
console.log('MATERIAL', JSON.stringify({ gevGlOn: J.material.gevGlOn, glCanvas: J.material.glCanvasInDom, warps: J.material.warpCount, cardBg: J.material.cardBg, cardBackdrop: J.material.cardBackdrop, lensFilters: J.material.lensFilters, warp0: J.material.warps[0] }));
console.log('\n== COLLAPSED ==');
for (const [id, r] of Object.entries(J.collapsed)) console.log(id.padEnd(22), p(r), 'collapsed=' + r.collapsed);
console.log('\n== EXPAND (single card) ==');
for (const e of J.expansions) {
  const d = { x: e.self.x - e.before.x, y: e.self.y - e.before.y };
  console.log(e.id.padEnd(22), 'before', p(e.before), '-> exp', p(e.self), '-> after', p(e.after),
    '| shift', `(${d.x},${d.y})`, '| overlap', e.totalOverlap, JSON.stringify(e.others.filter((o) => o.overlap > 0).map((o) => [o.id, o.overlap])),
    '| clipped', JSON.stringify(e.clippedHeads));
  const hs = e.others.flatMap((o) => o.heads.map((h) => ({ id: o.id, ...h })));
  const self = e.self;
  const bad = hs.filter((h) => { const w = Math.min(self.r, h.r) - Math.max(self.x, h.x); const hh = Math.min(self.b, h.b) - Math.max(self.y, h.y); return w > 0 && hh > 0; });
  if (bad.length) console.log('   ⚠ 压住可见 header:', JSON.stringify(bad.map((b) => [b.id, b.cls, b.y, b.b])));
}
console.log('\n== COMBOS (one per exclusive group) ==');
for (const c of J.combos) {
  console.log('· ' + c.combo.join(' + '));
  for (const r of c.rows) console.log('   ', r.id.padEnd(22), p(r.self), 'visible=' + r.visible, 'overlap', r.total, JSON.stringify(r.hits));
}
console.log('\n== AFTER ALL CLOSED ==');
const base = J.collapsed;
let bad2 = 0;
for (const r of J.afterAll.rows) {
  const b = base[r.id];
  const same = b && r.rect.x === b.x && r.rect.y === b.y && r.rect.w === b.w && r.rect.h === b.h;
  if (!same || !r.visible || r.hid || !r.collapsed) bad2++;
  console.log('   ', r.id.padEnd(22), p(r.rect), 'visible=' + r.visible, 'hid=' + r.hid, 'collapsed=' + r.collapsed, same ? 'SAME' : 'DIFF base ' + p(b));
}
console.log('   residue: hid=' + J.afterAll.hidCount, 'placeholder=' + J.afterAll.phantoms, 'floating=' + J.afterAll.floating, '=>', bad2 === 0 ? 'ALL RESTORED' : 'MISMATCH ' + bad2);
console.log('\nSCROLLBARS', JSON.stringify(J.scrollbars));
