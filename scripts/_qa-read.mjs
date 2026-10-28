import fs from 'node:fs';
const f = process.argv[2] || '.gev-logs/final/f2/report.json';
const r = JSON.parse(fs.readFileSync(f, 'utf8'));
const show = (label) => {
  const s = r.steps.find((x) => x.label === label);
  if (!s) return console.log('missing', label);
  console.log('---', label, '---');
  for (const [k, v] of Object.entries(s.state)) if (v) console.log(k.padEnd(22), JSON.stringify(v.rect), 'collapsed=' + v.collapsed, 'float=' + v.floating, 'inView=' + v.inView);
  if (s.overlapping?.length) console.log('overlaps', JSON.stringify(s.overlapping));
};
for (const l of ['initial', 'rapid-final', 'collapsed-all', 'reload-initial']) show(l);
console.log('pp minGap', r.pp?.before?.minGap, 'overlapRows', r.pp?.before?.overlapRows, 'scroll', JSON.stringify(r.pp?.after));
console.log('material initial', JSON.stringify(r.material?.initial));
console.log('failures', r.failures.length);
