#!/usr/bin/env node
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('evidence/_collab/t_8cf06356/dispersion-ab.json', 'utf8'));
console.log('computedFilterWhenOff =', d.computedFilterWhenOff);
for (const k in d.buckets) console.log(k.padEnd(14), JSON.stringify(d.buckets[k]));
