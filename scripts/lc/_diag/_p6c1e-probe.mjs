#!/usr/bin/env node
/* Phase6C1 round-2 probe (READ-ONLY): settles the 5 review questions with numbers.
   1) env: devicePixelRatio vs screenshot px vs lens canvas px (the 1.25x question)
   2) non-hover vs hover @ checkerboard, four edges, on/off screen delta
   3) scale=1 vs 1.25 vs bandAlpha 1.0 (which knob eats the top peak)
   4) center pollution + shot-to-shot noise
   usage: node scripts/lc/_diag/_p6c1e-probe.mjs
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = 1348, H = 774;
const OUT = '.gev-logs/lc/phase6c1';
mkdirSync(OUT, { recursive: true });
const log = { env: {}, variants: [] };

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
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
await sleep(5000);
const cdp = await page.createCDPSession();
const shot1x = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;

const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
console.log('GPU', JSON.stringify(gpu));

// open data-panel with a real click on its header
await page.mouse.move(4, 400);
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(500);
let ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
if (ph !== 'open') {
  const p = await page.evaluate(() => {
    const el = document.getElementById('data-panel');
    const t = el.querySelector('.panel-header,.pp-header-row') || el;
    const b = t.getBoundingClientRect();
    return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
  });
  await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(80);
  await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1200);
}
// deterministic stage: hide card children, put a static 128 underlay below cards
await page.evaluate(() => {
  const s = document.createElement('style'); s.id = 'pc-blank';
  s.textContent = '#data-panel > *{visibility:hidden!important}';
  document.head.appendChild(s);
  const d = document.createElement('div'); d.id = 'pc-under';
  d.style.cssText = 'position:fixed;inset:0;background:#808080;z-index:1;pointer-events:none';
  document.body.appendChild(d);
});
await sleep(900);

const decode = async (b64) => {
  await page.evaluate(async (b) => {
    const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b)).blob());
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
    window.__rev = { w: bmp.width, h: bmp.height, d: Array.from(x.getImageData(0, 0, bmp.width, bmp.height).data) };
  }, b64);
  return page.evaluate(() => window.__rev);
};
const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

const rect = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });

function edgeProfile(on, off, K) {
  const rows = [];
  const span = (a, b) => [Math.round(a * K), Math.round(b * K)];
  const collect = (pts) => {
    let s = 0, n = 0;
    for (const [xi, yi] of pts) { const i = (yi * on.w + xi) * 4; s += Math.abs(lum(on.d, i) - lum(off.d, i)); n++; }
    return n ? s / n : 0;
  };
  const [x0, x1] = span(rect.x + rect.w * 0.25, rect.x + rect.w * 0.75);
  const [y0, y1] = span(rect.y + rect.h * 0.25, rect.y + rect.h * 0.75);
  const out = { top: [], left: [], bottom: [], right: [] };
  for (let d = 0; d <= 9; d++) {
    // top: rows rect.y + d
    let y = Math.round((rect.y + d) * K);
    out.top.push(+collect(Array.from({ length: x1 - x0 }, (_, k) => [x0 + k, y])).toFixed(2));
    // bottom: rows rect.y+rect.h-1-d
    y = Math.round((rect.y + rect.h - 1 - d) * K);
    out.bottom.push(+collect(Array.from({ length: x1 - x0 }, (_, k) => [x0 + k, y])).toFixed(2));
    // left: cols rect.x + d
    let x = Math.round((rect.x + d) * K);
    out.left.push(+collect(Array.from({ length: y1 - y0 }, (_, k) => [x, y0 + k])).toFixed(2));
    // right: cols rect.x+rect.w-1-d
    x = Math.round((rect.x + rect.w - 1 - d) * K);
    out.right.push(+collect(Array.from({ length: y1 - y0 }, (_, k) => [x, y0 + k])).toFixed(2));
  }
  return out;
}
const peakOf = (arr) => Math.max(...arr);
const bandMean = (arr) => { const s = arr.slice(1, 9); return s.reduce((a, b) => a + b, 0) / s.length; };
const peaksOf = (arr) => { let c = 0; for (let i = 1; i < arr.length - 1; i++) if (arr[i] >= arr[i - 1] && arr[i] >= arr[i + 1] && arr[i] > 3) c++; return c; };

const measure = async (label, prep) => {
  if (prep) { await prep(); await sleep(1400); }
  const on1 = await decode(await shot1x());
  const on2 = await decode(await shot1x());
  const cv = await page.evaluate(async () => {
    const c = document.getElementById('gev-edge-lens');
    const bmp = await createImageBitmap(await (await fetch(c.toDataURL('image/png'))).blob());
    return { w: bmp.width, h: bmp.height };
  });
  const cfg = await page.evaluate(() => ({ scale: window.__gevEdge.stats().scale, canvas: window.__gevEdge.stats().canvas, bandAlpha: window.__gevEdge.cfg().bandAlpha, testBgGrid: window.__gevEdge.cfg().testBgGrid }));
  await page.evaluate(() => window.__gevEdge.off());
  await sleep(700);
  const off = await decode(await shot1x());
  await page.evaluate(() => window.__gevEdge.on());
  await sleep(700);
  const K = on1.w / W;
  const p = edgeProfile(on1, off, K);
  const noise = edgeProfile(on2, on1, K);
  const center = (im1, im2) => {
    const cx = Math.round((rect.x + rect.w / 2) * K), cy = Math.round((rect.y + rect.h / 2) * K);
    let mx = 0;
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
      const i = ((cy + dy) * im1.w + (cx + dx)) * 4;
      mx = Math.max(mx, Math.abs(lum(im1.d, i) - lum(im2.d, i)));
    }
    return +mx.toFixed(2);
  };
  const row = {
    label, shot: [on1.w, on1.h], K: +K.toFixed(4), lens: cfg,
    top: { peak: peakOf(p.top), bandMean: +bandMean(p.top).toFixed(2), peaks: peaksOf(p.top), profile: p.top },
    left: { peak: peakOf(p.left), bandMean: +bandMean(p.left).toFixed(2), peaks: peaksOf(p.left), profile: p.left },
    bottom: { peak: peakOf(p.bottom), bandMean: +bandMean(p.bottom).toFixed(2), peaks: peaksOf(p.bottom), profile: p.bottom },
    right: { peak: peakOf(p.right), bandMean: +bandMean(p.right).toFixed(2), peaks: peaksOf(p.right), profile: p.right },
    centerMax: center(on1, on2),
    noiseMax: Math.max(noise.top[0] || 0, noise.left[0] || 0),
  };
  log.variants.push(row);
  console.log('\n=== ' + label + ' lens=' + JSON.stringify(cfg) + ' shot=' + on1.w + 'x' + on1.h + ' K=' + row.K + ' center=' + row.centerMax + ' noise0=' + row.noiseMax);
  for (const e of ['top', 'left', 'bottom', 'right']) console.log('  ' + e.padEnd(6), 'peak', row[e].peak, 'bandMean', row[e].bandMean, 'peaks', row[e].peaks, JSON.stringify(row[e].profile));
  return row;
};

const env = await page.evaluate(() => ({
  dpr: window.devicePixelRatio, innerW: innerWidth, innerH: innerHeight,
  screen: [screen.width, screen.height], vvScale: window.visualViewport ? window.visualViewport.scale : null,
  canvas: window.__gevEdge.stats().canvas, scale: window.__gevEdge.stats().scale,
  gpu: window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe().renderer : null,
}));
const probeShot = await decode(await shot1x());
log.env = { ...env, shot: [probeShot.w, probeShot.h], K: +(probeShot.w / env.innerW).toFixed(4) };
console.log('\nENV ' + JSON.stringify(log.env));

const setPtr = (xy) => page.mouse.move(xy[0], xy[1], { steps: 3 });
const header = await page.evaluate(() => {
  const b = document.getElementById('data-panel').querySelector('.panel-header').getBoundingClientRect();
  return [Math.round(b.left + b.width * 0.5), Math.round(b.top + b.height * 0.5)];
});

// A: non-hover, checkerboard, default scale/alpha
await setPtr([4, 400]); await sleep(400);
await page.evaluate(() => window.__gevEdge.testChecker(true, 8));
await measure('A_nonhover_checker8_default');
// B: hover (pointer on header)
await setPtr(header); await sleep(700);
const base = await page.evaluate(() => {
  const el = document.querySelector(':hover');
  return { hovered: el ? el.id || el.className : null };
});
console.log('hover target', JSON.stringify(base));
await measure('B_hover_checker8_default');
// C: non-hover + scale forced 1.25 (1:1 device px)
await setPtr([4, 400]); await sleep(400);
await page.evaluate(() => window.__gevEdge.set({ scale: 1.25 }));
await measure('C_nonhover_checker8_scale125');
// D: non-hover + scale 1.25 + bandAlpha 1.0
await page.evaluate(() => window.__gevEdge.set({ bandAlpha: 1.0 }));
await measure('D_nonhover_checker8_scale125_alpha1');
// E: back to defaults, real map, non-hover (live discrimination + noise)
await page.evaluate(() => { window.__gevEdge.set({ bandAlpha: 0.55, scale: 0 }); window.__gevEdge.testChecker(false, 8); });
await measure('E_nonhover_realmap_default');
// F: checkerboard @ scale default, alpha default, twice for reproducibility
await page.evaluate(() => window.__gevEdge.set({ bandAlpha: 0.55, scale: 0 })); await page.evaluate(() => window.__gevEdge.testChecker(true, 8));
await measure('F_repeatA');

writeFileSync(OUT + '/probe-r2.json', JSON.stringify(log, null, 2));
console.log('\nsaved ' + OUT + '/probe-r2.json');
await browser.close();
