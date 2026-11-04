#!/usr/bin/env node
import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('evidence/_collab/t_8cf06356/final-report.json', 'utf8'));
console.log('perf (流程中)  ', JSON.stringify(d.perf));
console.log('perfClean     ', JSON.stringify(d.perfClean));
console.log('svgMode       ', JSON.stringify(d.svgMode));
