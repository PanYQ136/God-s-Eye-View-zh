#!/usr/bin/env node
/**
 * qa-squircle-probe.mjs —— 测出 Chrome 155 `corner-shape: squircle` 的真实超椭圆指数
 *   做法：离屏画一个 200×200 黑块（border-radius 40px，corner-shape squircle）压在纯白上，
 *         逐行扫左上角轮廓（第一个暗像素的 x）→ inset(y)，再用最小二乘拟合
 *         superellipse |(r-u)/r|^n + |(r-v)/r|^n = 1 的 n，并与圆（n=2）对比。
 *   输出：evidence/_collab/t_3e129970/probe-squircle.json + 角部 4x 图
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const OUT = 'evidence/_collab/t_3e129970';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--disable-lcd-text', '--force-color-profile=srgb', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 600, height: 600, deviceScaleFactor: 4 });
const support = await page.evaluate(() => ({
  ua: navigator.userAgent,
  squircle: CSS.supports('corner-shape', 'squircle'),
  superellipse: CSS.supports('corner-shape', 'superellipse(4)'),
  round: CSS.supports('corner-shape', 'round'),
}));

// 两个探针：squircle 与普通圆角（对照），半径 40px，4x 像素
const html = `<!doctype html><meta charset=utf-8><style>
  html,body{margin:0;background:#fff}
  .b{position:absolute;width:200px;height:200px;background:#000;border-radius:40px}
  #sq{left:40px;top:40px;corner-shape:squircle}
  #rd{left:40px;top:300px}
</style><div class=b id=sq></div><div class=b id=rd></div>`;
await page.setContent(html, { waitUntil: 'load' });
const info = await page.evaluate(() => {
  const g = (id) => { const c = getComputedStyle(document.getElementById(id)); return { radius: c.borderTopLeftRadius, shape: c.cornerShape }; };
  return { sq: g('sq'), rd: g('rd') };
});
await page.screenshot({ path: `${OUT}/probe-boxes-4x.png` });

async function profile(png, boxTopLeftCss, r) {
  // 读整张 PNG 原始像素（4x）
  const img = sharp(png);
  const { width, height } = await img.metadata();
  const raw = await img.raw().toBuffer();          // RGBA
  const S = 4;
  const x0 = Math.round(boxTopLeftCss * S);
  const y0 = Math.round(boxTopLeftCss * S);
  const rp = r * S;
  const rows = [];
  for (let v = 0; v <= rp; v++) {
    const y = y0 + v;
    let first = null;
    for (let u = 0; u < rp + S; u++) {
      const i = (y * width + (x0 + u)) * 4;
      const lum = 0.2126 * raw[i] + 0.7152 * raw[i + 1] + 0.0722 * raw[i + 2];
      if (lum < 128) { first = u; break; }
    }
    rows.push(first === null ? null : first);
  }
  return { rows, S, rp, width, height };
}
const sqP = await profile(`${OUT}/probe-boxes-4x.png`, 40, 40);
// 圆角对照块的左上角是 (40,300)
const rdRaw = await (async () => {
  const img = sharp(`${OUT}/probe-boxes-4x.png`);
  const { width } = await img.metadata();
  const raw = await img.raw().toBuffer();
  const S = 4, x0 = 40 * S, y0 = 300 * S, rp = 40 * S;
  const rows = [];
  for (let v = 0; v <= rp; v++) {
    const y = y0 + v; let first = null;
    for (let u = 0; u < rp + S; u++) {
      const i = (y * width + (x0 + u)) * 4;
      const lum = 0.2126 * raw[i] + 0.7152 * raw[i + 1] + 0.0722 * raw[i + 2];
      if (lum < 128) { first = u; break; }
    }
    rows.push(first === null ? null : first);
  }
  return rows;
})();

// 拟合：inset(v) 以 px 计（行 v 的第一个暗像素距离左边）
function pred(n, v, r) { // v 距顶边 px（浮点）
  const t = Math.min(1, Math.max(0, 1 - Math.pow(Math.max(0, (r - v) / r), n)));
  return r - r * Math.pow(t, 1 / n);
}
function rmse(rows, n, r, S) {
  let s = 0, c = 0;
  for (let v = 1; v < rows.length; v++) {
    if (rows[v] === null) continue;
    const vCss = v / S, uCss = rows[v] / S;
    if (vCss >= r - 0.5) continue;
    const d = uCss - pred(n, vCss, r);
    s += d * d; c++;
  }
  return Math.sqrt(s / c);
}
const fit = (rows, S) => {
  let best = { n: 0, e: 1e9 };
  const table = [];
  for (let n = 1.8; n <= 12.001; n += 0.02) { const e = rmse(rows, n, 40, S); table.push({ n: +n.toFixed(2), e: +e.toFixed(3) }); if (e < best.e) best = { n: +n.toFixed(2), e: +e.toFixed(3) }; }
  return { best, eRound: +rmse(rows, 2, 40, S).toFixed(3), eSq4: +rmse(rows, 4, 40, S).toFixed(3), table: table.filter((_, i) => i % 10 === 0) };
};
const out = {
  support, info,
  squircleFit: fit(sqP.rows, 4),
  circleFit: fit(rdRaw, 4),
  samples: {
    squircle: [1, 4, 8, 12, 20, 28, 36, 40].map((v) => ({ v, u: sqP.rows[v * 4] === null ? null : +(sqP.rows[v * 4] / 4).toFixed(2) })),
    circle: [1, 4, 8, 12, 20, 28, 36, 40].map((v) => ({ v, u: rdRaw[v * 4] === null ? null : +(rdRaw[v * 4] / 4).toFixed(2) })),
  },
};
fs.writeFileSync(`${OUT}/probe-squircle.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
