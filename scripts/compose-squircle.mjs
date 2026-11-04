#!/usr/bin/env node
/** compose-squircle.mjs —— 只做合成（不启浏览器），标签两行、不再截断 */
import sharp from 'sharp';
import fs from 'node:fs';

const OUT = 'evidence/_collab/t_3e129970';
const DSF = 2, VW = 1536, VH = 730;
const rep = JSON.parse(fs.readFileSync(`${OUT}/squircle-report2.json`, 'utf8'));
const rects = rep.phases.corners.rectsA;

const cropAt = async (png, rect, corner, sizeCss, zoom) => {
  const [x, y, w, h] = rect;
  const pad = Math.round(sizeCss * 0.09);
  let left, top;
  if (corner === 'tl') { left = x - pad; top = y - pad; }
  else if (corner === 'tr') { left = x + w - sizeCss + pad; top = y - pad; }
  else if (corner === 'bl') { left = x - pad; top = y + h - sizeCss + pad; }
  else { left = x + w - sizeCss + pad; top = y + h - sizeCss + pad; }
  const box = { left: Math.max(0, Math.round(left * DSF)), top: Math.max(0, Math.round(top * DSF)), width: sizeCss * DSF, height: sizeCss * DSF };
  return sharp(png).extract(box).resize({ width: sizeCss * DSF * zoom, height: sizeCss * DSF * zoom, kernel: 'nearest' }).png().toBuffer();
};

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
function label2(l1, l2, w, color1 = '#7fe9ff', color2 = '#ffffff') {
  return Buffer.from(`<svg width="${w}" height="58"><rect width="100%" height="100%" fill="#0a1016"/>
    <text x="8" y="22" font-family="Consolas,monospace" font-size="15" fill="${color1}">${esc(l1)}</text>
    <text x="8" y="48" font-family="Consolas,monospace" font-size="17" fill="${color2}">${esc(l2)}</text></svg>`);
}
async function grid(tiles, cols, file, title, sub) {
  const metas = await Promise.all(tiles.map((t) => sharp(t.buf).metadata()));
  const cw = Math.max(...metas.map((m) => m.width));
  const ch = Math.max(...metas.map((m) => m.height));
  const labH = 58, pad = 12, head = 76;
  const rows = Math.ceil(tiles.length / cols);
  const W = cols * (cw + pad) + pad;
  const H = head + rows * (ch + labH + pad) + pad;
  const comps = [{
    input: Buffer.from(`<svg width="${W}" height="${head}"><rect width="100%" height="100%" fill="#06090d"/>
      <text x="14" y="32" font-family="Consolas,monospace" font-size="23" fill="#ffffff">${esc(title)}</text>
      <text x="14" y="60" font-family="Consolas,monospace" font-size="16" fill="#8aa6b8">${esc(sub || '')}</text></svg>`), top: 0, left: 0,
  }];
  for (let i = 0; i < tiles.length; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const x = pad + c * (cw + pad);
    const y = head + pad + r * (ch + labH + pad);
    comps.push({ input: label2(tiles[i].l1, tiles[i].l2, cw, tiles[i].c1, tiles[i].c2), top: y, left: x });
    comps.push({ input: tiles[i].buf, top: y + labH, left: x });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: '#06090d' } }).composite(comps).png().toFile(`${OUT}/${file}`);
  return { file, W, H };
}

/* 1) 全屏 A/B */
{
  const a = await sharp(`${OUT}/before-2x.png`).resize({ width: VW, height: VH, kernel: 'lanczos3' }).png().toBuffer();
  const b = await sharp(`${OUT}/after-2x.png`).resize({ width: VW, height: VH, kernel: 'lanczos3' }).png().toBuffer();
  const W = VW, H = 40 + VH + 34 + VH + 20;
  await sharp({ create: { width: W, height: H, channels: 3, background: '#06090d' } }).composite([
    { input: Buffer.from(`<svg width="${W}" height="34"><rect width="100%" height="100%" fill="#06090d"/><text x="12" y="24" font-family="Consolas,monospace" font-size="20" fill="#ff9188">A · 改动前：border-radius:16px（普通圆弧），1536×730</text></svg>`), top: 0, left: 0 },
    { input: a, top: 36, left: 0 },
    { input: Buffer.from(`<svg width="${W}" height="30"><rect width="100%" height="100%" fill="#06090d"/><text x="12" y="22" font-family="Consolas,monospace" font-size="20" fill="#7fe9ff">B · 改动后：corner-shape:squircle（半径仍是 16px），1536×730</text></svg>`), top: 36 + VH + 4, left: 0 },
    { input: b, top: 36 + VH + 34, left: 0 },
  ]).png().toFile(`${OUT}/cmp-full-1536x730.png`);
}

