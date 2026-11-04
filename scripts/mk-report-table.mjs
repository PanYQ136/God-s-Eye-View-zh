#!/usr/bin/env node
/** mk-report-table.mjs —— 从 expand-audit-after.json 生成 markdown 表（避免手抄错数字） */
import fs from 'node:fs';
const OUT = 'evidence/_collab/t_f8d97c1c';
const r = JSON.parse(fs.readFileSync(`${OUT}/expand-audit-after.json`, 'utf8'));
const ids = ['control-panel'];
const L = [];
L.push('### 12 个 combo（正序：左→右→dock，同一 tick 连开）');
L.push('');
L.push('| # | combo | 三卡 rect (x,y w×h) | overlap 面积 | 结果 |');
L.push('|---|---|---|---|---|');
r.combos.forEach((c, i) => {
  const rects = c.combo.map((id) => { const x = c.rects[id]; return `${id.replace('-panel', '').replace('-context', '')} (${x.x},${x.y}) ${x.w}×${x.h}${x.vis === 'hidden' ? ' **HIDDEN**' : ''}`; }).join('<br>');
  const ov = c.overlaps.length ? c.overlaps.map((o) => `${o.a}↔${o.b} ${o.area}px²`).join('<br>') : '0';
  L.push(`| ${i + 1} | ${c.order} ${c.combo.join(' + ')} | ${rects} | ${ov} | ${c.overlaps.length ? '❌' : '✅'} |`);
});
L.push('');
L.push('### 6 个倒序复验（dock→右→左，验证与打开顺序无关）');
L.push('');
L.push('| # | 打开顺序 | control-panel rect | 右栏卡 rect | overlap |');
L.push('|---|---|---|---|---|');
r.combos.filter((c) => c.order === 'rev').forEach((c, i) => {
  const ctl = c.rects['control-panel'];
  const rail = c.combo[1];
  const x = c.rects[rail];
  L.push(`| ${i + 1} | ${c.combo.join(' → ')} | (${ctl.x},${ctl.y}) ${ctl.w}×${ctl.h} | ${rail} (${x.x},${x.y}) ${x.w}×${x.h} | ${c.overlaps.length} |`);
});
L.push('');
L.push('### 7 张卡单独展开');
L.push('');
L.push('| 卡 | rect | overlap | 按钮 (命中/总数) | 被其它卡盖住 | 滚动可到底 | narrow 类 |');
L.push('|---|---|---|---|---|---|---|');
for (const s of r.single) {
  const d = s.self;
  L.push(`| ${s.id} | (${d.x},${d.y}) ${d.w}×${d.h} | ${s.overlaps.length} | ${d.hitOk}/${d.buttons} | ${d.covered} | ${d.bottomOk} | ${d.narrowCls} |`);
}
L.push('');
L.push('### 收起全部后 vs 基线');
L.push('');
L.push('```json');
L.push(JSON.stringify({ restore_identical: r.restore.identical, diff: r.restore.diff, console_errors: r.summary.console_errors }, null, 1));
L.push('```');
fs.writeFileSync(`${OUT}/TABLE.md`, L.join('\n'));
console.log(L.join('\n'));
