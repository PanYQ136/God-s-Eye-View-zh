#!/usr/bin/env node
/** 把 after4 的 before/after crop 拼成上下两栏对照图（sharp，无外部字体依赖） */
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.argv[2] || 'evidence/_collab/t_fdd76e7a/after4';
const OUT = process.argv[3] || 'evidence/_collab/t_fdd76e7a/cmp';
const TAG = process.argv[4] || 'v4';
fs.mkdirSync(OUT, { recursive: true });

const pairs = [
  ['dark-left', 'card-left-dark'],
  ['dark-right', 'card-right-dark'],
  ['dark-chips', 'chip-dark'],
  ['dark-fab', 'fab-dark'],
  ['bright-probe-left', 'card-left-bright-probe'],
  ['white-chips', 'chip-white-probe-off'],
];

async function stack(a, b, out, labelA, labelB) {
  if (!fs.existsSync(a) || !fs.existsSync(b)) { console.log('skip', out, fs.existsSync(a), fs.existsSync(b)); return; }
  const ia = sharp(a), ib = sharp(b);
  const [ma, mb] = await Promise.all([ia.metadata(), ib.metadata()]);
  const w = Math.max(ma.width, mb.width);
  const gap = 10;
  const svg = `<svg width="${w}" height="28"><rect width="100%" height="100%" fill="#111"/><text x="8" y="19" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="13" fill="#8fd0ff">${labelA}</text><text x="${w / 2 + 8}" y="19" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="13" fill="#8fd0ff">${labelB}</text></svg>`;
  const head = sharp(Buffer.from(svg));
  const [, , hh] = [0, 0, 28];
  const total = ma.height + mb.height + gap + 28;
  await sharp({ create: { width: w, height: total, channels: 3, background: '#0b0b0b' } })
    .composite([
      { input: Buffer.from(svg), top: 0, left: 0 },
      { input: await sharp(a).toBuffer(), top: 28, left: 0 },
      { input: await sharp(b).toBuffer(), top: 28 + ma.height + gap, left: 0 },
    ])
    .png()
    .toFile(path.join(OUT, out + '.png'));
  console.log('wrote', out, `${w}x${total}`);
}

for (const [tag, name] of pairs) {
  const before = path.join(DIR, `${TAG}-${tag}-before.png`);
  const after = path.join(DIR, `${TAG}-${tag}.png`);
  // 对 bright-probe 只有 after；用 bright-before-left 当 before
  const b2 = tag === 'bright-probe-left' ? path.join(DIR, `${TAG}-bright-before-left.png`) : before;
  await stack(b2, after, name, 'BEFORE (pre-material)', 'AFTER (Figma Regular/Medium)');
}
/* 托盘 */
for (const id of ['control-panel', 'location-bar']) {
  const after = path.join(DIR, `${TAG}-tray-${id}.png`);
  const before = path.join(DIR, `${TAG}-tray-${id}-before.png`);
  await stack(before, after, `tray-${id}`, 'BEFORE', 'AFTER');
}
