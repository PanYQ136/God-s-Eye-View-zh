import fs from 'node:fs';
const dir = '.gev-logs/u3';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
const bad = [];
for (const f of files) {
  const b = fs.readFileSync(`${dir}/${f}`);
  // PNG IHDR: width at offset 16, height at 20
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  if (w !== 1536 || h !== 730) bad.push([f, w, h]);
}
console.log('png count:', files.length, 'all 1536x730:', bad.length === 0 ? 'YES' : JSON.stringify(bad));
console.log(files.join('\n'));
const rep = JSON.parse(fs.readFileSync(`${dir}/report.json`, 'utf8'));
console.log('\nreport.json steps:', rep.steps.length, '| failures:', rep.failures.length, '| ptr:', rep.ptr.length, '| trusted:', rep.ptr.filter((p) => p.trusted).length, '| errors:', rep.errors.length);
const r1 = JSON.parse(fs.readFileSync(`${dir}/report-run1.json`, 'utf8'));
console.log('report-run1.json steps:', r1.steps.length, '| failures:', r1.failures.length, '| ptr:', r1.ptr.length, '| trusted:', r1.ptr.filter((p) => p.trusted).length, '| errors:', r1.errors.length);
for (const [n, d] of [['run1', r1], ['run2', rep]]) {
  console.log(n, 'layoutChecks:', d.layoutChecks.map((L) => `${L.tag} ov=${L.overlaps.length} hdr=${L.headersOk}/7`).join(' ; '));
  const stress = d.steps.find((s) => s.kind === 'rapid-stress');
  console.log(n, 'stress:', JSON.stringify({ movingTarget: stress.movingTarget, midOv: stress.midOverlaps.length, afterOv: stress.afterOverlaps.length, mode: stress.mode }));
  const det = d.steps.find((s) => s.kind === 'rapid-determinism');
  console.log(n, 'determinism same:', det.same);
}
