// 校验第四帧真的「带字」：noedge+text vs noedge+noText 在 data 卡内区应 ≈ 文字像素数
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SHOTS = path.resolve('.gev-logs/phase2/shots');
const layout = JSON.parse(fs.readFileSync('.gev-logs/phase2/layout.json', 'utf8'));
const [CX, CY, CW, CH] = layout.cards.find((c) => c.id === 'data-panel').rect.map(Math.round);
const I = 40;
const raw = async (p) => {
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, ch: info.channels };
};
const px = (img, x, y) => {
  const o = (y * img.w + x) * img.ch;
  return [img.data[o], img.data[o + 1], img.data[o + 2]];
};
const dmax = (a, b) => Math.max(...[0, 1, 2].map((i) => Math.abs(a[i] - b[i])));

const pairs = [
  ['C-notext.png', 'C-noedge.png', 'edge on/off, both no text (part1)'],
  ['C-glass-1536x730.png', 'C-noedge-text.png', 'edge on/off, both with text (part3)'],
  ['C-glass-1536x730.png', 'C-notext.png', 'text on/off, edge on (control)'],
  ['C-noedge-text.png', 'C-noedge.png', 'text on/off, edge off (validates 4th frame)'],
];
for (const [fa, fb, label] of pairs) {
  const a = await raw(path.join(SHOTS, fa));
  const b = await raw(path.join(SHOTS, fb));
  let n = 0,
    maxD = 0;
  for (let y = CY + I; y < CY + CH - I; y++)
    for (let x = CX + I; x < CX + CW - I; x++) {
      const d = dmax(px(a, x, y), px(b, x, y));
      if (d > maxD) maxD = d;
      if (d > 1) n++;
    }
  console.log(`${label.padEnd(42)} ${fa} vs ${fb} → changed ${n}/72000, maxΔ ${maxD}`);
}
