import fs from 'node:fs';
const p = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/review-verify.json';
const r = JSON.parse(fs.readFileSync(p, 'utf8'));
const out = [];
out.push('errors=' + JSON.stringify(r.errors));
out.push('cameraSet=' + r.tests.cameraSet);
out.push('stats=' + JSON.stringify(r.stats && { fps: r.stats.fps, count: r.stats.count, scale: r.stats.scale, frames: r.stats.frames }));
if (r.stats && r.stats.surfaces) out.push('surfaces=' + JSON.stringify(r.stats.surfaces.map((s) => [s.id, s.variant, s.lum, s.bezel, s.fill, s.rect])));
out.push('fpsIdle=' + JSON.stringify(r.tests.fpsIdle));
out.push('open=' + JSON.stringify(r.tests.openAnim));
out.push('gl=' + JSON.stringify(r.gl));
out.push('lcInfo=' + JSON.stringify(r.lcInfo));
const b = r.tests.band;
if (b) {
  out.push('--- band clip=' + JSON.stringify(b.clip) + ' edgeCol=' + b.edgeCol);
  out.push('d | refr(gain0 diff) | dR dG dB (on-off, 白增量) | dlum | dmax');
  b.cols.filter((c) => c.d >= -4 && c.d <= 26).forEach((c) => out.push(`${c.d} | ${c.refr} | ${c.dR} ${c.dG} ${c.dB} | ${c.dlum} | ${c.dmax}`));
}
const d = r.tests.dispersion;
if (d) {
  out.push('--- dispersion (8 samples vs eta=const) per distance');
  d.byD.filter((c) => c.d >= -2 && c.d <= 20).forEach((c) => out.push(`${c.d} | R ${c.R} G ${c.G} B ${c.B}`));
}
console.log(out.join('\n'));
