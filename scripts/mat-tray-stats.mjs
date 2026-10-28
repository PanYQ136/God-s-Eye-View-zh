#!/usr/bin/env node
/** 打印托盘文字对比度（after / before） */
import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const out = {};
for (const [id, t] of Object.entries(r.phases.tray || {})) {
  out[id] = {
    opened: t.opened, lum: t.lum,
    after: t.text ? { worst: t.text.worst, pass: t.text.pass, rows: t.text.rows } : null,
    before: t.textBefore ? { worst: t.textBefore.worst, pass: t.textBefore.pass, rows: t.textBefore.rows } : null,
    afterBelow: t.text ? t.text.below.map((b) => `${b.t}=${b.declared} (${b.color}, bg ${b.base})`) : [],
    beforeBelow: t.textBefore ? t.textBefore.below.map((b) => `${b.t}=${b.declared} (${b.color}, bg ${b.base})`) : [],
    trayBg: t.styles?.tray?.['background-color'], trayRect: t.trays?.[id]?.rect,
  };
}
console.log(JSON.stringify(out, null, 1));
