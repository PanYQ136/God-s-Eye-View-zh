#!/usr/bin/env node
/**
 * measure-squircle-raw.mjs —— 抓 data-panel 左上角的真实轮廓（两种角形），存原始采样点
 *   做法：白卡 #fff 压黑底、关边缘环 → 从卡左边 3px 外扫，逐行找第一颗亮像素
 *   输出：measure-raw.json { r, dsf, squircle:[{v,u}], round:[{v,u}] }
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const OUT = 'evidence/_collab/t_3e129970';
const DSF = 2, R = 16;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization', '--window-size=1536,820', '--window-position=1900,40', '--hide-scrollbars'],
  protocolTimeout: 600000,
});
const page = await b.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: DSF });
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
  let s = document.getElementById('qa-measure');
  if (!s) { s = document.createElement('style'); s.id = 'qa-measure'; document.head.appendChild(s); }
  s.textContent = `#cesiumContainer, .cesium-widget, .cesium-widget canvas, #gev-edge-lens { visibility: hidden !important; }
    html, body { background: #000 !important; }
    .gev-lc { background: #fff !important; box-shadow: none !important; }
    .gev-lc * { color: transparent !important; text-shadow: none !important; }
    .gev-lc .gev-lg-warp { display: none !important; }`;
  try { window.__gevEdge.off(); } catch (e) {}
});
await sleep(1200);

async function grab(tag) {
  const rect = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  const png = await page.screenshot({ type: 'png' });
  fs.writeFileSync(`${OUT}/raw-${tag}-2x.png`, png);
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const { width, channels } = info;
  const lum = (x, y) => { const i = (y * width + x) * channels; return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; };
  const x0 = Math.round(rect[0] * DSF), y0 = Math.round(rect[1] * DSF);
  const pts = [];
  for (let v = 0; v <= R * DSF; v++) {
    let u = null;
    for (let dx = -3 * DSF; dx <= R * DSF + DSF; dx++) {
      const px = x0 + dx;
      if (px < 0 || px >= width) continue;
      if (lum(px, y0 + v) > 128) { u = +(dx / DSF).toFixed(3); break; }
    }
    pts.push({ v: +(v / DSF).toFixed(2), u });
  }
  return { rect, pts };
}
const sq = await grab('squircle');
await page.evaluate(() => {
  let s = document.getElementById('qa-nosquircle');
  if (!s) { s = document.createElement('style'); s.id = 'qa-nosquircle'; document.head.appendChild(s); }
  s.textContent = '*, *::before, *::after { corner-shape: round !important; }';
});
await sleep(1000);
const rd = await grab('round');
fs.writeFileSync(`${OUT}/measure-raw.json`, JSON.stringify({ r: R, dsf: DSF, rectSq: sq.rect, rectRd: rd.rect, squircle: sq.pts, round: rd.pts }, null, 1));
console.log(JSON.stringify({ r: R, n: sq.pts.length, sampleSq: sq.pts.filter((p) => [0, 2, 4, 8, 12, 16].includes(p.v)), sampleRd: rd.pts.filter((p) => [0, 2, 4, 8, 12, 16].includes(p.v)) }, null, 1));
await b.close();
