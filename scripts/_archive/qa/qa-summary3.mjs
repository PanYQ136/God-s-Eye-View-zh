#!/usr/bin/env node
/* qa-summary3.mjs — framebuffer alpha 摘要 */
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const tag of Object.keys(d.passes)) {
  console.log(`=== u=${tag}`);
  for (const r of d.passes[tag]) {
    console.log(`${r.id.padEnd(22)} ${String(r.variant).padEnd(8)} inner p50=${r.innerAlphaP50} min=${r.innerMin} max=${r.innerMax} ramp[1,2,3,6,12,20]=${(r.edgeRamp || []).join(',')}`);
  }
}
console.log('surfaces', d.surfaces, 'errs', JSON.stringify(d.consoleErrors || []));
