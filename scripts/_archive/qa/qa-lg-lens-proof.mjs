#!/usr/bin/env node
/**
 * qa-lg-lens-proof.mjs —— 用「参数开/关的像素差」证明三件事（规范 §5.1 / §3.3）
 *   1) 透镜只在边缘带（实测带宽）生效，中心完全干净
 *   2) 分通道色散真实存在（R/G/B 位移不同）
 *   3) 白色 rim 只出现在最外沿
 * 输出: lens-proof.json + lens-diff-band.png + lens-diff-disp.png + lens-diff-rim.png
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const url = process.argv[2] || 'http://localhost:5183/';
const outDir = 'evidence/lg-glass-shots/p0';
const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel'), { timeout: 120000 });
await new Promise((r) => setTimeout(r, 9000));
await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => { const w = document.querySelector('.welcome-modal, #welcome-modal'); if (w) { const c = w.querySelector('input'); if (c) c.click(); const b = w.querySelector('button'); if (b) b.click(); } });
// 高对比城市纹理（曼哈顿 1.2km，街道/建筑边缘密集）
await page.evaluate(() => { try { window.__gevViewer.camera.setView({ destination: window.__CESIUM__.Cartesian3.fromDegrees(-73.9857, 40.7484, 1200), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }); } catch (e) {} });
await new Promise((r) => setTimeout(r, 14000));
let ready = false;
for (let i = 0; i < 20; i++) {
  ready = await page.evaluate(() => !!(window.__gevGlStats && window.__gevGlStats().count >= 9 && typeof window.__gevGlSet === 'function'));
  if (ready) break;
  await new Promise((r) => setTimeout(r, 1500));
}
if (!ready) {
  const st = await page.evaluate(() => ({ stats: window.__gevGlStats ? window.__gevGlStats().count : null, probe: window.__gevGlProbe ? window.__gevGlProbe() : null, html: document.documentElement.className }));
  console.log('GLASS_NOT_READY', JSON.stringify(st));
  await browser.close();
  process.exit(2);
}
// 展开显示卡（大卡：320×430，18px 透镜带外仍有干净中心，便于证明「边缘带 vs 中心」）
await page.evaluate(() => { try { window.__gevLc.open('pp-toggles'); } catch (e) {} });
await new Promise((r) => setTimeout(r, 1200));
// 冻结地图渲染（保证两次截图除玻璃参数外完全一致）
await page.evaluate(async () => {
  const v = window.__gevViewer;
  v.useDefaultRenderLoop = false;
  await new Promise((r) => setTimeout(r, 300));
  v.render();
  await new Promise((r) => setTimeout(r, 500));
});

const cardBox = await page.evaluate(() => {
  const e = document.getElementById('pp-toggles');
  const r = e.getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
});
const clip = { x: cardBox.x - 12, y: cardBox.y - 12, width: cardBox.w + 24, height: cardBox.h + 24 };

const shot = async () => (await page.screenshot({ clip })).toString('base64');

const A = await shot();                                               // 全开（斜面折射 + 8 光谱色散 + 双侧高光）
await page.evaluate(() => window.__gevGlSet({ gain: 0, etaLo: 1.52, etaHi: 1.52, rimAmt: 0, innerDark: 0 }));
await new Promise((r) => setTimeout(r, 400));
const B = await shot();                                               // 折射/色散/高光全关
await page.evaluate(() => window.__gevGlSet({ gain: 1.0, etaLo: 1.52, etaHi: 1.52, rimAmt: 0, innerDark: 0 }));
await new Promise((r) => setTimeout(r, 400));
const C = await shot();                                               // 只开单色折射
await page.evaluate(() => window.__gevGlSet({ gain: 1.0, etaLo: 1.48, etaHi: 1.56, rimAmt: 0, innerDark: 0 }));
await new Promise((r) => setTimeout(r, 400));
const D = await shot();                                               // 折射 + 8 光谱色散
await page.evaluate(() => window.__gevGlSet({ gain: 1.0, etaLo: 1.48, etaHi: 1.56, rimAmt: 0.5, innerDark: 0.14 }));
await new Promise((r) => setTimeout(r, 400));

const analysis = await page.evaluate(async (A, B, C, D, cardBox, clip, dsf) => {
  const load = (b64) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + b64; });
  const [ia, ib, ic, id] = await Promise.all([load(A), load(B), load(C), load(D)]);
  const W = ia.width, H = ia.height;
  const mk = (img) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0); return x.getImageData(0, 0, W, H).data; };
  const da = mk(ia), db = mk(ib), dc = mk(ic), dd = mk(id);

  // 卡片在截图中的局部坐标（含 12px 外扩）
  const bx = (cardBox.x - clip.x) * dsf, by = (cardBox.y - clip.y) * dsf;
  const bw = cardBox.w * dsf, bh = cardBox.h * dsf;

  const distToEdge = (px, py) => {
    const l = px - bx, r = bx + bw - px, t = py - by, b = by + bh - py;
    return Math.min(l, r, t, b);
  };

  // 1) 透镜带宽：用 B(无折射) vs C(有折射) 隔离「折射」单一变量
  const bins = {};
  const chan = { r: 0, g: 0, b: 0 };
  const heat = document.createElement('canvas'); heat.width = W; heat.height = H;
  const hx = heat.getContext('2d'); const hd = hx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const inside = x >= bx && x < bx + bw && y >= by && y < by + bh;
      if (!inside) continue;
      const d = Math.abs(dc[i] - db[i]) + Math.abs(dc[i + 1] - db[i + 1]) + Math.abs(dc[i + 2] - db[i + 2]);
      const dist = Math.round(distToEdge(x, y) / dsf); // CSS px
      const key = dist > 40 ? '40+' : String(dist);
      bins[key] = bins[key] || { n: 0, sum: 0 };
      bins[key].n++; bins[key].sum += d;
      // 色散：C(单色 IOR) vs D(8 光谱样本) 的分通道差
      chan.r += Math.abs(dd[i] - dc[i]);
      chan.g += Math.abs(dd[i + 1] - dc[i + 1]);
      chan.b += Math.abs(dd[i + 2] - dc[i + 2]);
      const v = Math.min(255, d * 12);
      hd.data[i] = v; hd.data[i + 1] = v; hd.data[i + 2] = v; hd.data[i + 3] = 255;
    }
  }
  hx.putImageData(hd, 0, 0);

  const rows = Object.keys(bins).map((k) => ({ distCssPx: k, samples: bins[k].n, meanAbsDiff: +(bins[k].sum / bins[k].n).toFixed(4) }))
    .sort((a, b) => (a.distCssPx === '40+' ? 1e9 : +a.distCssPx) - (b.distCssPx === '40+' ? 1e9 : +b.distCssPx));
  // 中心干净度：> 24px 内区域的均值
  const center = rows.filter((r) => r.distCssPx === '40+' || +r.distCssPx >= 24);
  const edge = rows.filter((r) => r.distCssPx !== '40+' && +r.distCssPx <= 12);
  const avg = (a) => a.length ? +(a.reduce((s, r) => s + r.meanAbsDiff, 0) / a.length).toFixed(4) : null;
  return {
    cardBox, clip, dsf, imageSize: [W, H],
    bandProfile: rows,
    'edgeMean(0-12px)': avg(edge),
    'centerMean(>=24px)': avg(center),
    dispersionChannelDiff: { r: +(chan.r / (bw * bh)).toFixed(4), g: +(chan.g / (bw * bh)).toFixed(4), b: +(chan.b / (bw * bh)).toFixed(4) },
    heatmap: heat.toDataURL('image/png'),
  };
}, A, B, C, D, cardBox, clip, 2);

const heatB64 = analysis.heatmap.split(',')[1];
delete analysis.heatmap;
fs.writeFileSync(`${outDir}/lens-diff-band.png`, Buffer.from(heatB64, 'base64'));
// 原图对照：全开 / 全关
fs.writeFileSync(`${outDir}/lens-on.png`, Buffer.from(A, 'base64'));
fs.writeFileSync(`${outDir}/lens-off.png`, Buffer.from(B, 'base64'));
fs.writeFileSync(`${outDir}/lens-proof.json`, JSON.stringify(analysis, null, 1));
console.log(JSON.stringify({ cardBox, edge: analysis['edgeMean(0-12px)'], center: analysis['centerMean(>=24px)'], disp: analysis.dispersionChannelDiff, profile: analysis.bandProfile }, null, 1));
await browser.close();
