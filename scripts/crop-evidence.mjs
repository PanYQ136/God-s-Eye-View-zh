#!/usr/bin/env node
/** crop-evidence.mjs —— 从 2x 全屏图里裁出 control 面板区域，便于肉眼检查收窄态排版 */
import sharp from 'sharp';
const OUT = 'evidence/_collab/t_f8d97c1c';
const jobs = [
  ['combo-pp-toggles+control-2x.png', 'ctrl-338-narrow-2x.png', { left: 1640, top: 640, width: 720, height: 800 }],
  ['combo-cctv-panel+control-2x.png', 'ctrl-298-narrow-2x.png', { left: 1640, top: 640, width: 720, height: 800 }],
  ['combo-global-context-panel+control-2x.png', 'ctrl-318-narrow-2x.png', { left: 1640, top: 640, width: 720, height: 800 }],
];
for (const [src, dst, region] of jobs) {
  await sharp(`${OUT}/${src}`).extract(region).toFile(`${OUT}/${dst}`);
  console.log('wrote', dst);
}
