import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
console.log('SHELL', JSON.stringify(d.shell));
const rows = d.nodes.slice().sort((a, b) => b.relRight - a.relRight);
for (const r of rows.slice(0, 20)) {
  console.log([r.depth, 'right=' + r.relRight, 'rect=' + r.rect.join(','), r.display, r.vis, 'op=' + r.op, r.pos,
    (r.id || r.cls || '').slice(0, 32), 'sw/cw=' + r.sw + '/' + r.cw, JSON.stringify(r.txt.slice(0, 22))].join(' | '));
}
console.log('total', rows.length);
