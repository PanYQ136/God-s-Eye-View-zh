#!/usr/bin/env node
/**
 * qa-gev-edge-perf.mjs
 *  A) 边缘扫描线：冻结条纹底图下，跨 data-panel 左边框打印 RGB（filter on / pattern-only），
 *     并导出 10x 放大裁剪图 —— 直接看 R/G/B 是否错位（色散）。
 *  B) 性能 A/B：同一环境测 4 种状态的平均帧时长（rAF）：
 *     0 = 直接关掉 liquid-cards.css（App 原生）
 *     1 = CSS 开、warp 隐藏（只剩 0.52 卡壳）
 *     2 = warp 只 backdrop blur（filter:none）
 *     3 = warp blur + SVG 位移滤镜（当前实现）
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
const OUT = 'evidence/_collab/t_8cf06356';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1536, H = 730;

const SW = 64, SH = 64, pbuf = Buffer.alloc(SW * SH * 3);
const cols = [[235, 55, 55], [55, 225, 90], [70, 95, 240], [245, 245, 245]];
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
  const c = cols[Math.floor(x / 16) % 4], k = y % 16 === 0 ? 0.45 : 1, i = (y * SW + x) * 3;
  pbuf[i] = c[0] * k; pbuf[i + 1] = c[1] * k; pbuf[i + 2] = c[2] * k;
}
const patB64 = 'data:image/png;base64,' + (await sharp(pbuf, { raw: { width: SW, height: SH, channels: 3 } }).png().toBuffer()).toString('base64');

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', `--window-size=${W},${H + 90}`],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9500);
await page.keyboard.press('Escape');
await sleep(1500);

const frameStats = async (label) => {
  const r = await page.evaluate(async () => {
    const t = [];
    for (let i = 0; i < 60; i++) { const a = performance.now(); await new Promise((r2) => requestAnimationFrame(r2)); t.push(performance.now() - a); }
    t.sort((x, y) => x - y);
    return { n: t.length, median: +t[Math.floor(t.length / 2)].toFixed(1), p95: +t[Math.floor(t.length * 0.95)].toFixed(1), max: +t[t.length - 1].toFixed(1) };
  });
  return { label, ...r };
};
const perf = [];
perf.push(await frameStats('3) 当前实现：blur6 + SVG 位移滤镜'));

await page.evaluate(() => document.querySelectorAll('.gev-lg-warp').forEach((w) => { w.style.filter = 'none'; }));
await sleep(600);
perf.push(await frameStats('2) 只留 backdrop blur6（无 SVG 滤镜）'));

await page.evaluate(() => { const s = document.createElement('style'); s.id = '__ab'; s.textContent = '.gev-lg-warp{display:none!important}'; document.head.appendChild(s); });
await sleep(600);
perf.push(await frameStats('1) warp 隐藏（只剩 0.52 卡壳）'));

await page.evaluate(() => {
  [...document.styleSheets].forEach((s) => { try { if ((s.href || '').includes('gev-liquid-cards')) s.disabled = true; } catch (e) {} });
});
await sleep(800);
perf.push(await frameStats('0) 关掉 gev-liquid-cards.css（App 原生内层 0.72+blur18）'));

// 复原
await page.evaluate(() => {
  [...document.styleSheets].forEach((s) => { try { if ((s.href || '').includes('gev-liquid-cards')) s.disabled = false; } catch (e) {} });
  const s = document.getElementById('__ab'); if (s) s.remove();
  document.querySelectorAll('.gev-lg-warp').forEach((w) => { w.style.filter = 'url(#gev-lg-filter)'; });
});
await sleep(900);

/* ── A) 边缘扫描线 + 放大图（冻结条纹底图 + data-panel 展开） ───────── */
await page.evaluate((b64) => {
  const st = document.createElement('style'); st.id = '__freeze';
  st.textContent = `.cesium-widget,.cesium-widget canvas{visibility:hidden!important}
    .cesium-widget-credits,.cesium-viewer-bottom{display:none!important}video{visibility:hidden!important}
    #__probe_bg{position:fixed;inset:0;z-index:0;background-image:url(${b64});background-repeat:repeat}`;
  document.head.appendChild(st);
  const d = document.createElement('div'); d.id = '__probe_bg'; document.body.appendChild(d);
}, patB64);
await page.evaluate(() => window.__gevLc.open('data-panel'));
await sleep(1000);
const box = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; });
const scanY = box.y + 200;
const scan = { y: scanY, filterOn: [], filterOff: [], patternOnly: [] };
const clip = { x: box.x - 10, y: scanY - 1, width: 20, height: 3 };
const readRow = async (p) => {
  const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true });
  const { width: w, channels: ch } = info; const row = [];
  const yy = Math.floor(info.height / 2);
  for (let x = 0; x < w; x++) { const i = (yy * w + x) * ch; row.push([data[i], data[i + 1], data[i + 2]]); }
  return row;
};
const pOn = path.join(OUT, 'edge-scan-on.png');
const bufOn = await page.screenshot({ clip }); fs.writeFileSync(pOn, bufOn);
scan.filterOn = await readRow(pOn);
await sharp(bufOn).resize({ width: clip.width * 12, height: clip.height * 12, kernel: 'nearest' }).png().toFile(path.join(OUT, 'edge-scan-on-12x.png'));

await page.evaluate(() => document.querySelectorAll('.gev-lg-warp').forEach((w) => { w.style.filter = 'none'; }));
await sleep(600);
const pOff = path.join(OUT, 'edge-scan-off.png');
fs.writeFileSync(pOff, await page.screenshot({ clip }));
scan.filterOff = await readRow(pOff);
await page.evaluate(() => document.querySelectorAll('.gev-lg-warp').forEach((w) => { w.style.filter = 'url(#gev-lg-filter)'; }));
await sleep(600);
await page.evaluate(() => { const s = document.createElement('style'); s.id = '__mo'; s.textContent = '.gev-lc{background:transparent!important;box-shadow:none!important}.gev-lg-warp{display:none!important}.gev-lc .panel-header,.gev-lc .panel-title,.gev-lc span,.gev-lc i{visibility:hidden!important}'; document.head.appendChild(s); });
await sleep(700);
const pPat = path.join(OUT, 'edge-scan-pattern.png');
fs.writeFileSync(pPat, await page.screenshot({ clip }));
scan.patternOnly = await readRow(pPat);
await sharp(fs.readFileSync(pPat)).resize({ width: clip.width * 12, height: clip.height * 12, kernel: 'nearest' }).png().toFile(path.join(OUT, 'edge-scan-pattern-12x.png'));

fs.writeFileSync(path.join(OUT, 'edge-perf-report.json'), JSON.stringify({ perf, box, clip, scan }, null, 1));
console.log('PERF:'); perf.forEach((p) => console.log('  ' + p.label, JSON.stringify(p)));
console.log('BOX', JSON.stringify(box), 'CLIP', JSON.stringify(clip));
console.log('x from', clip.x, 'to', clip.x + clip.width - 1, '(card left border at', box.x + ')');
console.log('ON     ', JSON.stringify(scan.filterOn));
console.log('OFF    ', JSON.stringify(scan.filterOff));
console.log('PATTERN', JSON.stringify(scan.patternOnly));
await browser.close();