/* 2) 角部 4x（每张卡一行两格：前 / 后） + 8x 特写 */
{
  const CORNERS = [
    ['data-panel 左上', 'data-panel', 'tl'],
    ['cctv-panel 右上', 'cctv-panel', 'tr'],
    ['global-context 左下', 'global-context-panel', 'bl'],
    ['control-panel 左上', 'control-panel', 'tl'],
  ];
  const tiles = [];
  for (const [name, id, corner] of CORNERS) {
    tiles.push({ l1: name, l2: '前 · 圆角', c1: '#ff9188', c2: '#ff9188', buf: await cropAt(`${OUT}/before-2x.png`, rects[id], corner, 44, 2) });
    tiles.push({ l1: name, l2: '后 · squircle', c1: '#7fe9ff', c2: '#7fe9ff', buf: await cropAt(`${OUT}/after-2x.png`, rects[id], corner, 44, 2) });
  }
  await grid(tiles, 2, 'cmp-corners-4x.png', '角部 4× 对比（每格 44 CSS px）', '同位置同时刻抓帧，变量只有 corner-shape');
}
{
  // 8x 单角特写：data-panel 左上，30×30 CSS px
  const tiles = [
    { l1: 'data-panel 左上 · 30px 区域 8×', l2: '前 · 普通圆弧', c1: '#ff9188', c2: '#ff9188', buf: await cropAt(`${OUT}/before-2x.png`, rects['data-panel'], 'tl', 30, 4) },
    { l1: 'data-panel 左上 · 30px 区域 8×', l2: '后 · squircle 连续转角', c1: '#7fe9ff', c2: '#7fe9ff', buf: await cropAt(`${OUT}/after-2x.png`, rects['data-panel'], 'tl', 30, 4) },
  ];
  await grid(tiles, 2, 'cmp-corner-8x.png', '单角 8× 特写（30 CSS px 区域）', '左：直边直接切进圆弧　右：直边→圆角连续过渡');
}

/* 3) 展开卡 4x */
{
  const qa3 = JSON.parse(fs.readFileSync(`${OUT}/qa3.json`, 'utf8'));
  const rect = qa3.overXAfter.rect;
  const tiles = [
    { l1: '展开卡 320×380 左上', l2: '前 · 普通圆弧', c1: '#ff9188', c2: '#ff9188', buf: await cropAt(`${OUT}/expanded-before-2x.png`, rect, 'tl', 44, 2) },
    { l1: '展开卡 320×380 左上', l2: '后 · squircle', c1: '#7fe9ff', c2: '#7fe9ff', buf: await cropAt(`${OUT}/expanded-after-2x.png`, rect, 'tl', 44, 2) },
  ];
  await grid(tiles, 2, 'cmp-expanded-4x.png', '展开卡角部 4×（内层 8px 同心）', 'padding 8px 透镜带仍在，内容不被圆角裁掉');
}

