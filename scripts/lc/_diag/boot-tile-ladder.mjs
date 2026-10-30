#!/usr/bin/env node
/* 瓦片请求的时间分布：验证「飞行期请求的是中间视角、落位后才请求最终视角」 */
import { readFileSync } from 'node:fs';

const file = process.argv[2] || '.gev-logs/lc/boot/baseline-prod.json';
const d = JSON.parse(readFileSync(file, 'utf8'));

for (const r of d.runs) {
  const cp = Object.fromEntries(
    r.timeline.checkpoints.map((c) => [c.name, c.t]),
  );
  const tiles = (r.resources || []).filter(
    (x) => /3dtiles|root\.json|tile/i.test(x.name) || /f_|\.b3dm/i.test(x.name),
  );
  const inFlight = tiles.filter(
    (x) => x.start >= cp['gate:cine:go'] && x.start <= cp['gate:cine:done'],
  );
  const afterLand = tiles.filter((x) => x.start > cp['gate:cine:done']);
  const beforeFlight = tiles.filter((x) => x.start < cp['gate:cine:go']);
  console.log(
    `run${r.run} tiles=${tiles.length} 飞行前=${beforeFlight.length} 飞行中=${inFlight.length} 落位后=${afterLand.length}` +
      ` | 落位后首个 end=${afterLand.length ? Math.min(...afterLand.map((x) => x.end)) : '-'} 最后 end=${afterLand.length ? Math.max(...afterLand.map((x) => x.end)) : '-'}` +
      ` | 落位=${cp['gate:cine:done']} view:content=${cp['gate:view:content']}`,
  );
  /* 每秒瓦片请求数 */
  const buckets = {};
  for (const t of tiles) {
    const k = Math.floor(t.start / 1000);
    buckets[k] = (buckets[k] || 0) + 1;
  }
  console.log('   每秒发起瓦片请求:', JSON.stringify(buckets));
  const bad = (r.probeLog || []).filter((p) => !p.ok);
  console.log(
    `   探针样本 ${(r.probeLog || []).length} 个，未达标 ${bad.length} 个;` +
      (bad.length
        ? ` 未达标区间 ${bad[0].atRel}–${bad[bad.length - 1].atRel}`
        : ''),
  );
}
