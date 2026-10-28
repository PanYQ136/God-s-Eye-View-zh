import fs from 'node:fs';
const src = process.argv[2];
const dst = process.argv[3];
const raw = fs.readFileSync(src, 'utf8');
const a = raw.indexOf('===EGO_REPORT===');
const b = raw.indexOf('===SUMMARY===');
const rep = JSON.parse(raw.slice(a + 16, b).trim());
fs.writeFileSync(dst, JSON.stringify(rep, null, 1));
console.log('saved', dst, 'failures', rep.failures.length, 'steps', rep.steps.length);
