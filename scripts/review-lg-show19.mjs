import fs from 'node:fs';
const f = process.argv[2];
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
const p = (o) => JSON.stringify(o, null, 1);
console.log('== contrastSummary ==');
console.log(p(d.contrastSummary));
console.log('== contrastDefault rows ==');
for (const r of d.contrastDefault || []) console.log(' ', r.group, (r.text || r.id || r.card), 'bg=' + r.bg, 'fg=' + r.fg, 'C=' + r.contrast, 'painted=' + r.painted);
if (d.reduced) console.log('== reduced ==\n' + p(d.reduced).slice(0, 4000));
if (d.audit) {
  console.log('== audit ==');
  console.log(p({ surfaces: d.audit.surfaces, scale: d.audit.scale, canvas: d.audit.canvas, dpr: d.audit.dpr, ids: d.audit.surfaceIds }));
  for (const c of d.audit.cards || []) console.log(' ', c.id, 'isGevLc=' + c.isGevLc, 'bg=' + c.bg, 'backdrop=' + c.backdrop, 'innerBd=' + c.innerBd, 'scrollers=' + JSON.stringify(c.scrollers), 'lum=' + c.lum);
}
if (d.morph) console.log('== morph ==\n' + p(d.morph));
console.log('== errors ==', p(d.errors).slice(0, 800));
