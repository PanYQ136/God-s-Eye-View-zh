#!/usr/bin/env node
/**
 * compose-cmp2.mjs —— 最终对比图（用 final-* 截图）
 *  A) 旧默认（1px CSS 假彩边，t_8cf06356/live-*）vs 本次（final-*）右栏 3x
 *  B) 3:25 真 SVG 模式 vs 本次：展开卡 3x
 *  C) 3:25 真 SVG 模式 vs 本次：左边缘 8x
 */
import sharp from 'sharp';
const OUT = 'evidence/_collab/t_9739e3a7';
const OLD = 'evidence/_collab/t_8cf06356';

async function crop(png, r, zoom) {
  return sharp(png).extract({ left: r.x, top: r.y, width: r.w, height: r.h })
    .resize({ width: r.w * zoom, height: r.h * zoom, kernel: 'nearest' }).png().toBuffer();
}
async function stack(items, file) {
  const metas = await Promise.all(items.map((i) => sharp(i.buf).metadata()));
  const w = Math.max(...metas.map((m) => m.width));
  const parts = []; let y = 0;
  for (let i = 0; i < items.length; i++) {
    const svg = `<svg width="${w}" height="26"><rect width="100%" height="100%" fill="#0b1118"/><text x="8" y="18" font-family="monospace" font-size="14" fill="#7fe9ff">${items[i].text}</text></svg>`;
    parts.push({ input: Buffer.from(svg), top: y, left: 0 }); y += 26;
    parts.push({ input: items[i].buf, top: y, left: 0 }); y += metas[i].height + 6;
  }
  await sharp({ create: { width: w, height: y, channels: 3, background: '#000' } }).composite(parts).png().toFile(`${OUT}/${file}`);
}
// A 右栏（折叠态）
const R1 = { x: 1288, y: 82, w: 212, h: 130 };
await stack([
  { text: '旧默认：warp blur6 + 1px CSS 假彩边（t_8cf06356 交付）', buf: await crop(`${OLD}/live-collapsed.png`, R1, 3) },
  { text: '本次：CSS 中心磨砂 + 边缘 16px 真折射环（WebGL，R/G/B 分离）', buf: await crop(`${OUT}/final-collapsed.png`, R1, 3) },
], 'cmp-A-old-vs-new-rail-3x.png');
// B 展开卡
const R2 = { x: 40, y: 82, w: 300, h: 200 };
await stack([
  { text: '3:25 rdev SVG 位移（≈8fps，参考外观）', buf: await crop(`${OLD}/mode-lens-svg-data-expanded.png`, R2, 3) },
  { text: '本次：CSS 中心 + 边缘折射环（≈100fps）', buf: await crop(`${OUT}/final-expanded.png`, R2, 3) },
], 'cmp-B-3h25-vs-ring-expanded-3x.png');
// C 左边缘 8x
const R3 = { x: 44, y: 140, w: 40, h: 110 };
await stack([
  { text: '3:25 SVG 左边缘 8x', buf: await crop(`${OLD}/mode-lens-svg-data-expanded.png`, R3, 8) },
  { text: '本次 环：左边缘 8x', buf: await crop(`${OUT}/final-expanded.png`, R3, 8) },
], 'cmp-C-left-edge-8x.png');
console.log('ok');
