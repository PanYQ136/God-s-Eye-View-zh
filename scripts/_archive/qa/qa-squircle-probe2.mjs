#!/usr/bin/env node
/**
 * qa-squircle-probe2.mjs —— 测 Chrome 155 `corner-shape: squircle` 的真实几何
 *  1) 探针：200×200 黑块（r=40px, dsf=4）在纯白上，逐行扫左上角轮廓 → inset(v)
 *  2) 用几何超椭圆 |(r-u)/r|^n + |(r-v)/r|^n = 1 最小二乘拟合 n（n=2 就是圆）
 *  3) 同帧渲染 round / superellipse(1..4) 作对照，确认 squircle 对应哪个几何指数
 *  输出：evidence/_collab/t_3e129970/probe-squircle.json + probe-boxes-4x.png
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const OUT = 'evidence/_collab/t_3e129970';
fs.mkdirSync(OUT, { recursive: true });
const S = 4, BOX = 200, R = 40;

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--force-color-profile=srgb', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 500, deviceScaleFactor: S });
const support = await page.evaluate(() => ({
  ua: navigator.userAgent,
  squircle: CSS.supports('corner-shape', 'squircle'),
  round: CSS.supports('corner-shape', 'round'),
  superellipse: CSS.supports('corner-shape', 'superellipse(3)'),
}));

const names = ['round', 'squircle', 'superellipse(1)', 'superellipse(2)', 'superellipse(3)', 'superellipse(4)'];
const html = `<!doctype html><meta charset=utf-8><style>
  html,body{margin:0;background:#fff}
  .b{position:absolute;width:${BOX}px;height:${BOX}px;background:#000;border-radius:${R}px}
  ${names.map((s, i) => `.b:nth-child(${i + 1}){left:${20 + i * 230}px;top:40px;corner-shape:${s}}`).join('\n  ')}
</style>${names.map(() => '<div class=b></div>').join('')}`;
await page.setContent(html, { waitUntil: 'load' });
const computed = await page.evaluate(() => Array.from(document.querySelectorAll('.b')).map((e) => {
  const c = getComputedStyle(e); return { shape: c.cornerShape, radius: c.borderTopLeftRadius };
}));
const png = `${OUT}/probe-boxes-4x.png`;
await page.screenshot({ path: png });

const img = sharp(png);
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, CH = info.channels;
const lumAt = (x, y) => { const i = (y * W + x) * CH; return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; };

const boxes = names.map((name, i) => {
  const cx = Math.round((20 + i * 230 + BOX / 2) * S), cy = Math.round((40 + BOX / 2) * S);
  let x0 = cx; while (x0 > 0 && lumAt(x0 - 1, cy) < 128) x0--;
  let y0 = cy; while (y0 > 0 && lumAt(cx, y0 - 1) < 128) y0--;
  let x1 = cx; while (x1 < W - 1 && lumAt(x1 + 1, cy) < 128) x1++;
  let y1 = cy; while (y1 < H - 1 && lumAt(cx, y1 + 1) < 128) y1++;
  return { name, shape: computed[i].shape, x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1, scale: (x1 - x0 + 1) / BOX };
});

function profile(b) {
  const rows = [];
  const rp = Math.round(R * b.scale);
  for (let v = 0; v <= rp; v++) {
    let first = null;
    for (let u = 0; u <= rp + Math.round(2 * b.scale); u++) {
      if (lumAt(b.x0 + u, b.y0 + v) < 128) { first = u; break; }
    }
    rows.push(first === null ? null : first / b.scale);
  }
  return rows;
}
const pred = (n, v) => (v >= R ? 0 : R - R * Math.pow(Math.max(0, 1 - Math.pow(Math.max(0, (R - v) / R), n)), 1 / n));
function rmse(rows, n) {
  let s = 0, c = 0;
  for (let v = 2; v < rows.length - 2; v++) {
    if (rows[v] === null) continue;
    if (v / 4 >= R - 1) continue;
    const d = rows[v] - pred(n, v / 4); s += d * d; c++;
  }
  return c ? Math.sqrt(s / c) : NaN;
}
const fitN = (rows) => {
  let best = { n: 0, e: 1e9 }, eCircle = null;
  for (let n = 1.5; n <= 12.001; n += 0.01) {
    const e = rmse(rows, n);
    if (e < best.e) best = { n: +n.toFixed(2), e: +e.toFixed(3) };
    if (eCircle === null && Math.abs(n - 2) < 0.006) eCircle = +e.toFixed(3);
  }
  return { ...best, eCircle };
};
const out = { support, computed, meta: { W, H, CH }, boxes, results: [] };
for (const b of boxes) {
  const rows = profile(b);
  out.results.push({
    name: b.name, computedShape: b.shape, scale: +b.scale.toFixed(3),
    fit: fitN(rows),
    insetSumPx: +rows.reduce((a, u) => a + (u === null ? 0 : u), 0).toFixed(1),
    insets: [4, 8, 12, 16, 20, 28, 36].map((c) => { const v = c * 4; return { vCss: c, u: rows[v] == null ? null : +rows[v].toFixed(2), uRound: +pred(2, c).toFixed(2), uSq4: +pred(4, c).toFixed(2) }; }),
  });
}
fs.writeFileSync(`${OUT}/probe-squircle.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ support, computed, boxes: boxes.map((b) => [b.name, b.w, b.h, +b.scale.toFixed(3), b.x0, b.y0]), results: out.results }, null, 1));
await browser.close();
