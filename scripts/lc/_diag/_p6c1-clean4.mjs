/* Phase6C1 洁净协议 v3：off 态 = band≈0（仍每帧下发 GL，片元全 discard），on 态 = band 正常。
   两态合成路径一致、底图冻结不动 → Δ 就是折射层的真实贡献。 */
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
await page.evaluate(() => { const s = document.createElement('style'); s.id = 'pc-blank';
  s.textContent = '#data-panel > *{visibility:hidden!important}'; document.head.appendChild(s); });
/* 先让折射层处于「每帧画」的稳定状态，再冻结底图 */
await page.evaluate(() => { window.__gevEdge.set({ only: null }); });
await sleep(600);
await page.evaluate(() => { const v = (window.__godsEyeView && window.__godsEyeView.viewer) || window.__gevViewer; window.__v = v; /* IDLE 版：不冻结 */ });
await sleep(2500);
const rect = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const bandReal = await page.evaluate(() => { const s = window.__gevEdge.stats(); const f = (s.surfaces || []).find((x) => x.id === 'data-panel'); return f ? f.band : s.band; });
const cdp = await page.createCDPSession();
const shot = async () => (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const setOff = () => page.evaluate(() => { window.__gevEdge.set({ band: 0.02, bandMin: 0.02, bandFrac: 0.00002 }); });
const setOn = () => page.evaluate(() => { window.__gevEdge.set({ band: 10, bandMin: 7, bandFrac: 0.20 }); });

await setOn(); await sleep(700); const onA = await shot();
await setOn(); await sleep(400); const onB = await shot();
await setOff(); await sleep(700); const offA = await shot();
await setOff(); await sleep(400); const offB = await shot();
await setOn(); await sleep(500);

const cmp = (a, b) => page.evaluate(async (a, b, rect, band) => {
  const dec = async (s) => {
    const blob = await (await fetch('data:image/png;base64,' + s)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return { d: cx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width };
  };
  const A = await dec(a), B = await dec(b);
  const out = {};
  const specs = { top: ['y', rect.y], left: ['x', rect.x], bot: ['y', rect.y + rect.h], right: ['x', rect.x + rect.w] };
  for (const [k, [axis, e0]] of Object.entries(specs)) {
    const u0 = axis === 'y' ? Math.round(rect.x + rect.w * 0.35) : Math.round(rect.y + rect.h * 0.3);
    const u1 = axis === 'y' ? Math.round(rect.x + rect.w * 0.65) : Math.round(rect.y + rect.h * 0.7);
    const p = [], dp = [];
    for (let j = -2; j <= 14; j++) {
      const t = Math.round(e0) + j;
      let s = 0, n = 0, dm = 0;
      for (let u = u0; u < u1; u++) {
        const i = axis === 'y' ? (t * A.w + u) * 4 : (u * A.w + t) * 4;
        s += Math.abs(0.2126 * (A.d[i] - B.d[i]) + 0.7152 * (A.d[i + 1] - B.d[i + 1]) + 0.0722 * (A.d[i + 2] - B.d[i + 2]));
        dm = Math.max(dm, Math.abs(A.d[i] - B.d[i])); n++;
      }
      p.push(n ? +(s / n).toFixed(1) : 0); dp.push(dm);
    }
    const bw = Math.max(1, Math.round(band));
    const inb = p.slice(2, 2 + bw);
    let peaks = 0;
    for (let j = 1; j < bw - 1; j++) if (inb[j] >= inb[j - 1] && inb[j] >= inb[j + 1] && inb[j] > 3) peaks++;
    out[k] = { prof: p, dprof: dp, peak: Math.max(...inb), peakK: inb.indexOf(Math.max(...inb)),
      bandMean: +(inb.slice(0, 8).reduce((x, y) => x + y, 0) / inb.slice(0, 8).length).toFixed(2), peaks };
  }
  let cm = 0, cn = 0;
  for (let y = Math.round(rect.y + rect.h * 0.4); y < Math.round(rect.y + rect.h * 0.6); y++)
    for (let x = Math.round(rect.x + rect.w * 0.35); x < Math.round(rect.x + rect.w * 0.65); x++) {
      const i = (y * A.w + x) * 4;
      cm = Math.max(cm, Math.abs(A.d[i] - B.d[i]), Math.abs(A.d[i + 1] - B.d[i + 1]), Math.abs(A.d[i + 2] - B.d[i + 2])); cn++;
    }
  out.center = { max: cm, n: cn };
  return out;
}, a, b, rect, bandReal);

const noise = await cmp(onA, onB);
const noiseOff = await cmp(offA, offB);
const delta = await cmp(onB, offB);
writeFileSync(`${OUT}/clean4-on.png`, Buffer.from(onB, 'base64'));
writeFileSync(`${OUT}/clean4-off.png`, Buffer.from(offB, 'base64'));
const crop8 = await page.evaluate(async (b64, rect) => {
  const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
  const bmp = await createImageBitmap(blob);
  const w = 40, h = 34, cv = document.createElement('canvas'); cv.width = w * 8; cv.height = h * 8;
  const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false;
  cx.drawImage(bmp, Math.round(rect.x - 4), Math.round(rect.y - 4), w, h, 0, 0, w * 8, h * 8);
  return cv.toDataURL('image/png');
}, onB, rect);
writeFileSync(`${OUT}/clean4-tl-8x.png`, Buffer.from(String(crop8).split(',')[1], 'base64'));
const R = { gpu: gpu && { renderer: gpu.renderer, software: gpu.software }, phase: ph, rect, band: bandReal, noiseOn: noise, noiseOff, delta, errs };
writeFileSync(`${OUT}/clean4.json`, JSON.stringify(R, null, 1));
console.log('GPU', gpu && gpu.renderer, '| phase', ph, '| band', bandReal);
console.log('noise(on,on) center', noise.center.max, 'top', noise.top.peak, '| noise(off,off) center', noiseOff.center.max);
for (const k of ['top', 'left', 'bot', 'right'])
  console.log(k.padEnd(5), 'peak', String(delta[k].peak).padStart(6), 'k', delta[k].peakK, 'bandMean', String(delta[k].bandMean).padStart(6), 'peaks', delta[k].peaks, JSON.stringify(delta[k].prof));
console.log('CENTER', JSON.stringify(delta.center), 'dTop', JSON.stringify(delta.top.dprof));
await browser.close();
