#!/usr/bin/env node
/* 读 boot-prefetch-ab 产物：逐跑打印阶段/预取/审计细节 */
import { readFileSync } from 'node:fs';

const file = process.argv[2] || '.gev-logs/lc/boot/prefetch-ab-smoke.json';
const d = JSON.parse(readFileSync(file, 'utf8'));
for (const r of d.runs) {
  console.log(
    `\n#${r.run} ${r.mode}: wall=${r.wallRevealMs} total=${r.total} gate=${r.gateReason} tiles=${JSON.stringify(r.tiles)}`,
  );
  console.log('  cps:', JSON.stringify(r.checkpoints));
  if (r.warm?.prefetch)
    console.log(
      '  prefetch:',
      JSON.stringify({
        tiles: r.warm.prefetch.tiles,
        kb: Math.round((r.warm.prefetch.bytes || 0) / 1024),
        errors: r.warm.prefetch.errors,
        ms: r.warm.prefetch.doneAt,
        reason: r.warm.prefetch.reason,
        center: r.warm.prefetch.center,
      }),
    );
  if (r.warm?.endpoint) console.log('  endpoint:', JSON.stringify(r.warm.endpoint));
  if (r.audit) {
    const a = r.audit;
    console.log(
      `  audit: shaders ${a.shaders.total}/${a.shaders.unique} dup${a.shaders.dupCalls} ${a.shaders.totalMs}ms; ` +
        `links ${a.links.total}/${a.links.unique} dup${a.links.dupCalls} ${a.links.totalMs}ms; ` +
        `tex ${a.texImage2D.total}/${a.texImage2D.unique} dup${a.texImage2D.dupCalls} ${a.texImage2D.totalMs}ms; ` +
        `texSub ${a.texSubImage2D.total} dup${a.texSubImage2D.dupCalls} ${a.texSubImage2D.totalMs}ms`,
    );
    if (a.shaders.topDups.length)
      console.log('  shader dups:', JSON.stringify(a.shaders.topDups));
    if (a.texImage2D.topDups.length)
      console.log('  tex dups:', JSON.stringify(a.texImage2D.topDups.slice(0, 5)));
  }
  if (r.errors.length) console.log('  errors:', r.errors.slice(0, 4));
}
