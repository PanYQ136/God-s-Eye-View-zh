#!/usr/bin/env node
/* 摘要 photoreal-bg-audit 的 JSON（只读）。用法: node scripts/lc/_diag/photoreal-bg-summary.mjs <json...> */
import { readFileSync } from 'node:fs';

for (const p of process.argv.slice(2)) {
  const d = JSON.parse(readFileSync(p, 'utf8'));
  const f = (o) => (o ? `fps=${o.fps} worst=${o.worst} over100=${o.over100.length}(${o.over100.map((x) => `${x.t}/${x.dt}`).join(',')}) over50=${o.over50}` : 'n/a');
  console.log(`\n=== ${d.tag} (${d.url})${d.blocked && d.blocked.length ? ' BLOCKED=' + d.blocked.join(',') : ''} ===`);
  console.log(`interactive wall=${d.wallInteractive}ms nav=${d.navInteractive}ms | photorealReady=${d.photoreal && d.photoreal.ready} at=${d.photoreal && d.photoreal.at}`);
  console.log(`fps 0-10s: ${f(d.fps0_10)}`);
  console.log(`fps 10-25s: ${f(d.fps10_25)}`);
  const loaf = d.loaf || [];
  console.log(`LoAF>=100: ${loaf.filter((l) => l.d >= 100).length} / ${loaf.length}`);
  for (const l of loaf) {
    if (l.d >= 100) console.log(`  t=${l.s} d=${l.d} block=${l.block} render=${l.render} style=${l.style} scripts=${JSON.stringify(l.scripts)}`);
  }
  console.log(`longtask: ${(d.longtask || []).length}`);
  const lum = d.lum || [];
  if (lum.length) {
    const means = lum.map((x) => x.mean);
    const jumps = [];
    for (let i = 1; i < lum.length; i++) {
      const dd = Math.abs(lum[i].mean - lum[i - 1].mean);
      if (dd > 20) jumps.push(`${lum[i].t}ms:${lum[i - 1].mean}->${lum[i].mean}(${dd.toFixed(1)})`);
    }
    console.log(`lum n=${lum.length} min=${Math.min(...means)} max=${Math.max(...means)} jumps=${jumps.join(' ') || 'none'}`);
    console.log(`lum trace: ${lum.filter((_, i) => i % Math.max(1, Math.floor(lum.length / 40)) === 0).map((x) => `${x.t}:${x.mean}`).join(' ')}`);
  } else {
    console.log(`lum: none (installed=${d.lumInstalled} err=${d.lumErr})`);
  }
  const m = d.marks || {};
  const keys = ['tileset:fetch:dispatched', 'warm:endpoint:begin', 'warm:endpoint:end', 'tileset:fetch:end', 'gate:mask:gone', 'photoreal:added', 'photoreal:content', 'photoreal:upgrade', 'photoreal:skipped', 'photoreal:fallback'];
  console.log('marks: ' + keys.map((k) => `${k}=${m[k] ?? '-'}`).join(' '));
  console.log(`phases: ${(d.phases || []).map((x) => `${x.phase || '-'}@${x.wall}ms(tiles=${x.tilesInScene},globe=${x.globeShow},stack=${x.stack})`).join(' | ')}`);
  console.log(`loaderText=${JSON.stringify(d.loaderText)} dialogs=${d.dialogs}`);
  const net = d.netCesium || [];
  console.log(`cesium/net reqs: n=${net.length} first=${net[0] && net[0].d}ms ${net.slice(0, 4).map((n) => n.url.slice(0, 60)).join(' ; ')}`);
  if (d.errors && d.errors.length) console.log('errors: ' + JSON.stringify(d.errors.slice(0, 8)));
  console.log(`shots: ${Object.entries(d.shots || {}).map(([k, v]) => `${k}=${v.split('\\').pop()}`).join(' ')}`);
}
