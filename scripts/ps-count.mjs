import { execSync } from 'node:child_process';
const run = (c) => { try { return execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return 'ERR:' + e.message; } };
const lines = run('tasklist /FO CSV /NH').split(/\r?\n/).filter(Boolean);
const counts = {};
for (const l of lines) {
  const name = (l.split('","')[0] || '').replace(/^"/, '').toLowerCase();
  counts[name] = (counts[name] || 0) + 1;
}
const pick = ['chrome.exe', 'msedge.exe', 'node.exe', 'python.exe', 'electron.exe', 'Hermes.exe'];
for (const k of pick) console.log(k + ' = ' + (counts[k] || 0));
console.log('total processes = ' + lines.length);
