#!/usr/bin/env node
/**
 * probe-mask.mjs —— 验证「mask 能否裁掉 backdrop-filter 的模糊」
 * 做法：把 Cesium 画布藏起来，垫一层 8px 黑白条纹 CSS 底（纯 R=G=B），
 * 然后量卡片边缘带（0–12px）的条纹对比度（std）：条纹清晰 = 没被模糊。
 *   A 基线：warp 无 mask（backdrop blur6 覆盖全卡）
 *   B mask：warp 加 15px 羽化 mask（看模糊是否被裁掉）
 *   C inset：warp inset:15px
 *   D 关闭 warp：无模糊的真值
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const URL = process.argv[2] || 'http://localhost:4173/';
const W = 1536, H = 730;
const OUT = 'evidence/_collab/t_9739e3a7';
fs.mkdirSync(OUT, { recursive: true });

// 8px 周期黑白竖条（R=G=B）+ 64 周期横向线
const SW = 64, SH = 64, buf = Buffer.alloc(SW * SH * 3);
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
  const v = Math.floor(x / 8) % 2 ? 240 : 16;
  const i = (y * SW + x) * 3; buf[i] = v; buf[i + 1] = v; buf[i + 2] = v;
}
const b64 = 'data:image/png;base64,' + (await sharp(buf, { raw: { width: SW, height: SH, channels: 3 } }).png().toBuffer()).toString('base64');

const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--window-position=1900,40', '--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--window-size=1536,820'],
  protocolTimeout: 300000,
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => document.getElementById('data-panel') && window.__gevLc, { timeout: 120000 });
await sleep(9000);
await page.keyboard.press('Escape');
await sleep(1200);

// 展开 data-panel 拿大卡
await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: r.left + 20, clientY: r.top + 20 }));
  el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: r.left + 20, clientY: r.top + 20 }));
});
await sleep(1200);

// 条纹底 + 隐藏 Cesium
await page.evaluate((b64) => {
  const st = document.createElement('style'); st.id = '__probe';
  st.textContent = `.cesium-widget, .cesium-widget canvas { visibility: hidden !important; }
    #__probe_bg{position:fixed;inset:0;z-index:0;background-image:url(${b64});background-repeat:repeat}
    .gev-lc, .gev-lc * { color: transparent !important; text-shadow: none !important; }
    .gev-lc img, .gev-lc svg, .gev-lc video, .gev-lc input, .gev-lc .material-symbols-outlined { visibility: hidden !important; }`;
  document.head.appendChild(st);
  const d = document.createElement('div'); d.id = '__probe_bg'; document.body.appendChild(d);
  const ov = document.querySelector('#welcome-overlay, .welcome-overlay'); if (ov) ov.style.display = 'none';
}, b64);
await sleep(600);

const steps = [
  ['A_nomask', ''],
  ['B_mask', '.gev-lg-warp{-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 15px,#000 calc(100% - 15px),transparent 100%),linear-gradient(180deg,transparent 0,#000 15px,#000 calc(100% - 15px),transparent 100%) !important;-webkit-mask-composite:source-in !important;mask-image:linear-gradient(90deg,transparent 0,#000 15px,#000 calc(100% - 15px),transparent 100%),linear-gradient(180deg,transparent 0,#000 15px,#000 calc(100% - 15px),transparent 100%) !important;mask-composite:intersect !important}'],
  ['C_inset', '.gev-lg-warp{inset:15px !important;border-radius:4px !important}'],
  ['D_nowarp', '.gev-lg-warp{display:none !important}'],
];
const rect = await page.evaluate(() => { const r = document.getElementById('data-panel').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const res = {};
for (const [name, css] of steps) {
  await page.evaluate((css) => {
    let s = document.getElementById('__step');
    if (!s) { s = document.createElement('style'); s.id = '__step'; document.head.appendChild(s); }
    s.textContent = css;
  }, css);
  await sleep(500);
  const p = `${OUT}/probe-mask-${name}.png`;
  await page.screenshot({ path: p });
  const { data, info } = await sharp(p).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels, iw = info.width;
  // 三条带：边缘 0-6px、6-12px、中心 40..(w-40)
  const bands = { edge0_6: [0, 6], band6_12: [6, 12], inner20_30: [20, 30], center: [40, -40] };
  const stat = (x0, x1, y0, y1) => {
    let n = 0, s = 0, ss = 0;
    for (let y = Math.round(rect.y + y0); y < Math.round(rect.y + y1); y++)
      for (let x = Math.round(rect.x + x0); x < Math.round(rect.x + x1); x++) {
        const i = (y * iw + x) * ch; const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        n++; s += l; ss += l * l;
      }
    const m = s / n; return { mean: +m.toFixed(1), sd: +Math.sqrt(Math.max(0, ss / n - m * m)).toFixed(1) };
  };
  res[name] = {
    left_edge0_6: stat(1, 6, 60, 300),
    left_6_12: stat(7, 12, 60, 300),
    left_20_30: stat(21, 30, 60, 300),
    top_edge0_6: stat(60, 280, 1, 6),
    center: stat(rect.w / 2 - 40, rect.w / 2 + 40, 150, 250),
  };
}
res.__rect = rect;
// 底图真值（卡外 100px 处条纹）
{
  const { data, info } = await sharp(`${OUT}/probe-mask-D_nowarp.png`).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels, iw = info.width; let n = 0, s = 0, ss = 0;
  for (let y = 400; y < 460; y++) for (let x = 700; x < 760; x++) { const i = (y * iw + x) * ch; const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]; n++; s += l; ss += l * l; }
  const m = s / n; res.__patternOutside = { mean: +m.toFixed(1), sd: +Math.sqrt(Math.max(0, ss / n - m * m)).toFixed(1) };
}
// 计算样式回读：确认 mask 是否真被浏览器接受
res.__computed = await page.evaluate(() => {
  const w = document.querySelector('#data-panel .gev-lg-warp');
  const cs = getComputedStyle(w);
  return {
    maskImage: (cs.maskImage || cs.webkitMaskImage || '').slice(0, 120),
    maskComposite: cs.maskComposite || cs.webkitMaskComposite || '',
    inset: cs.inset, webkitBackdropFilter: cs.webkitBackdropFilter || cs.backdropFilter,
  };
});
fs.writeFileSync(`${OUT}/probe-mask.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
await browser.close();
