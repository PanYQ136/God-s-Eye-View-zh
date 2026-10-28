#!/usr/bin/env node
/* review-lg-probe28.mjs —— 第五轮复核 · Contract lens 续（真实指针展开，因为展开挂在 pointerup 上）
   1) 真实展开：page.mouse down/up 空白区 → 采样每帧 dt / 卡壳矩形 / __gevGlassAnim → 实测时长 350–450ms
   2) 兄弟卡 morph：scene-panel display/h/height（非 display:none）
   3) 展开态透镜带：gain .9 vs 0 差分剖面（阈值 3/255），anim=0 vs anim=1（uAnim=1 → 带变宽）
   4) 展开态指针 specular：两个指针位置差图（同帧、同场景冻结）
   5) prefers-reduced-motion：真实展开是否瞬时（≤2 帧）且材质保留
*/
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import fs from 'node:fs';

const URL = process.argv[2] || 'http://127.0.0.1:4173/';
const OUT = 'C:/Users/13680/AppData/Local/hermes/profiles/deepseek/cache/scratch/review-lg/r5';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--enable-gpu', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--window-size=1536,730'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1536, height: 730, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !!document.getElementById('data-panel'), { timeout: 120000 });
await sleep(13000);
await page.keyboard.press('Escape').catch(() => {});
await page.evaluate(() => { const x = [...document.querySelectorAll('div,button,a')].find((e) => /自由探索/.test(e.textContent || '') && e.offsetParent); if (x) x.click(); });
await sleep(2500);
const out = { probe: 'review-lg-probe28', url: URL };

const startSampler = () => page.evaluate(() => {
  const el = document.getElementById('data-panel');
  const sib = document.getElementById('scene-panel');
  window.__S = { s: [] };
  const t0 = performance.now();
  let prev = t0;
  const tick = (t) => {
    const r = el.getBoundingClientRect();
    const sr = sib ? sib.getBoundingClientRect() : null;
    window.__S.s.push([+(t - t0).toFixed(1), +(t - prev).toFixed(2), +r.height.toFixed(1), +r.width.toFixed(1), +r.left.toFixed(1), +r.top.toFixed(1), window.__gevGlassAnim ? 1 : 0, sr ? +sr.height.toFixed(1) : null, sib ? (getComputedStyle(sib).display) : null]);
    prev = t;
    if (t - t0 < 1300) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const rectOf = (sel) => page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }, sel);

/* 1 + 2) 真实展开 */
const r0 = await rectOf('#data-panel');
await startSampler();
await page.mouse.move(r0.l + 18, r0.t + 20);
await page.mouse.down();
await sleep(60);
await page.mouse.up();
await sleep(1400);
const S = await page.evaluate(() => window.__S.s);
const dts = S.map((x) => x[1]).filter((d) => d > 0).sort((a, b) => a - b);
const q = (A, p) => A[Math.min(A.length - 1, Math.max(0, Math.floor(p * (A.length - 1))))];
const heights = S.map((x) => x[2]);
const hEnd = Math.max(...heights);
const firstChange = S.find((x) => Math.abs(x[2] - heights[0]) > 0.6);
const settled = S.find((x) => Math.abs(x[2] - hEnd) < 0.6 && x[0] > (firstChange ? firstChange[0] : 0));
out.expand = {
  from: { ...r0 }, hEnd: +hEnd.toFixed(1), wEnd: S[S.length - 1][3],
  startMs: firstChange ? firstChange[0] : null,
  settleMs: settled ? settled[0] : null,
  animFrames: S.filter((x) => x[6] === 1).length,
  frameMs: { p50: +q(dts, 0.5).toFixed(2), p95: +q(dts, 0.95).toFixed(2), max: +Math.max(...dts).toFixed(2), fpsP50: +(1000 / q(dts, 0.5)).toFixed(1) },
  siblingScene: { h: S[S.length - 1][7], display: S[S.length - 1][8] },
  siblingStateEnd: await page.evaluate(() => { const s = document.getElementById('scene-panel'); const cs = getComputedStyle(s); return { collapsed: s.classList.contains('collapsed'), display: cs.display, visibility: cs.visibility, opacity: cs.opacity, h: Math.round(s.getBoundingClientRect().height) }; }),
  dataPanelEnd: await page.evaluate(() => { const s = document.getElementById('data-panel'); const cs = getComputedStyle(s); return { floating: s.classList.contains('gev-lc-floating'), collapsed: s.classList.contains('collapsed'), display: cs.display, opacity: cs.opacity, rect: (() => { const r = s.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; })() }; }),
  sample: S.filter((_, i) => i % 3 === 0).slice(0, 22),
};

/* 3) 展开态透镜带（anim0 / anim1） */
const rd = await rectOf('#data-panel');
const band = async (animOn) => {
  if (animOn) await page.evaluate(() => { window.__gevGlassAnim = { t0: performance.now() - 50000, dur: 100000 }; });
  else await page.evaluate(() => { window.__gevGlassAnim = null; });
  await sleep(350);
  const clip = { x: rd.l - 6, y: rd.t + 40, width: 44, height: 90 };
  const shot = async (gain) => { await page.evaluate((g) => window.__gevGlSet({ gain: g }), gain); await sleep(420); const buf = await page.screenshot({ clip }); return sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true }); };
  const A = await shot(0.9), B = await shot(0);
  const cols = A.info.width, rows = A.info.height;
  const prof = [];
  for (let c = 0; c < cols; c++) { let s = 0; for (let r = 0; r < rows; r++) { const i = (r * cols + c) * A.info.channels; for (let k = 0; k < 3; k++) s += Math.abs(A.data[i + k] - B.data[i + k]); } prof.push(+(s / (rows * 3)).toFixed(1)); }
  const px = cols / 44;                       // 设备像素 / CSS px
  const start = Math.round(6 * px);
  let last = -1;
  for (let c = start; c < cols; c++) if (prof[c] > 3) last = c;
  const bandCss = last < 0 ? 0 : +((last - start) / px).toFixed(1);
  // 衰减到 1/2 峰值的宽度
  const peak = Math.max(...prof.slice(start));
  let half = -1; for (let c = start; c < cols; c++) if (prof[c] >= peak / 2) half = c;
  await page.evaluate(() => window.__gevGlSet({ gain: 0.9 }));
  await page.evaluate(() => { window.__gevGlassAnim = null; });
  return { bandCss, halfWidthCss: half < 0 ? 0 : +((half - start) / px).toFixed(1), peak, prof: prof.slice(start, start + 34) };
};
out.bandAnim0 = await band(false);
out.bandAnim1 = await band(true);
await page.evaluate(() => { window.__gevGlassAnim = null; });

