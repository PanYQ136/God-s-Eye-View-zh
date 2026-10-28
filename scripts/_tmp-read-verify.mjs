import fs from 'node:fs';
const j = JSON.parse(fs.readFileSync(new URL('../.gev-logs/t_b37e6b4b/verify.json', import.meta.url), 'utf8'));
const c = j.closing;
console.log('closeLog', JSON.stringify(c.closeLog));
console.log('drift', JSON.stringify(c.drift));
console.log('overlaps', JSON.stringify(c.overlaps));
console.log('rapid.open', JSON.stringify(j.rapid.open), 'expect', JSON.stringify(j.rapid.expectOpen));
console.log('errors', JSON.stringify(j.errors));
console.log('keys', JSON.stringify(Object.keys(j)));
