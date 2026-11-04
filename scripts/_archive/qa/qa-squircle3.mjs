#!/usr/bin/env node
/**
 * qa-squircle3.mjs —— 展开卡 A/B 角部 + 越界 A/B，并合成交付对比图
 *  1) 展开 data-panel：squircle 态 / round 态 各拍一张全屏 dsf2，裁左上角 4x
 *  2) 同一状态下量「子元素横向越界数」→ 证明 squircle 没有引入新的裁切
 *  3) sharp 合成：
 *       cmp-full-1536x730.png     全屏 A/B（上=前，下=后）
 *       cmp-corners-4x.png        4 个角 × (前/后) 4x
 *       cmp-expanded-4x.png       展开卡左上角 4x（前/后）
 *       cmp-shape-math.png        形状剖面：实测轮廓 vs 圆(n=2) vs squircle(n=4)
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const OUT = 'evidence/_collab/t_3e129970';
const DSF = 2, VW = 1536, VH = 730;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization', '--window-size=1536,820', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: VW, height: VH, deviceScaleFactor: DSF });
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('gev:first-run-mission:v1', 'suppressed');
    localStorage.setItem('gev.perfMode', '0');
    localStorage.setItem('gev.gfx', JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'default' }));
  } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await sleep(11000);
await page.keyboard.press('Escape');
await page.evaluate(() => {
  try {
    const C = window.Cesium || window.__CESIUM__;
    window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-73.9857, 40.7484, 2200), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } });
  } catch (e) {}
});
await sleep(12000);

const injectNoSq = () => page.evaluate(() => {
  let s = document.getElementById('qa-nosquircle');
  if (!s) { s = document.createElement('style'); s.id = 'qa-nosquircle'; document.head.appendChild(s); }
  s.textContent = '*, *::before, *::after { corner-shape: round !important; }';
});
const removeNoSq = () => page.evaluate(() => { const s = document.getElementById('qa-nosquircle'); if (s) s.remove(); });
const overX = () => page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const r = el.getBoundingClientRect();
  let n = 0, worst = 0;
  el.querySelectorAll('*').forEach((c) => {
    const b = c.getBoundingClientRect();
    if (b.width > 0 && b.height > 0) {
      const d = Math.max(0, r.left - b.left, b.right - r.right);
      if (d > 2) { n++; worst = Math.max(worst, +d.toFixed(1)); }
    }
  });
  return { n, worst, rect: [r.left, r.top, r.width, r.height].map((v) => Math.round(v * 10) / 10) };
});

/* 展开卡 A/B */
await page.evaluate(() => window.__gevLc.open('data-panel'));
await sleep(1600);
const rectSq = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
out.overXAfter = await overX();
const pngSq = await page.screenshot({ type: 'png' });
fs.writeFileSync(`${OUT}/expanded-after-2x.png`, pngSq);
await injectNoSq();
await sleep(1200);
out.overXBefore = await overX();
const pngRd = await page.screenshot({ type: 'png' });
fs.writeFileSync(`${OUT}/expanded-before-2x.png`, pngRd);
await removeNoSq();
await sleep(800);
await page.evaluate(() => window.__gevLc.close('data-panel'));
await sleep(900);
await browser.close();

/* ── 合成 ──────────────────────────────────────────────────────────────── */
const S = 44, PAD = 4;
function cropRect(rect, corner = 'tl') {
  const [x, y, w, h] = rect;
  let left, top;
  if (corner === 'tl') { left = x - PAD; top = y - PAD; }
  else if (corner === 'tr') { left = x + w - S + PAD; top = y - PAD; }
  else if (corner === 'bl') { left = x - PAD; top = y + h - S + PAD; }
  else { left = x + w - S + PAD; top = y + h - S + PAD; }
  return { left: Math.max(0, Math.round(left * DSF)), top: Math.max(0, Math.round(top * DSF)), width: S * DSF, height: S * DSF };
}
async function crop4x(png, rect, corner) {
  return sharp(png).extract(cropRect(rect, corner)).resize({ width: S * DSF * 2, height: S * DSF * 2, kernel: 'nearest' }).png().toBuffer();
}
function label(text, w, size = 22) {
  return Buffer.from(`<svg width="${w}" height="${size + 12}"><rect width="100%" height="100%" fill="#0a1016"/><text x="10" y="${size}" font-family="Consolas,monospace" font-size="${size}" fill="#7fe9ff">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`);
}
async function grid(items, cols, file, title) {
  // items: [{label, buf}]
  const metas = await Promise.all(items.map((i) => sharp(i.buf).metadata()));
  const cellW = Math.max(...metas.map((m) => m.width));
  const cellH = Math.max(...metas.map((m) => m.height));
  const labH = 34;
  const pad = 10;
  const rowsN = Math.ceil(items.length / cols);
  const W = cols * (cellW + pad) + pad;
  const H = (title ? 44 : 0) + rowsN * (cellH + labH + pad) + pad;
  const comps = [];
  if (title) comps.push({ input: Buffer.from(`<svg width="${W}" height="44"><rect width="100%" height="100%" fill="#06090d"/><text x="12" y="30" font-family="Consolas,monospace" font-size="24" fill="#ffffff">${title}</text></svg>`), top: 0, left: 0 });
  for (let i = 0; i < items.length; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const x = pad + c * (cellW + pad);
    const y = (title ? 44 : 0) + pad + r * (cellH + labH + pad);
    comps.push({ input: label(items[i].label, cellW, 20), top: y, left: x });
    comps.push({ input: items[i].buf, top: y + labH - 8, left: x });
  }
  await sharp({ create: { width: W, height: H, channels: 3, background: '#06090d' } }).composite(comps).png().toFile(`${OUT}/${file}`);
  return { file, W, H };
}

