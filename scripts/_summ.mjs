#!/usr/bin/env node
/** _summ.mjs —— 汇总 .gev-logs/u3/report.json（人读摘要，避免 jq 依赖） */
import fs from 'node:fs';
const p = process.argv[2] || '.gev-logs/u3/report.json';
const d = JSON.parse(fs.readFileSync(p, 'utf8'));
const r = (o) => (o ? `[${o.x},${o.y} ${o.w}x${o.h} f=${o.floating} c=${o.collapsed}]` : 'null');
console.log('initialExpanded:', d.initialExpanded.join(','));
for (const s of d.steps) {
  switch (s.kind) {
    case 'click-open':
      console.log('open  ', s.card, 'pt=' + (s.point && s.point.hit), r(s.after), 'ov=' + s.overlaps.length, 'hdrAfter=' + s.hittableAfter.ok);
      break;
    case 'click-close':
      console.log('close ', s.card, r(s.after), 'ov=' + s.overlaps.length);
      break;
    case 'group-switch':
      console.log('switch', s.a, '->', s.b, 'bOpen=' + s.bAfterFloating, 'aStill=' + s.aAfterFloating, 'ov=' + s.overlaps.length, 'ptB=' + (s.bPointWhileAOpen && s.bPointWhileAOpen.hit));
      break;
    case 'rapid':
      console.log('rapidA', s.mode, 'ov=' + s.overlaps.length, 'floating=' + s.floating.join(','));
      for (const c of s.clicks) console.log('        ', c.id, 'hit=' + c.hitCard, 'open=' + c.open, 'pt=' + c.x + ',' + c.y);
      break;
    case 'rapid-stress':
      console.log('rapidB', s.mode, 'movingTarget=' + s.movingTarget, 'midOv=' + s.midOverlaps.length, 'afterOv=' + s.afterOverlaps.length, 'floating=' + s.floating.join(','));
      break;
    case 'rapid-determinism':
      console.log('determ ', s.same ? 'SAME' : 'DIFF', '|', s.run1, '||', s.run2);
      break;
    case 'double-click':
      console.log('dblclk', s.card, r(s.before), '->', r(s.after), 'ov=' + s.overlaps.length);
      break;
    case 'keyboard-esc':
      console.log('esc   ', 'opened=' + (s.opened && s.opened.floating), 'after=' + r(s.after), 'focus=' + JSON.stringify(s.focusAfterEsc));
      break;
    case 'no-close-btn':
      console.log('xbtn  ', s.card, 'dom=' + s.xAudit.domCount, 'visible=' + s.xAudit.visible.length, 'suspects=' + s.xAudit.suspects.length, 'afterEsc=' + r(s.after));
      break;
    case 'tab-focus':
      console.log('tab   ', s.trail.slice(0, 8).map((t) => (t ? t.t + '|' + t.outline : 'null')).join('  '));
      break;
    case 'reload-memory':
      console.log('reload', 'before=' + s.openedBefore, 'after=' + s.floatingAfterReload, 'expanded=' + s.expandedAfterReload.join(','), 'halfOpen=' + s.halfOpenAfterReload.join(','));
      break;
    default:
      break;
  }
}
console.log('errors:', d.errors.length);
for (const L of d.layoutChecks || [])
  console.log('layout', L.tag, '| overlapOk=' + L.overlapsOk, '| headers=' + L.headersOk + '/7', '| ov=' + JSON.stringify(L.overlaps));
const tr = d.ptr.filter((x) => x.trusted).length;
console.log('pointer events trusted:', tr, '/', d.ptr.length);
console.log('failures:', d.failures.length, JSON.stringify(d.failures.map((f) => f.id + ':' + f.msg)).slice(0, 600));