/* 4) 指针 specular：两个位置差图（同场景冻结） */
await page.evaluate(() => { try { window.__gevViewer.useDefaultRenderLoop = false; } catch (e) {} });
await sleep(800);
const clipE = { x: rd.l - 3, y: rd.t + 20, width: 16, height: Math.min(300, rd.h - 40) };
const shotRaw = async (x, y) => { await page.mouse.move(x, y); await sleep(500); return sharp(await page.screenshot({ clip: clipE })).removeAlpha().raw().toBuffer({ resolveWithObject: true }); };
const P1 = await shotRaw(rd.l + 2, rd.t + 40);
const P2 = await shotRaw(rd.l + 2, rd.t + Math.min(rd.h - 30, 260));
let maxD = 0, sumD = 0, n = 0, rowsDiff = [];
for (let r = 0; r < P1.info.height; r++) {
  let rs = 0;
  for (let c = 0; c < P1.info.width; c++) {
    const i = (r * P1.info.width + c) * P1.info.channels;
    const d = (Math.abs(P1.data[i] - P2.data[i]) + Math.abs(P1.data[i + 1] - P2.data[i + 1]) + Math.abs(P1.data[i + 2] - P2.data[i + 2])) / 3;
    rs = Math.max(rs, d); maxD = Math.max(maxD, d); sumD += d; n++;
  }
  rowsDiff.push(+rs.toFixed(1));
}
out.specular = { maxPixelDiff: +maxD.toFixed(1), meanPixelDiff: +(sumD / n).toFixed(2), rowsDiffSample: rowsDiff.filter((_, i) => i % 8 === 0).slice(0, 20), note: '两个指针位置（y=40 / y=260）同区域差图；非零即 specular 跟随指针' };

/* 5) reduced-motion 真实展开 */
const cdp = await page.createCDPSession();
const collapseNow = async () => { await page.evaluate(() => { const el = document.getElementById('data-panel'); if (el.classList.contains('gev-lc-floating')) { const ev = new PointerEvent('pointerup', { bubbles: true, clientX: 300, clientY: 300 }); el.dispatchEvent(ev); } }); };
// 用真实鼠标先收起（点卡片空白）
await page.mouse.move(rd.l + 18, rd.t + 20); await page.mouse.down(); await sleep(60); await page.mouse.up();
await sleep(900);
const r1 = await rectOf('#data-panel');
await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await sleep(500);
await page.evaluate(() => {
  const el = document.getElementById('data-panel');
  window.__R = { t0: performance.now(), s: [] };
  const tick = (t) => { const r = el.getBoundingClientRect(); window.__R.s.push([+(t - window.__R.t0).toFixed(1), +r.height.toFixed(1), window.__gevGlassAnim ? 1 : 0]); if (t - window.__R.t0 < 600) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
await page.mouse.move(r1.l + 18, r1.t + 20); await page.mouse.down(); await sleep(50); await page.mouse.up();
await sleep(700);
const R = await page.evaluate(() => window.__R.s);
const rH = R.map((x) => x[1]);
out.reducedMotion = {
  hFrom: rH[0], hMax: Math.max(...rH), animSignalFrames: R.filter((x) => x[2] === 1).length,
  framesToReachMax: R.find((x) => Math.abs(x[1] - Math.max(...rH)) < 0.6)?.[0] ?? null,
  glassDisplay: await page.evaluate(() => { const g = document.getElementById('gev-gl-glass'); return g ? getComputedStyle(g).display : null; }),
  surfaces: await page.evaluate(() => window.__gevGlStats().count),
  sample: R.slice(0, 12),
};
await cdp.send('Emulation.setEmulatedMedia', { features: [] });

out.consoleErrors = errs;
await page.screenshot({ path: `${OUT}/p28-expanded.png` });
fs.writeFileSync(`${OUT}/probe28.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