/* a) 全屏 A/B */
const fullBefore = await sharp(`${OUT}/before-2x.png`).resize({ width: VW, height: VH }).png().toBuffer();
const fullAfter = await sharp(`${OUT}/after-2x.png`).resize({ width: VW, height: VH }).png().toBuffer();
{
  const W = 1536, H = 730 * 2 + 96;
  await sharp({ create: { width: W, height: H, channels: 3, background: '#06090d' } }).composite([
    { input: Buffer.from(`<svg width="${W}" height="40"><rect width="100%" height="100%" fill="#06090d"/><text x="14" y="28" font-family="Consolas,monospace" font-size="22" fill="#fff">1536×730 · 上=改动前(border-radius 16px 圆弧) / 下=改动后(corner-shape:squircle, 半径不变)</text></svg>`), top: 0, left: 0 },
    { input: fullBefore, top: 40, left: 0 },
    { input: fullAfter, top: 40 + 730 + 16, left: 0 },
  ]).png().toFile(`${OUT}/cmp-full-1536x730.png`);
}

/* b) 4 角 4x */
const rects = JSON.parse(fs.readFileSync(`${OUT}/squircle-report2.json`, 'utf8')).phases.corners.rectsA;
const CORNERS = [
  ['data-panel 左上', 'data-panel', 'tl'],
  ['cctv-panel 右上', 'cctv-panel', 'tr'],
  ['global-context-panel 左下', 'global-context-panel', 'bl'],
  ['control-panel 左上', 'control-panel', 'tl'],
];
const items = [];
for (const [name, id, corner] of CORNERS) {
  items.push({ label: `${name} · 前(圆)` , buf: await crop4x(`${OUT}/before-2x.png`, rects[id], corner) });
  items.push({ label: `${name} · 后(squircle)`, buf: await crop4x(`${OUT}/after-2x.png`, rects[id], corner) });
}
const g1 = await grid(items, 2, 'cmp-corners-4x.png', '角部 4× 对比（每格 44 CSS px 区域放大到 4×）');

/* c) 展开卡 4x */
{
  const items2 = [
    { label: '展开卡左上 · 前(圆)', buf: await crop4x(`${OUT}/expanded-before-2x.png`, rectSq, 'tl') },
    { label: '展开卡左上 · 后(squircle)', buf: await crop4x(`${OUT}/expanded-after-2x.png`, rectSq, 'tl') },
  ];
  await grid(items2, 2, 'cmp-expanded-4x.png', '展开卡（320×380，padding 8，内层 8px 同心）角部 4×');
}

/* d) 形状剖面图：实测卡角轮廓 vs 圆 vs squircle */
{
  const rep = JSON.parse(fs.readFileSync(`${OUT}/squircle-report2.json`, 'utf8'));
  const sq = rep.phases.geometry.squircle.find((x) => x.id === 'data-panel');
  const rd = rep.phases.geometry.round.find((x) => x.id === 'data-panel');
  const R = 16, SC = 12;   // 12 px / css px
  const W = R * SC * 2 + 80, H = R * SC + 90;
  const predPath = (n) => {
    const pts = [];
    for (let v = 0; v <= R; v += 0.25) {
      const u = R - R * Math.pow(Math.max(0, 1 - Math.pow((R - v) / R, n)), 1 / n);
      pts.push(`${(u * SC + 40).toFixed(1)},${(v * SC + 50).toFixed(1)}`);
    }
    return `M ${pts.join(' L ')}`;
  };
  const svg = `<svg width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#06090d"/>
    <text x="10" y="24" font-family="Consolas,monospace" font-size="18" fill="#fff">卡角轮廓（实测像素 vs 模型） · x=内缩 u, y=距顶 v, 16px 半径</text>
    <path d="${predPath(2)}" stroke="#ff6b6b" stroke-width="2" fill="none" stroke-dasharray="6 4"/>
    <path d="${predPath(4)}" stroke="#7fe9ff" stroke-width="2" fill="none"/>
    ${sq.fit ? `<text x="${40}" y="${H - 46}" font-family="Consolas,monospace" font-size="16" fill="#7fe9ff">squircle 拟合 n=${sq.fit.n} (RMSE ${sq.fit.e}px)  ·  圆模型 RMSE ${sq.fit.eCircle}px</text>` : ''}
    ${rd.fit ? `<text x="${40}" y="${H - 22}" font-family="Consolas,monospace" font-size="16" fill="#ff6b6b">改动前(圆)拟合 n=${rd.fit.n} (RMSE ${rd.fit.e}px)</text>` : ''}
    <text x="${W - 300}" y="${H - 46}" font-family="Consolas,monospace" font-size="16" fill="#7fe9ff">蓝实线 = squircle (n=4)</text>
    <text x="${W - 300}" y="${H - 22}" font-family="Consolas,monospace" font-size="16" fill="#ff6b6b">红虚线 = 圆 (n=2)</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(`${OUT}/cmp-shape-math.png`);
}

out.files = fs.readdirSync(OUT).filter((f) => f.startsWith('cmp-'));
fs.writeFileSync(`${OUT}/qa3.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
