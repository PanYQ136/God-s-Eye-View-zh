#!/usr/bin/env node
/** _ego-sum.mjs —— 从 ego out.txt 提取 ===EGO_REPORT=== JSON 并打印紧凑表（证据可复算） */
import fs from 'node:fs';
const p = process.argv[2] || 'C:/Users/13680/ego/gev-real-click-20261027/out.txt';
const raw = fs.readFileSync(p, 'utf8');
const a = raw.indexOf('===EGO_REPORT===');
const b = raw.indexOf('===SUMMARY===');
if (a < 0 || b < 0) { console.error('no report markers in', p); process.exit(2); }
const rep = JSON.parse(raw.slice(a + 16, b).trim());
const out = process.argv[3];
if (out) fs.writeFileSync(out, JSON.stringify(rep, null, 1));
console.log('vp', rep.vp.join('x'), '| tLoadVisibleGoneMs', rep.tLoad, '| shot errors', rep.errors.length);
console.log('initialFloating', rep.initialFloating.join(','), '| initialFail', rep.initialFail.length);
console.log('finalFloating  ', rep.finalFloating.join(','));
for (const [id, h] of Object.entries(rep.initialHits)) console.log('  hdr', id, h.rect.join(','), 'hit=' + h.hit, 'self=' + h.self);
for (const s of rep.steps) console.log(`  step${s.n} ${s.id.padEnd(21)} was=${String(s.wasFloating).padEnd(5)} -> ${s.rect.join(',').padEnd(20)} float=${s.floating} xCloseDom=${s.xClose.dom} fail=${s.fail.length ? s.fail.join(' ; ') : 'ok'}`);
console.log('FAILURES', rep.failures.length, JSON.stringify(rep.failures));
console.log('errs', JSON.stringify(rep.errs));
