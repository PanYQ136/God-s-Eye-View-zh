#!/usr/bin/env node
/** 输出报告用的 computed 样式摘要（暗档 + 亮档）+ 边缘环可见度 */
import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const pick = (s, keys) => Object.fromEntries(keys.filter((k) => s && s[k] !== undefined).map((k) => [k, s[k]]));
const KEYS = ['background-color', 'background-image', 'border', 'border-radius', 'corner-shape', 'backdrop-filter', 'box-shadow'];
const out = {};
for (const ph of ['dark', 'bright-probe', 'light']) {
  const p = r.phases[ph];
  if (!p) continue;
  out[ph] = { styles: {}, ring: p.ring };
  for (const k of Object.keys(p.styles || {})) out[ph].styles[k] = pick(p.styles[k], KEYS);
  const cov = (p.chips || []).map((c) => [c.sel, c.t, c.c]);
  out[ph].chips = cov;
}
out.tray = {};
for (const [id, t] of Object.entries(r.phases.tray || {})) {
  out.tray[id] = { text: t.text && { worst: t.text.worst, pass: t.text.pass }, before: t.textBefore && { worst: t.textBefore.worst, pass: t.textBefore.pass }, trayRect: t.trays?.[id]?.rect, styles: pick(t.styles?.tray || t.styles?.trayLocation, KEYS) };
}
console.log(JSON.stringify(out, null, 1));
