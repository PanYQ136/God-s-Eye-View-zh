#!/usr/bin/env node
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('evidence/_collab/t_8cf06356/dispersion-report.json', 'utf8'));
for (const k of ['leftEdge', 'rightEdge', 'inner20px', 'outsideCard']) {
  const o = d[k];
  console.log(k.padEnd(12), 'meanChroma', o.meanChroma, 'max', o.maxChroma);
  console.log('   ', JSON.stringify(o.rgb));
}
