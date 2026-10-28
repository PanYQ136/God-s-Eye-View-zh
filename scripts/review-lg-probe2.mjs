#!/usr/bin/env node
/**
 * review-lg-probe2.mjs —— 复核补充：玻璃分辨率自适应（是否只降不升）、色散最大可见量、rim 剖面
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg';
fs.mkdirSync(OUT, { recursive: true });
const out = { url, errors: [], timeline: [], tests: {} };

const browser = await puppeteer.launch({
  headless: true,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
page.on('pageerror', (e) => out.errors.push('pageerror: ' + String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') out.errors.push('console: ' + m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });

/* 采样：玻璃 canvas 尺寸 / scale 随时间 */
for (let i = 0; i < 22; i++) {
  const s = await page.evaluate(() => {
    const c = document.getElementById('gev-gl-glass');
    const st = window.__gevGlStats ? window.__gevGlStats() : null;
    return c ? { canvas: [c.width, c.height], css: [c.clientWidth, c.clientHeight], dpr: window.devicePixelRatio, scale: st && st.scale, fps: st && st.fps, count: st && st.count } : null;
  });
  out.timeline.push({ t: i * 1.5, s });
  await new Promise((r) => setTimeout(r, 1500));
}
out.tests.pickExpected = await page.evaluate(() => {
  const s = Math.min(window.devicePixelRatio || 1, 2);
  return { dpr: window.devicePixelRatio, naive: s, afterCap: innerWidth * s > 2200 ? 2200 / innerWidth : s };
});

/* 选一张卡：色散最大差 + rim 剖面（设备像素级） */
const card = await page.evaluate(() => {
  const st = window.__gevGlStats();
  return st.surfaces.find((s) => s.id === 'data-panel') || st.surfaces[0];
});
const DSF = 2;
const grab = async (x, y, w, h, tag) => {
  const buf = await page.screenshot({ clip: { x, y, width: w, height: h } });
  if (tag) fs.writeFileSync(path.join(OUT, tag + '.png'), buf);
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
};
const x0 = Math.max(0, Math.round(card.rect[0] - 10)), y0 = Math.round(card.rect[1] + 3);
const w = 40, h = Math.max(8, Math.round(card.rect[3] - 6));
const edge = Math.round(card.rect[0]) - x0;

const on = await grab(x0, y0, w, h, 'p2-disp-on');
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.52, etaHi: 1.52 }));
await new Promise((r) => setTimeout(r, 500));
const offD = await grab(x0, y0, w, h, 'p2-disp-off');
await page.evaluate(() => window.__gevGlSet({ etaLo: 1.48, etaHi: 1.56 }));
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.visibility = 'hidden'; });
await new Promise((r) => setTimeout(r, 400));
const raw = await grab(x0, y0, w, h, 'p2-raw');
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.visibility = ''; });
await new Promise((r) => setTimeout(r, 400));

/* 色散：设备像素级最大/均值通道差（带内 0..12 CSS px） */
const dispMax = { R: 0, G: 0, B: 0, n: 0 };
const dispMean = { R: 0, G: 0, B: 0 };
for (let cx = 0; cx < 13; cx++) {
  for (let px = 0; px < DSF; px++) {
    const sx = (edge + cx) * DSF + px; if (sx >= on.w || sx < 0) continue;
    for (let y = 0; y < h * DSF; y++) {
      const i = (y * on.w + sx) * on.ch;
      for (const [k, o] of [['R', 0], ['G', 1], ['B', 2]]) {
        const dv = Math.abs(on.data[i + o] - offD.data[i + o]);
        if (dv > dispMax[k]) dispMax[k] = dv;
        dispMean[k] += dv;
      }
      dispMax.n++;
    }
  }
}
['R', 'G', 'B'].forEach((k) => { dispMean[k] = +(dispMean[k] / Math.max(1, dispMax.n)).toFixed(3); });
out.tests.dispersion = { maxAbsPerChannel_0_255: { R: dispMax.R, G: dispMax.G, B: dispMax.B }, mean: dispMean, samples: dispMax.n };

/* rim：设备像素级亮度增量（玻璃 on - raw），从边内 0..12 CSS px */
const rim = [];
for (let cx = 0; cx < 14; cx++) {
  const vals = [];
  for (let px = 0; px < DSF; px++) {
    const sx = (edge + cx) * DSF + px; if (sx >= on.w || sx < 0) continue;
    for (let y = 0; y < h * DSF; y++) {
      const i = (y * on.w + sx) * on.ch;
      vals.push((on.data[i] + on.data[i + 1] + on.data[i + 2]) / 3 - (raw.data[i] + raw.data[i + 1] + raw.data[i + 2]) / 3);
    }
  }
  rim.push({ d: cx, mean: +(vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length)).toFixed(1), max: +Math.max(...vals).toFixed(1) });
}
out.tests.rimProfile_device = rim;

/* 玻璃开/关帧率对照（我自己的测量） */
const fps = async (ms) => page.evaluate((ms) => new Promise((done) => {
  let n = 0; const t0 = performance.now();
  const tick = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(tick); else done(+(n / ((performance.now() - t0) / 1000)).toFixed(1)); };
  requestAnimationFrame(tick);
}), ms);
out.tests.fpsIdle_glassOn = await fps(2000);
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = 'none'; });
await new Promise((r) => setTimeout(r, 500));
out.tests.fpsIdle_glassOff = await fps(2000);
await page.evaluate(() => { document.getElementById('gev-gl-glass').style.display = ''; });
await new Promise((r) => setTimeout(r, 500));
out.final = await page.evaluate(() => {
  const st = window.__gevGlStats();
  return { scale: st.scale, fps: st.fps, count: st.count };
});
fs.writeFileSync(path.join(OUT, 'review-probe2.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ timeline: out.timeline.map((x) => x.s && [x.t, x.s.canvas[0], x.s.scale, x.s.fps]), pick: out.tests.pickExpected, disp: out.tests.dispersion, rim: out.tests.rimProfile_device, fpsOn: out.tests.fpsIdle_glassOn, fpsOff: out.tests.fpsIdle_glassOff, final: out.final, errors: out.errors.slice(0, 5) }, null, 1));
await browser.close();
