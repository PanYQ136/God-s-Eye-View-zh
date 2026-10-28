import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync(process.argv[2] || '.gev-logs/ego/r1/report.json', 'utf8'));
console.log('tLoadGone', r.tLoadGoneMs);
for (const [k, v] of Object.entries(r.initial)) console.log('INIT', k, [v.x, v.y, v.w, v.h].join(','), 'f=' + v.floating, 'c=' + v.collapsed, 'p=' + v.parent, 'off=' + v.offscreen);
console.log('--- initialHits ---');
for (const [k, v] of Object.entries(r.initialHits || {})) console.log(k, 'self=' + v.self, v.hit, JSON.stringify(v.rect));
console.log('--- steps ---');
for (const s of r.steps) { const a = s.after[s.id]; console.log(s.i, s.id, 'hitSelf=' + s.hit.self, 'hit=' + s.hit.hit, '->', [a.x, a.y, a.w, a.h].join(','), 'f=' + a.floating, 'c=' + a.collapsed, JSON.stringify(s.judged)); }
console.log('--- inv per step ---');
for (const s of r.steps) if (Object.keys(s.inv.bad).length) console.log(s.i, s.id, JSON.stringify(s.inv.bad));
console.log('--- after ---');
for (const [k, v] of Object.entries(r.after)) console.log(k, [v.x, v.y, v.w, v.h].join(','), 'f=' + v.floating, 'c=' + v.collapsed, 'p=' + v.parent, 'off=' + v.offscreen);
console.log('--- logs tail ---');
for (const l of (r.logs || []).slice(-50)) console.log(l);
