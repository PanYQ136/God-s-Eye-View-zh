import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log(JSON.stringify(d.struct));
console.log('--- compose ---');
for (const r of d.compose) console.log(r.id.padEnd(22), String(r.variant).padEnd(7), 'u=' + r.uniformInterior, 'dGon=' + r.dG_on, 'dGoff=' + r.dG_off, 'alphaEff=' + r.alphaEff);
for (const [tag, v] of Object.entries(d.fb)) {
  console.log('--- fb ' + tag + ' canvas=' + JSON.stringify(v.canvas) + ' scale=' + v.scale);
  for (const r of v.rows) console.log('  ' + r.id.padEnd(22), String(r.variant).padEnd(7), 'u=' + r.uniform, 'p50=' + r.innerP50, 'min=' + r.innerMin, 'max=' + r.innerMax, 'ramp=' + JSON.stringify(r.edgeRamp));
}
console.log('errs', JSON.stringify(d.consoleErrors));
