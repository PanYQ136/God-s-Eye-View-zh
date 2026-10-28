import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync('.gev-logs/review/initial-probe.json', 'utf8'));
const i = j.initial;
console.log('overlaps', JSON.stringify(i.overlaps));
console.log('floating', JSON.stringify(i.floating));
console.log('self', JSON.stringify(Object.fromEntries(Object.entries(i.headerHits).map(([k, v]) => [k, v.self]))));
for (const [k, v] of Object.entries(i.rects)) console.log(k, JSON.stringify(v));
console.log('ptr', j.ptrCount, j.ptrTrusted);
