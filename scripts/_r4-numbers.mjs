import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('.gev-logs/r4-t829/accept.json', 'utf8'));
console.log('D.scrollSeq', JSON.stringify(d.D_pp.scrollSeq), 'rows', d.D_pp.before.rows, 'minGap', d.D_pp.before.minGap, 'solid', d.D_pp.before.solidBtns.length, 'dark', d.D_pp.before.darkBtns.length, 'scroller', JSON.stringify(d.D_pp.before.scroller));
for (const k of Object.keys(d)) if (k.startsWith('F_')) console.log(k, JSON.stringify({ missed: d[k].missed, det: d[k].settledDeterministic, overlaps: d[k].overlaps, out: d[k].outOfView, own: d[k].allHeadersOwn, left: d[k].leftOpen, right: d[k].rightOpen }));
console.log('E.overlapsAll', d.E_combos.every((x) => x.overlaps.length === 0), 'E.badHitsAll', d.E_combos.every((x) => x.badHits.length === 0), 'E.minGap', Math.min(...d.E_combos.flatMap((x) => x.gaps.map((g) => g.gapY))));
console.log('B.allOpen', d.B_headers.every((x) => x.open && !x.hidden && x.inView), 'B.bfIn', d.B_headers.every((x) => x.bfIn === 0), 'B.maxCenterMax', Math.max(...d.B_headers.map((x) => x.maxCenter)));
console.log('C', JSON.stringify({ frames: d.C_mutex.frames, maxL: d.C_mutex.maxL, maxR: d.C_mutex.maxR, empty: d.C_mutex.emptyFramesAfterFirstOpen, hidden: d.C_mutex.hiddenFrames, gaps: d.C_mutex.switchGaps.map((g) => g.gapMs) }));
console.log('I', JSON.stringify(d.I_fps), 'trust', JSON.stringify(d.trust));
console.log('G', JSON.stringify(d.G_collapse), 'H', d.H_reload.anyExpandedFrame, d.H_reload.samples, 'errors', d.console_errors.length);
