import fs from 'node:fs';
const R = JSON.parse(fs.readFileSync('.gev-logs/t_b37e6b4b/verify.json', 'utf8'));
console.log('hover:', JSON.stringify(R.hover));
console.log('rapid:', JSON.stringify(R.rapid.clicks.map((c) => ({ id: c.id, aimed: c.aimed, retries: c.retries, open: c.open }))));
console.log('rapid state:', R.rapid.summary);
console.log('closing drift:', JSON.stringify(R.closing.drift));
console.log('errors:', JSON.stringify(R.errors));
console.log('steps ms:', JSON.stringify(R.steps.map((s) => s.ms)));