/* 4) 轮廓数学图（实测采样点 + 模型曲线） */
{
  const raw = JSON.parse(fs.readFileSync(`${OUT}/measure-raw.json`, 'utf8'));
  const R = raw.r;
  const pred = (n, v) => (v <= 0 || v >= R ? 0 : R - R * Math.pow(Math.max(0, 1 - Math.pow((R - v) / R, n)), 1 / n));
  const fitOf = (pts) => {
    const good = pts.filter((p) => p.u !== null && p.u >= -0.6 && p.v > 0.2 && p.v < R - 0.8);
    const rmse = (n) => Math.sqrt(good.reduce((a, p) => a + (p.u - pred(n, p.v)) ** 2, 0) / good.length);
    let best = { n: 0, e: 1e9 };
    for (let n = 1.6; n <= 9.001; n += 0.02) { const e = rmse(n); if (e < best.e) best = { n: +n.toFixed(2), e: +e.toFixed(3) }; }
    return { ...best, eCircle: +rmse(2).toFixed(3), eSq4: +rmse(4).toFixed(3), n_pts: good.length };
  };
  const fsq = fitOf(raw.squircle), frd = fitOf(raw.round);
  const SC = 26, OX = 78, OY = 104;
  const PX = (u) => OX + u * SC, PY = (v) => OY + v * SC;
  const path = (n) => {
    const ps = [];
    for (let v = 0; v <= R; v += 0.2) ps.push(`${PX(pred(n, v)).toFixed(1)},${PY(v).toFixed(1)}`);
    return `M ${ps.join(' L ')}`;
  };
  const dots = (pts, color, r = 3.4) => pts.filter((p) => p.u !== null).map((p) => `<circle cx="${PX(p.u).toFixed(1)}" cy="${PY(p.v).toFixed(1)}" r="${r}" fill="${color}"/>`).join('');
  const W = OX + R * SC + 600, H = OY + R * SC + 70;
  const svg = `<svg width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#06090d"/>
    <text x="16" y="32" font-family="Consolas,monospace" font-size="21" fill="#fff">卡角轮廓实测 vs 超椭圆模型（data-panel 左上角，半径 16px，.gev-lc 白卡黑底 2x 抓帧）</text>
    <text x="16" y="58" font-family="Consolas,monospace" font-size="15" fill="#8aa6b8">横轴 u = 距卡左边内缩(px)，纵轴 v = 距卡顶(px)；曲线越贴左上角 = 转角越「满」= iOS 连续转角</text>
    <line x1="${OX}" y1="${OY}" x2="${OX}" y2="${PY(R)}" stroke="#2c3d4d" stroke-width="1"/>
    <line x1="${OX}" y1="${OY}" x2="${PX(R)}" y2="${OY}" stroke="#2c3d4d" stroke-width="1"/>
    <path d="${path(2)}" stroke="#ff6b6b" stroke-width="1.6" fill="none" stroke-dasharray="6 5"/>
    <path d="${path(4)}" stroke="#7fe9ff" stroke-width="1.6" fill="none" stroke-opacity="0.8"/>
    ${dots(raw.squircle, '#7fe9ff')}
    ${dots(raw.round, '#ff6b6b')}
    <text x="${OX + 8}" y="${PY(R) - 6}" font-family="Consolas,monospace" font-size="14" fill="#8aa6b8">16px</text>
    <text x="${PX(R) + 90}" y="${OY + 40}" font-family="Consolas,monospace" font-size="17" fill="#7fe9ff">蓝点/实线 = 改动后 squircle</text>
    <text x="${PX(R) + 90}" y="${OY + 68}" font-family="Consolas,monospace" font-size="17" fill="#ff6b6b">红点/虚线 = 改动前 普通圆弧</text>
    <text x="${PX(R) + 90}" y="${OY + 110}" font-family="Consolas,monospace" font-size="16" fill="#ffffff">实测 n（后）= ${fsq.n}   RMSE ${fsq.e}px</text>
    <text x="${PX(R) + 90}" y="${OY + 134}" font-family="Consolas,monospace" font-size="16" fill="#9fb6c6">同数据用圆模型：RMSE ${fsq.eCircle}px（差 ${(fsq.eCircle / Math.max(fsq.e, 0.01)).toFixed(0)}×）</text>
    <text x="${PX(R) + 90}" y="${OY + 166}" font-family="Consolas,monospace" font-size="16" fill="#ff6b6b">实测 n（前）= ${frd.n}   RMSE ${frd.e}px（圆模型 ${frd.eCircle}px）</text>
    <text x="${PX(R) + 90}" y="${OY + 198}" font-family="Consolas,monospace" font-size="16" fill="#9fb6c6">隔离探针 r=40 @4x：squircle n=4.09 / round n=2.02</text>
    <text x="${PX(R) + 90}" y="${OY + 226}" font-family="Consolas,monospace" font-size="16" fill="#9fb6c6">采样点：后 ${fsq.n_pts} 行 / 前 ${frd.n_pts} 行（每行首个亮像素）</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(`${OUT}/cmp-shape-math.png`);
}
console.log(fs.readdirSync(OUT).filter((f) => f.startsWith('cmp-')));
