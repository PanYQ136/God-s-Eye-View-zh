#!/usr/bin/env node
/* qa-summary.mjs — 把 probe31 / probe32 的 JSON 压成一行一面的摘要（省 token，便于验收） */
import fs from 'node:fs';
const f = process.argv[2];
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
const line = (r) => `${r.id.padEnd(22)} ${String(r.variant).padEnd(8)} u=${r.interiorUniform} inner(p10/p50/p90/max)=${r.inner.p10}/${r.inner.p50}/${r.inner.p90}/${r.inner.max} edge3=${r.edgeIn3 ? r.edgeIn3.p50 : '-'}`;
if (Array.isArray(d.rows)) d.rows.forEach((r) => console.log(line(r)));
const dump = (rows, label) => { console.log(`=== ${label}`); rows.forEach((r) => console.log(`${r.id.padEnd(22)} ${String(r.variant).padEnd(8)} u=${r.interiorUniform} inner=${r.inner.p10}/${r.inner.p50}/${r.inner.p90}/${r.inner.max}${r.edgeIn2 ? ' edge2=' + r.edgeIn2.p50 + '/' + r.edgeIn2.max : (r.edgeIn3 ? ' edge3=' + r.edgeIn3.p50 : '')}`)); };
for (const k of ['default', 'lo']) if (d[k] && d[k].rows) dump(d[k].rows, `${k} ${d[k].tag || ''}`);
if (d.control_glassHidden) console.log('control(glass hidden) p50/max =', d.control_glassHidden.p50, d.control_glassHidden.max);
if (d.control_glassHidden_maxAlpha !== undefined) console.log('control(glass hidden) maxAlpha =', d.control_glassHidden_maxAlpha);
if (d.rows && !Array.isArray(d.rows)) {
  for (const k of Object.keys(d.rows)) {
    console.log(`--- ${k}`);
    const v = d.rows[k];
    for (const id of Object.keys(v)) console.log(`${id.padEnd(22)} ${v[id].variant.padEnd(8)} inner p10/p50/p90 = ${v[id].inner.p10}/${v[id].inner.p50}/${v[id].inner.p90}`);
  }
}
console.log('consoleErrors =', JSON.stringify(d.consoleErrors || []));
