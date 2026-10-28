import fs from 'node:fs';
const m = JSON.parse(fs.readFileSync('.gev-logs/phase2/metrics.json', 'utf8'));
for (const v of m.variants) {
  console.log('==== ' + v.key + ' ' + v.name + ' | declared alpha ' + v.declaredAlpha);
  console.log('fps', JSON.stringify(v.fps));
  console.log('center', JSON.stringify(v.centerSummary));
  for (const c of v.centers) console.log('  card', c.id.padEnd(22), 'lumBg', c.lumBg, 'lumGlass', c.lumGlass, 'keep', c.lumKeep, 'std', c.stdRatio, 'r', c.pearsonR, 'alpha', c.alphaMeas);
  console.log('text', JSON.stringify(v.textSummary));
  for (const t of v.texts.slice(0, 8)) console.log('  worst', t.contrast, '|', t.msg, '|', t.card, t.role, '| color', JSON.stringify(t.color), '| localBg', JSON.stringify(t.localBg), '| map', JSON.stringify(t.mapBg), '| rendered', t.renderedContrast, '| bright', t.brightFillContrast);
  console.log('edges', JSON.stringify(v.edges, null, 0));
  console.log('corner', v.corner, '| errs', v.consoleErrors.length);
}
