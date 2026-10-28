import fs from 'node:fs';
const s = JSON.parse(fs.readFileSync('.gev-logs/ego/r8-keeponly/summary.json', 'utf8'));
for (const r of s.runs) {
  console.log('=== VP', r.viewport.join('x'), 'initial=', r.initialFloating.join(','), 'fail#', r.failures.length, 'ptr', r.ptr.count, r.ptr.trusted);
  console.log(' initialRects', JSON.stringify(r.initialRects));
  for (const st of r.steps) console.log('  ', st.n, st.id, 'wasFloat=' + st.wasFloating, '->', st.rect.join(','), 'float=' + st.floating, st.fail.length ? 'FAIL ' + st.fail.join(' ; ') : 'ok');
  console.log(' final', r.finalFloating.join(','));
  if (r.failures.length) console.log(' FAILURES', JSON.stringify(r.failures));
  if (r.errs.length) console.log(' ERRS', JSON.stringify(r.errs.slice(0, 3)));
}
