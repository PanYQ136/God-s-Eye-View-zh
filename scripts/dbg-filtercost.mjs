#!/usr/bin/env node
/**
 * dbg-filtercost.mjs —— 拆开 SVG 滤镜的成本来源（同一环境，9 卡 warp 上换不同 filter）
 *  V0 none
 *  V1 只 feGaussianBlur(SourceGraphic)          —— SVG 滤镜套在 backdrop 元素上的基础成本
 *  V2 现用 #gev-lg-filter（feImage + data: URI 位移图）
 *  V3 同上但 feImage 指向 <image id>（避免每帧解码 data URI）
 *  V4 现用滤镜但把滤镜区域从 170% 收紧到 100%
 */
import puppeteer from 'puppeteer';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,820'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 1 });
await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9500); await page.keyboard.press('Escape'); await sleep(1500);

// 造变体滤镜
await page.evaluate(() => {
  const svg = document.getElementById('gev-lg-svg');
  const defs = svg.querySelector('defs');
  const base = document.getElementById('gev-lg-filter');
  const href = base.querySelector('feImage').getAttribute('href');
  // V1：只模糊
  const f1 = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  f1.setAttribute('id', 'x-blur'); f1.setAttribute('x', '-10%'); f1.setAttribute('y', '-10%'); f1.setAttribute('width', '120%'); f1.setAttribute('height', '120%');
  f1.innerHTML = '<feGaussianBlur in="SourceGraphic" stdDeviation="0.5"/>';
  defs.appendChild(f1);
  // V3：feImage 引用 <image>
  const img = document.createElementNS('http://www.w3.org/2000/svg', 'image');
  img.setAttribute('id', 'x-dispimg'); img.setAttribute('href', href); img.setAttribute('width', '256'); img.setAttribute('height', '256');
  img.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  defs.appendChild(img);
  const f3 = base.cloneNode(true); f3.setAttribute('id', 'x-ref');
  const f3img = f3.querySelector('feImage');
  f3img.setAttribute('href', '#x-dispimg'); f3img.removeAttribute('width'); f3img.removeAttribute('height');
  defs.appendChild(f3);
  // V4：收紧滤镜区域
  const f4 = base.cloneNode(true); f4.setAttribute('id', 'x-tight');
  f4.setAttribute('x', '0%'); f4.setAttribute('y', '0%'); f4.setAttribute('width', '100%'); f4.setAttribute('height', '100%');
  defs.appendChild(f4);
});

const bench = async (label, filter) => {
  await page.evaluate((f) => document.querySelectorAll('.gev-lg-warp').forEach((w) => { w.style.filter = f; }), filter);
  await sleep(900);
  const r = await page.evaluate(async () => {
    const t = [];
    for (let i = 0; i < 50; i++) { const a = performance.now(); await new Promise((r2) => requestAnimationFrame(r2)); t.push(performance.now() - a); }
    t.sort((x, y) => x - y);
    return { median: +t[Math.floor(t.length / 2)].toFixed(1), p95: +t[Math.floor(t.length * 0.95)].toFixed(1) };
  });
  console.log(label.padEnd(46), JSON.stringify(r));
  return { label, ...r };
};
const out = [];
out.push(await bench('V0 none', 'none'));
out.push(await bench('V1 只 feGaussianBlur 0.5', 'url(#x-blur)'));
out.push(await bench('V2 现用 feImage(data: URI) 全滤镜', 'url(#gev-lg-filter)'));
out.push(await bench('V3 feImage → <image id> 引用', 'url(#x-ref)'));
out.push(await bench('V4 滤镜区域收紧到 100%', 'url(#x-tight)'));
out.push(await bench('V5 none（复测，排除漂移）', 'none'));
console.log(JSON.stringify(out));
await browser.close();
