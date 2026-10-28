#!/usr/bin/env node
/** _step.mjs —— 打印 report.json 中某一类步骤的原始内容 */
import fs from 'node:fs';
const p = process.argv[2] || '.gev-logs/u3/report.json';
const kind = process.argv[3];
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
for (const s of d.steps) if (!kind || s.kind === kind) console.log(JSON.stringify(s).slice(0, 900));
