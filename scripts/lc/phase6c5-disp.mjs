#!/usr/bin/env node
/* Phase6C5 — 玻璃色散最终打磨：真实地图纹理上的 dispPx A/B（1x/4x/8x 截图 + 边缘通道量化）
   用法: node scripts/lc/phase6c5-disp.mjs [tag]
   产物: .gev-logs/lc/phase6c5/c5-<tag>-dp<X>-1x.png
         .gev-logs/lc/phase6c5/c5-<tag>-dp<X>-edge4x.png / -edge8x.png / -corner8x.png
         .gev-logs/lc/phase6c5/c5-<tag>.json

   口径（AGENTS.md / C5 卡）：
   - 真实地图纹理、**不冻结 Cesium**（不再改 useDefaultRenderLoop）；
   - 只改 dispPx 一个变量，其余（gain 1.0 / band 10 / ior 1.52 / thick 6 / bandAlpha .55）不动；
   - 指针停在卡外（非 hover），每档先等 700ms 让透镜重画；
   - 通道间距 = 0.4 × dispPx（CSS px）：dp2.0→0.80 / dp2.4→0.96 / dp2.8→1.12。
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] || 'a';
const W = 1348, VH = 774;
const OUT = '.gev-logs/lc/phase6c5';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DPS = [1.0, 2.0, 2.4, 2.8];

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${VH + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: VH, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 160)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready
    && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
await sleep(6000);
const cdp = await page.createCDPSession();
const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
console.log('GPU', JSON.stringify(gpu));

const shot1x = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const clickHeader = async (id) => {
  const p = await page.evaluate((id) => {
    const el = document.getElementById(id);
    const t = el.querySelector('.panel-header,.pp-header-row') || el;
    const b = t.getBoundingClientRect();
    return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
  }, id);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await sleep(80); await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1000);
};
const parkPtr = async () => { await page.mouse.move(4, 700, { steps: 3 }); await sleep(400); };

/* 打开卡：data(左, 默认 open) / pp-toggles(右) —— scene 与 data 互斥，单独再开一次 */
await parkPtr();
await clickHeader('data-panel');
await parkPtr();
await clickHeader('pp-toggles');
await parkPtr();
const phase = await page.evaluate(() => ({
  data: document.getElementById('data-panel').dataset.lcPhase,
  pp: document.getElementById('pp-toggles').dataset.lcPhase,
  scene: document.getElementById('scene-panel').dataset.lcPhase,
}));
console.log('PHASE', JSON.stringify(phase));

const rectOf = (id) => page.evaluate((id) => {
  const b = document.getElementById(id).getBoundingClientRect();
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
}, id);

/* 页内裁切 + 放大（避免 CDP clip 的 Chrome 155 参数错误） */
await page.evaluate(() => {
  window.__c5crop = async (b64, rectCss, scale) => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob);
    const K = bmp.width / innerWidth;
    const sx = Math.round(rectCss.x * K), sy = Math.round(rectCss.y * K);
    const sw = Math.round(rectCss.w * K), sh = Math.round(rectCss.h * K);
    const cv = document.createElement('canvas');
    cv.width = Math.round(sw * scale); cv.height = Math.round(sh * scale);
    const cx = cv.getContext('2d');
    cx.imageSmoothingEnabled = false;
    cx.drawImage(bmp, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    return cv.toDataURL('image/png');
  };
  /* 真实地图纹理上的边缘通道量化：沿四条边向内 0..12 CSS px 的 |R−B| 与有符号 R−B 剖面。
     色散（R/B 采样沿法线错开）在有梯度处产生 R−B 偏移，幅度 ∝ 通道间距 × 局部梯度。 */
  window.__c5edge = async (b64, rectCss) => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    const img = cx.getImageData(0, 0, bmp.width, bmp.height);
    const K = bmp.width / innerWidth;
    const d = img.data, w = img.width, h = img.height;
    const r = { x: rectCss.x * K, y: rectCss.y * K, w: rectCss.w * K, h: rectCss.h * K };
    const side = (edge, axis, dir, nMerge) => {
      const prof = [], sprof = [], amp = [];
      for (let k = 0; k <= 12; k++) {
        const a = Math.round(edge + k * dir);
        let ab = 0, sb = 0, n = 0, mx = 0, lumSum = 0;
        const lo = axis === 'y' ? Math.round(r.x + r.w * 0.30) : Math.round(r.y + r.h * 0.30);
        const hi = axis === 'y' ? Math.round(r.x + r.w * 0.70) : Math.round(r.y + r.h * 0.70);
        for (let t = 0; t < nMerge; t++) {
          const line = a + t * dir;
          for (let u = lo; u < hi; u++) {
            const i = axis === 'y' ? (line * w + u) * 4 : (u * w + line) * 4;
            if (i < 0 || i + 3 >= d.length) continue;
            const rb = d[i] - d[i + 2];
            ab += Math.abs(rb); sb += rb; lumSum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            if (Math.abs(rb) > mx) mx = Math.abs(rb);
            n++;
          }
        }
        prof.push(n ? +(ab / n).toFixed(2) : 0);
        sprof.push(n ? +(sb / n).toFixed(2) : 0);
        amp.push(mx);
      }
      return { absRB: prof, sigRB: sprof, maxRB: amp, lum: 'x' };
    };
    return {
      K,
      top: side(r.y, 'y', 1, 2),
      left: side(r.x, 'x', 1, 2),
      bot: side(r.y + r.h, 'y', -1, 2),
      right: side(r.x + r.w, 'x', -1, 2),
    };
  };
});

