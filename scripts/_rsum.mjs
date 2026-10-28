import fs from 'node:fs';
const tag = process.argv[2] || 'r8-keeponly';
const s = JSON.parse(fs.readFileSync(`.gev-logs/ego/${tag}/summary.json`, 'utf8'));
for (const r of s.runs) {
  console.log('VP', r.viewport.join('x'), 'tLoadGone', r.tLoadGoneMs, 'ptr', JSON.stringify(r.ptr));
  console.log('  initialFloating', r.initialFloating.join(','), 'final', r.finalFloating.join(','));
  console.log('  errs', JSON.stringify(r.errs.slice(0, 3)));
  console.log('  failures', r.failures.length, JSON.stringify(r.failures.slice(0, 4)));
}
