#!/usr/bin/env node
/** voice 卡局部对照（从整页截图裁，位置取 report.json 的 rect；底部越界自动夹紧） */
import sharp from 'sharp';
import fs from 'node:fs';
const DIR = process.argv[2] || 'evidence/_collab/t_fdd76e7a/final3';
const T = process.argv[3] || 'v9';
const OUT = process.argv[4] || 'evidence/_collab/t_fdd76e7a/cmp';
const rep = JSON.parse(fs.readFileSync(`${DIR}/report.json`, 'utf8'));
const r = rep.phases.dark.cards['gev-voice-control'];
const DSF = 2, m = 16;
const full = `${DIR}/${T}-dark-full.png`;
const meta = await sharp(full).metadata();
const left = Math.max(0, Math.min(meta.width - 20, Math.round((r[0] - m) * DSF)));
const top = Math.max(0, Math.min(meta.height - 20, Math.round((r[1] - m) * DSF)));
const width = Math.min(meta.width - left, Math.round((r[2] + m * 2) * DSF));
const height = Math.min(meta.height - top, Math.round((r[3] + m * 2) * DSF));
const crop = async (src, dst) => {
  if (!fs.existsSync(src)) { console.log('skip', src); return null; }
  await sharp(src).extract({ left, top, width, height }).toFile(dst);
  return dst;
};
const before = await crop(`${DIR}/${T}-dark-before-full.png`, `${DIR}/${T}-voice-before.png`);
const after = await crop(full, `${DIR}/${T}-voice-after.png`);
const head = 26, gap = 8;
const svg = `<svg width="${width}" height="${head}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#101418"/><text x="8" y="18" font-family="Segoe UI, Microsoft YaHei, sans-serif" font-size="12" fill="#7fd0ff">BEFORE voice card (top) / AFTER (bottom)</text></svg>`;
const total = head + height * 2 + gap;
await sharp({ create: { width, height: total, channels: 3, background: '#08090b' } })
  .composite([
    { input: Buffer.from(svg), top: 0, left: 0 },
    { input: await sharp(before).toBuffer(), top: head, left: 0 },
    { input: await sharp(after).toBuffer(), top: head + height + gap, left: 0 },
  ]).png().toFile(`${OUT}/voice-card.png`);
console.log('wrote voice-card.png', width, total, 'rect', r, 'meta', meta.width, meta.height);
