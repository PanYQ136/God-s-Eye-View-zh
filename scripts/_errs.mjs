import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('.gev-logs/u3/report.json', 'utf8'));
console.log('errors', d.errors.length);
for (const e of d.errors) console.log('---\n' + String(e).slice(0, 3000));
