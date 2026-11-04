#!/usr/bin/env node
/** 把 after4 的 before/after crop 拼成上下两栏对照图（sharp） */
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.argv[2] || 'evidence/_collab/t_fdd76e7a/after4';
const OUT = process.argv[3] || 'evidence/_collab/t_fdd76e7a/cmp';
const T = process.argv[4] || 'v4';
fs.mkdirSync(OUT, { recursive: true });

const pairs = [
  [`${T}-dark-before-left.png`, `${T}-dark-left.png`, 'card-left-dark'],
  [`${T}-dark-before-right.png`, `${T}-dark-right.png`, 'card-right-dark'],
  [`${T}-dark-before-chips.png`, `${T}-dark-chips.png`, 'chip-dark'],
  [`${T}-dark-before-fab.png`, `${T}-dark-fab.png`, 'fab-dark'],
  [`${T}-bright-before-left.png`, `${T}-bright-probe-left.png`, 'card-left-bright-probe'],
  [`${T}-bright-before-chips.png`, `${T}-bright-probe-chips.png`, 'chip-bright-probe'],
  [`${T}-white-before-chips.png`, `${T}-white-chips.png`, 'chip-white-probe-off'],
  [`${T}-white-before-left.png`, `${T}-white-probe-left.png`, 'card-left-white-probe'],
  [`${T}-tray-control-panel-before.png`, `${T}-tray-control-panel.png`, 'tray-control-panel'],
  [`${T}-tray-location-bar-before.png`, `${T}-tray-location-bar.png`, 'tray-location-bar'],
];

async function stack(beforeAbs, afterAbs, out) {
  if (!fs.existsSync(beforeAbs) || !fs.existsSync(afterAbs)) { console.log('skip', out); return; }
  const [ma, mb] = await Promise.all([sharp(beforeAbs).metadata(), sharp(afterAbs).metadata()]);
  const w = Math.max(ma.width, mb.width);
  const gap = 8, headH = 26;
  const svg = `<svg width="${w}" height="${headH}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#101418"/><text x="8" y="18" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="12" fill="#7fd0ff">BEFORE  (pre-Figma-material)</text><text x="${Math.round(w / 2) + 8}" y="18" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="12" fill="#7fd0ff">AFTER  (Figma Liquid Glass Regular/Medium)</text></svg>`;
  const total = headH + ma.height + gap + mb.height;
  await sharp({ create: { width: w, height: total, channels: 3, background: '#08090b' } })
    .composite([
      { input: Buffer.from(svg), top: 0, left: 0 },
      { input: await sharp(beforeAbs).toBuffer(), top: headH, left: 0 },
      { input: await sharp(afterAbs).toBuffer(), top: headH + ma.height + gap, left: 0 },
    ])
    .png()
    .toFile(path.join(OUT, out + '.png'));
  console.log('wrote', out, `${w}x${total}`);
}
for (const [b, a, name] of pairs) await stack(path.join(DIR, b), path.join(DIR, a), name);
