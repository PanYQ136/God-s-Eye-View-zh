/* Phase6C1 洁净协议：冻结后每个状态「渲染两次、取第二次」，先验噪声再测四边 Δ */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
const W = 1348, H = 774, OUT = '.gev-logs/lc/phase6c1';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000, defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 120)));
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break; await sleep(400);
}
await sleep(4500);
const gpu = await page.evaluate(() => (window.__gevGpu && window.__gevGpu.probe ? window.__gevGpu.probe() : null));
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(900);
let ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
if (ph !== 'open') {
  const p = await page.evaluate(() => {
    const el = document.getElementById('data-panel');
    const t = el.querySelector('.panel-header,.pp-header-row,.dock-tray-toggle,.location-toolbar-label') || el;
    const b = t.getBoundingClientRect(); return { x: Math.round(b.left + b.width * 0.5), y: Math.round(b.top + b.height * 0.5) };
  });
  await page.mouse.move(p.x, p.y, { steps: 4 }); await sleep(80);
  await page.mouse.down(); await sleep(40); await page.mouse.up(); await sleep(1300);
}
ph = await page.evaluate(() => document.getElementById('data-panel').dataset.lcPhase);
await page.evaluate(() => { const v = (window.__godsEyeView && window.__godsEyeView.viewer) || window.__gevViewer; window.__v = v; if (v) v.useDefaultRenderLoop = false; });
await sleep(900);
await page.evaluate(() => { const s = document.createElement('style'); s.id = 'pc-blank'; s.textContent = '#data-panel > *{visibility:hidden!important}'; document.head.appendChild(s); });
await sleep(400);
const rect = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const band = await page.evaluate(() => { const s = window.__gevEdge.stats(); const f = (s.surfaces || []).find((x) => x.id === 'data-panel'); return f ? f.band : s.band; });
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const render = async () => { await page.evaluate(() => { try { window.__v.render(); } catch (e) { window.__v.scene.requestRender(); } }); await sleep(450); };
const stable = async (n = 2) => { for (let i = 0; i < n; i++) await render(); return shot(); };

/* 状态机：off / on，各渲染两次取第二次 */
await page.evaluate(() => window.__gevEdge.off());
const offA = await stable(); const offB = await stable();
await page.evaluate(() => window.__gevEdge.on());
const onA = await stable(); const onB = await stable();

const cmp = (a, b) => page.evaluate(async (a, b, rect, band) => {
  const dec = async (s) => {
    const blob = await (await fetch('data:image/png;base64,' + s)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width };
  };
  const A = await dec(a), B = await dec(b);
  const at = (x, y) => { const i = (y * A.w + x) * 4; return { r: A.d[i], g: A.d[i + 1], b: A.d[i + 2] }; };
  const out = {};
  const specs = {
    top: ['y', rect.y], left: ['x', rect.x],
    bot: ['y', rect.y + rect.h], right: ['x', rect.x + rect.w],
  };
  for (const [k, [axis, e0]] of Object.entries(specs)) {
    const u0 = axis === 'y' ? Math.round(rect.x + rect.w * 0.35) : Math.round(rect.y + rect.h * 0.3);
    const u1 = axis === 'y' ? Math.round(rect.x + rect.w * 0.65) : Math.round(rect.y + rect.h * 0.7);
    const p = [], dp = [];
    for (let j = -2; j <= 12; j++) {
      const t = Math.round(e0) + j;
      let s = 0, n = 0, dm = 0;
      for (let u = u0; u < u1; u++) {
        const i = axis === 'y' ? (t * A.w + u) * 4 : (u * A.w + t) * 4;
        s += Math.abs(0.2126 * (A.d[i] - B.d[i]) + 0.7152 * (A.d[i + 1] - B.d[i + 1]) + 0.0722 * (A.d[i + 2] - B.d[i + 2]));
        dm = Math.max(dm, Math.abs(A.d[i] - B.d[i]));
        n++;
      }
      p.push(n ? +(s / n).toFixed(1) : 0); dp.push(dm);
    }
    const bandIn = p.slice(2, 2 + Math.min(8, Math.max(1, Math.round(band))));
    let peaks = 0;
    for (let j = 1; j < Math.min(band, 10); j++) if (p[2 + j] >= p[1 + j] && p[2 + j] >= p[3 + j] && p[2 + j] > 3) peaks++;
    out[k] = { prof: p, dprof: dp, peak: Math.max(...p.slice(2, 2 + Math.max(2, Math.round(band)))),
      peakK: p.slice(2, 2 + Math.round(band)).indexOf(Math.max(...p.slice(2, 2 + Math.round(band)))),
      bandMean: +(bandIn.reduce((x, y) => x + y, 0) / bandIn.length).toFixed(2), peaks };
  }
  let cm = 0, cn = 0;
  for (let y = Math.round(rect.y + rect.h * 0.4); y < Math.round(rect.y + rect.h * 0.6); y++)
    for (let x = Math.round(rect.x + rect.w * 0.35); x < Math.round(rect.x + rect.w * 0.65); x++) {
      const i = (y * A.w + x) * 4;
      cm = Math.max(cm, Math.abs(A.d[i] - B.d[i]), Math.abs(A.d[i + 1] - B.d[i + 1]), Math.abs(A.d[i + 2] - B.d[i + 2])); cn++;
    }
  out.center = { max: cm, n: cn };
  return out;
}, a, b, rect, band);

const noise = await cmp(offA, offB);
const delta = await cmp(onB, offB);
const style = await page.evaluate(() => { const el = document.getElementById('data-panel'); const cs = getComputedStyle(el);
  return { bg: cs.backgroundColor, bf: cs.backdropFilter, border: cs.borderTopWidth, outline: cs.outlineWidth, shadow: cs.boxShadow === 'none' ? 0 : (cs.boxShadow.match(/rgba?\(/g) || []).length }; });
writeFileSync(`${OUT}/clean-on.png`, Buffer.from(onB, 'base64'));
writeFileSync(`${OUT}/clean-off.png`, Buffer.from(offB, 'base64'));
const R = { gpu: gpu && { renderer: gpu.renderer, software: gpu.software, tier: gpu.tier }, phase: ph, rect, band, noise, delta, style, errs };
writeFileSync(`${OUT}/clean.json`, JSON.stringify(R, null, 1));
console.log('GPU   ', gpu && gpu.renderer, 'phase', ph, 'band', band);
console.log('noise max', noise.center.max, 'top peak', noise.top.peak, 'bandMean', noise.top.bandMean);
for (const k of ['top', 'left', 'bot', 'right'])
  console.log(k.padEnd(5), 'peak', String(delta[k].peak).padStart(6), 'k', delta[k].peakK, 'bandMean', String(delta[k].bandMean).padStart(6), 'peaks', delta[k].peaks, JSON.stringify(delta[k].prof));
console.log('center', JSON.stringify(delta.center), 'style', JSON.stringify(style), 'errs', errs.slice(0, 2));
await browser.close();
