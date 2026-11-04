#!/usr/bin/env node
/**
 * compose-cmp.mjs —— 拼对比图
 *  1) 3:25 真 SVG 模式（t_8cf06356/mode-lens-svg-*） vs 本次边缘折射环
 *  2) 折叠态右栏两张卡 + 展开态左卡，各自 3x 放大上下叠放
 */
import sharp from 'sharp';
const OUT = 'evidence/_collab/t_9739e3a7';
const REF = 'evidence/_collab/t_8cf06356';

async function crop(png, r, zoom) {
  return sharp(png).extract({ left: r.x, top: r.y, width: r.w, height: r.h })
    .resize({ width: r.w * zoom, height: r.h * zoom, kernel: 'nearest' }).png().toBuffer();
}
async function label(buf, text, w) {
  const svg = `<svg width="${w}" height="26"><rect width="100%" height="100%" fill="#101820"/><text x="8" y="18" font-family="monospace" font-size="14" fill="#8fe">${text}</text></svg>`;
  return sharp({ create: { width: w, height: 26, channels: 3, background: '#101820' } })
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}
async function stack(items, file) {
  // items: [{text, buf}]
  const metas = await Promise.all(items.map((i) => sharp(i.buf).metadata()));
  const w = Math.max(...metas.map((m) => m.width));
  const parts = [];
  let y = 0;
  for (let i = 0; i < items.length; i++) {
    const lb = await label(null, items[i].text, w);
    parts.push({ input: lb, top: y, left: 0 }); y += 26;
    parts.push({ input: items[i].buf, top: y, left: 0 }); y += metas[i].height + 6;
  }
  await sharp({ create: { width: w, height: y, channels: 3, background: '#000' } })
    .composite(parts).png().toFile(`${OUT}/${file}`);
}

// 折叠态：右栏 pp-toggles + cctv 区域
const R1 = { x: 1290, y: 78, w: 210, h: 130 };
const a = await crop(`${REF}/mode-lens-svg-collapsed.png`, R1, 3);
const b = await crop(`${OUT}/accept-collapsed.png`, R1, 3);
await stack([{ text: '3:25 rdev SVG 位移（≈8fps，参考外观）', buf: a },
  { text: '本次：CSS中心 + 边缘真折射环（100+fps）', buf: b }], 'cmp-collapsed-right-rail-3x.png');

// 展开态：左卡左上角（含标题 + 边缘）
const R2 = { x: 40, y: 80, w: 300, h: 200 };
const c = await crop(`${REF}/mode-lens-svg-data-expanded.png`, R2, 3);
const d = await crop(`${OUT}/accept-expanded.png`, R2, 3);
await stack([{ text: '3:25 rdev SVG 位移（展开卡）', buf: c },
  { text: '本次：边缘折射环（展开卡）', buf: d }], 'cmp-expanded-3x.png');

// 边缘 1:1 细节（左边缘 40px 带，8x）
const R3 = { x: 44, y: 150, w: 44, h: 120 };
const e = await crop(`${REF}/mode-lens-svg-data-expanded.png`, R3, 8);
const f = await crop(`${OUT}/accept-expanded.png`, R3, 8);
await stack([{ text: '3:25 SVG：左边缘 8x', buf: e }, { text: '本次 环：左边缘 8x', buf: f }], 'cmp-left-edge-8x.png');
console.log('ok');
