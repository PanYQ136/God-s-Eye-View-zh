#!/usr/bin/env node
/* qa-summary2.mjs — readpixels alpha 摘要：每卡内部 alpha 中位/最小/最大 + 边缘 ramp */
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
for (const tag of Object.keys(d.passes)) {
  console.log(`=== ${tag}`);
  for (const r of d.passes[tag]) {
    const a = r.innerAlpha.slice().sort((x, y) => x - y);
    const p50 = a[Math.floor(a.length / 2)], mn = a[0], mx = a[a.length - 1];
    console.log(`${r.id.padEnd(22)} ${String(r.variant).padEnd(8)} u=${r.interiorUniform} inner p50=${p50} min=${mn} max=${mx} center=${r.center} edge[1,2,3,6,12,20]=${r.edgeRamp.join(',')}`);
  }
}
console.log('errs', JSON.stringify(d.consoleErrors || []));
