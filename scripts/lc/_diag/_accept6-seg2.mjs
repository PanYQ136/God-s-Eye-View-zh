import { readFileSync } from 'node:fs';
const d = JSON.parse(readFileSync('.gev-logs/lc/boot/accept6-final.json', 'utf8'));
const med = (xs) => {
  const s = [...xs].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length ? (s.length % 2 ? s[m] : +((s[m - 1] + s[m]) / 2).toFixed(1)) : null;
};
for (const [label, g] of Object.entries(d)) {
  const seg = (a, b) => med(g.raw.map((r) => (r.marks[b] != null && r.marks[a] != null ? r.marks[b] - r.marks[a] : NaN)));
  console.log(`\n### ${label}`);
  for (const [a, b, name] of [
    ['frame:first', 'tileset:added', 'nav→tileset:added'],
    ['tileset:added', 'cine:go(tileset)', 'tileset:added→cine:go'],
    ['cine:go(tileset)', 'cine:done', 'cine:go→cine:done'],
    ['cine:done', 'view:content', 'cine:done→view:content'],
    ['tileset:added', 'view:content', 'tileset:added→view:content'],
    ['view:content', 'view:settled', 'view:content→settled'],
    ['view:settled', 'mask:gone', 'settled→mask:gone'],
    ['frame:first', 'mask:gone', 'marks 全链'],
  ])
    console.log('  ' + name.padEnd(26) + String(seg(a, b)).padStart(9) + ' ms');
  console.log('  墙钟 loading 中位 ' + med(g.loadingMs) + ' ms（marks 终点不含 goto 前的导航开销）');
}
