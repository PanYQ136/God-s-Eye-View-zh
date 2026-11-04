#!/usr/bin/env node
/**
 * dbg-ablate.mjs —— 冻结条纹底图下逐层剥离，定位「谁把卡片涂黑」
 * 对 data-panel / pp-toggles 卡内同一 patch 依次：
 *  A 正常 → B 去掉 warp → C 去掉 warp + 卡壳底色 → D 再去掉内层底色/内层 blur
 * 每步记录 patch 的平均亮度与标准差（标准差大 = 条纹透出来了）
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1536, H = 730;
const OUT = 'docs/_collab/t_8cf06356';

const SW = 64, SH = 64, buf = Buffer.alloc(SW * SH * 3);
const cols = [[235, 55, 55], [55, 225, 90], [70, 95, 240], [245, 245, 245]];
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
  const c = cols[Math.floor(x / 16) % 4]; const k = y % 16 === 0 ? 0.45 : 1;
  const i = (y * SW + x) * 3; buf[i] = c[0] * k; buf[i + 1] = c[1] * k; buf[i + 2] = c[2] * k;
}
const b64 = 'data:image/png;base64,' + (await sharp(buf, { raw: { width: SW, height: SH, channels: 3 } }).png().toBuffer()).toString('base64');

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--window-size=1536,820'],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(1200);
await page.evaluate((b64) => {
  const st = document.createElement('style'); st.id = '__f';
  st.textContent = `.cesium-widget, .cesium-widget canvas { visibility: hidden !important; }
    .cesium-widget-credits,.cesium-viewer-bottom{display:none!important}
    #__probe_bg{position:fixed;inset:0;z-index:0;background-image:url(${b64});background-repeat:repeat}
    video{visibility:hidden!important}`;
  document.head.appendChild(st);
  const d = document.createElement('div'); d.id = '__probe_bg'; document.body.appendChild(d);
}, b64);
await sleep(800);

const patches = { 'data-panel': [150, 100, 60, 30], 'pp-toggles': [1400, 104, 60, 30], 'cctv-panel': [1400, 162, 60, 30], 'location-bar': [640, 648, 40, 30] };
const steps = [
  ['A 正常', ''],
  ['B 去 warp', '.gev-lg-warp{display:none!important}'],
  ['C 去 warp + 壳底色', '.gev-lg-warp{display:none!important}.gev-lc{background:transparent!important;box-shadow:none!important}'],
  ['D 再去内层底 + 内层 blur', '.gev-lg-warp{display:none!important}.gev-lc{background:transparent!important;box-shadow:none!important} .gev-lc [class$="-inner"],.gev-lc .pp-header-row,.gev-lc .panel-inner,.gev-lc .pp-panel-body{background:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'],
];
const res = {};
for (const [name, css] of steps) {
  await page.evaluate((css) => {
    let s = document.getElementById('__ablate');
    if (!s) { s = document.createElement('style'); s.id = '__ablate'; document.head.appendChild(s); }
    s.textContent = css;
  }, css);
  await sleep(500);
  const p = `${OUT}/ablate-step.png`;
  await page.screenshot({ path: p });
  const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true });
  const { width: w, channels: ch } = info;
  res[name] = {};
  for (const k in patches) {
    const [x0, y0, ww, hh] = patches[k];
    let n = 0, s = 0, ss = 0;
    for (let y = y0; y < y0 + hh; y++) for (let x = x0; x < x0 + ww; x++) {
      const i = (y * w + x) * ch; const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      n++; s += l; ss += l * l;
    }
    const m = s / n; res[name][k] = { mean: +m.toFixed(1), sd: +Math.sqrt(Math.max(0, ss / n - m * m)).toFixed(1) };
  }
}
// 参照：卡外纯条纹
const ref = await (async () => {
  const { data, info } = await sharp(`${OUT}/ablate-step.png`).raw().toBuffer({ resolveWithObject: true });
  const { width: w, channels: ch } = info; let n = 0, s = 0, ss = 0;
  for (let y = 300; y < 340; y++) for (let x = 700; x < 760; x++) { const i = (y * w + x) * ch; const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n++; s += l; ss += l * l; }
  const m = s / n; return { mean: +m.toFixed(1), sd: +Math.sqrt(Math.max(0, ss / n - m * m)).toFixed(1) };
})();
console.log(JSON.stringify({ patternOutsideCard: ref, steps: res }, null, 1));
await browser.close();
