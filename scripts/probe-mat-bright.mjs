import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = 'evidence/_collab/t_fdd76e7a/probe';
fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,820', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => {
  try { localStorage.removeItem('gev-liquid-cards:v2'); localStorage.setItem('gev:first-run-mission:v1', 'suppressed'); localStorage.setItem('gev.perfMode', '0'); localStorage.setItem('gev.gfx', JSON.stringify({ res: 0.75, fxaa: false, sharpen: 40, msaa: 0, pdb: false, tileMSE: 4, fps: 60, gpuPref: 'default' })); } catch (e) {}
});
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !!window.__gevLc, { timeout: 180000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(2000);
await page.evaluate(() => { const C = window.__CESIUM__ || window.Cesium; window.__gevViewer.camera.setView({ destination: C.Cartesian3.fromDegrees(-67.5, -20.13, 12000), orientation: { heading: 0, pitch: -Math.PI / 2, roll: 0 } }); });
await sleep(16000);
await page.evaluate(() => { window.__gevViewer.useDefaultRenderLoop = false; });
await sleep(1500);
const r = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; });
const px = async (tag) => {
  const buf = await page.screenshot({ clip: { x: r[0], y: r[1], width: r[2], height: r[3] } });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (fx, fy) => { const x = Math.floor(info.width * fx), y = Math.floor(info.height * fy); const i = (y * info.width + x) * info.channels; return [data[i], data[i + 1], data[i + 2]]; };
  const samples = { center: at(0.4, 0.5), leftEdge: at(0.06, 0.5), rightEdge: at(0.94, 0.5), topEdge: at(0.4, 0.15), mapLeft: null };
  const mbuf = await page.screenshot({ clip: { x: Math.max(0, r[0] - 60), y: r[1], width: 50, height: r[3] } });
  const m = await sharp(mbuf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const mi = (Math.floor(m.info.height / 2) * m.info.width + Math.floor(m.info.width / 2)) * m.info.channels;
  samples.mapLeft = [m.data[mi], m.data[mi + 1], m.data[mi + 2]];
  fs.writeFileSync(`${OUT}/${tag}.png`, buf);
  return samples;
};
const base = await px('bright-card-base');
const withRed = await px('bright-card-red');
/* 现在把卡壳背景改成纯红，看背景层是否真的可见 */
await page.evaluate(() => {
  const s = document.createElement('style');
  s.id = 'probe-red';
  s.textContent = '.gev-lc{background:rgba(255,0,0,.52)!important;background-image:none!important;}';
  document.head.appendChild(s);
});
await sleep(400);
const red = await px('bright-card-red2');
/* 再把 warp 关掉 */
await page.evaluate(() => {
  const s = document.createElement('style');
  s.textContent = '.gev-lg-warp{display:none!important}';
  document.head.appendChild(s);
});
await sleep(400);
const redNoWarp = await px('bright-card-red3');
console.log(JSON.stringify({ rect: r, base, withRed, red, redNoWarp, lum: await page.evaluate(() => document.documentElement.dataset.gevGlassLum), errors: errs.slice(0, 4) }, null, 1));
await browser.close();