const rData = await rectOf('data-panel');
const rPp = await rectOf('pp-toggles');
console.log('RECT data', JSON.stringify(rData), 'pp', JSON.stringify(rPp));

/* 边缘/角部取样框（CSS px）：上沿中段 220×14，左上角 40×40 */
const boxTop = { x: rData.x + Math.round(rData.w * 0.35), y: rData.y - 2, w: 220, h: 16 };
const boxCorner = { x: rData.x - 4, y: rData.y - 4, w: 44, h: 44 };
const boxLeft = { x: rData.x - 2, y: rData.y + Math.round(rData.h * 0.40), w: 16, h: 200 };

const result = { tag: TAG, gpu, phase, rects: { data: rData, pp: rPp }, samples: {}, errs: [] };
const fpsSample = () => page.evaluate(async () => {
  const ts = []; const t0 = performance.now();
  await new Promise((res) => {
    const tick = () => { ts.push(performance.now()); if (performance.now() - t0 < 6000) requestAnimationFrame(tick); else res(); };
    requestAnimationFrame(tick);
  });
  const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
  const pct = (p) => d[Math.min(d.length - 1, Math.floor(d.length * p))];
  return { fps: +(1000 / (d.reduce((a, b) => a + b, 0) / d.length)).toFixed(1), p50: +pct(0.5).toFixed(1), p95: +pct(0.95).toFixed(1), max: +d[d.length - 1].toFixed(1), n: d.length };
});

for (const dp of DPS) {
  await page.evaluate((dp) => window.__gevEdge.set({ dispPx: dp }), dp);
  await parkPtr();
  await sleep(900);
  const b64 = await shot1x();
  const f = `${OUT}/c5-${TAG}-dp${String(dp).replace('.', 'p')}`;
  writeFileSync(`${f}-1x.png`, Buffer.from(b64, 'base64'));
  const crop = async (box, s, name) => {
    const u = await page.evaluate((b64, box, s) => window.__c5crop(b64, box, s), b64, box, s);
    writeFileSync(`${f}-${name}.png`, Buffer.from(String(u).split(',')[1], 'base64'));
  };
  await crop(boxTop, 8, 'top8x');
  await crop(boxCorner, 8, 'corner8x');
  await crop(boxLeft, 8, 'left8x');
  await crop(boxTop, 4, 'top4x');
  await crop(boxCorner, 4, 'corner4x');
  const m = await page.evaluate((b64, r) => window.__c5edge(b64, r), b64, rData);
  const pp = await page.evaluate(async (b64, r) => {
    const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
    const K = bmp.width / innerWidth;
    const x0 = Math.round(r.x * K), x1 = Math.round((r.x + r.w) * K), y0 = Math.round((r.y + r.h * 0.45) * K);
    let s = 0, n = 0, mx = 0;
    for (let t = 0; t < 3; t++) for (let x = x0; x < x1; x++) {
      const i = ((y0 + t) * bmp.width + x) * 4; const rb = Math.abs(d[i] - d[i + 2]);
      s += rb; if (rb > mx) mx = rb; n++;
    }
    return { centerRBmean: +(s / n).toFixed(2), centerRBmax: mx, K };
  }, b64, rData);
  result.samples['dp' + dp] = { rect: rData, edge: m, center: pp };
  console.log(`dp${dp}`, 'K=' + m.K,
    'top(|RB| k0..6)', m.top.absRB.slice(0, 7).join(','),
    'left', m.left.absRB.slice(0, 7).join(','),
    'center', JSON.stringify(pp).slice(0, 90));
}
/* 用最后一档（dp2.8）测 fps，再切回 1.0 复测一次（确认 A/B 无帧率代价） */
const fps28 = await fpsSample();
await page.evaluate(() => window.__gevEdge.set({ dispPx: 1.0 }));
await parkPtr();
await sleep(700);
const fps10 = await fpsSample();
result.fps = { dp2_8: fps28, dp1_0: fps10 };
result.errs = errs.filter((e) => !/Failed to load resource|favicon/i.test(e)).slice(0, 6);
writeFileSync(`${OUT}/c5-${TAG}.json`, JSON.stringify(result, null, 2));
console.log('FPS', JSON.stringify(result.fps), 'errs', result.errs.length);
await browser.close();
