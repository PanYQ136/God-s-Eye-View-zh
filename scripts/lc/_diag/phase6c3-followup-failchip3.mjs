#!/usr/bin/env node
/* Phase6C3-followup · 诊断二b：把「截图 → 读 DOM」的延迟量出来，并 10ms 采样芯片可见窗
   —— 结论只依赖三件事：①可见窗长度 ②gate 的 pxStats 读滞后 ③同一 at 的 PNG 里红色墨迹。
   用法: node scripts/lc/_diag/phase6c3-followup-failchip3.mjs [tag]
*/
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const TAG = process.argv[2] || 'h1';
const OUT = '.gev-logs/lc/phase6c3';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: false, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars', '--ignore-gpu-blocklist',
    '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 600000, defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const cdp = await page.createCDPSession();
await cdp.send('Network.enable');
await cdp.send('Network.setBlockedURLs', { urls: ['*api/opensky*', '*api/flights*', '*api/adsb*'] });
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 800; i++) {
  const ok = await page.evaluate(() => !!(window.__gevBoot && window.__gevBoot.snapshot && window.__gevBoot.snapshot().interactiveAt != null)
    && !!(window.__godsEyeView && window.__godsEyeView.dataManager)).catch(() => false);
  if (ok) break; await sleep(60);
}
/* ① 量 gate 的「截图→读 DOM」滞后：pxStats 是页内 evaluate，跑的是同一段像素统计代码 */
const png = (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
const pxStatsMs = await page.evaluate(async (b64) => {
  const t0 = performance.now();
  const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  const w = Math.min(640, bmp.width), h = Math.min(420, bmp.height);
  const x = Math.max(0, Math.round((bmp.width - w) / 2)), y = Math.max(0, Math.round((bmp.height - h) / 2));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, x, y, w, h, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;
  const lum = new Float32Array(w * h); let sum = 0, n = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p += 1) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; lum[p] = l; sum += l; n += 1; }
  let lap = 0; for (let yy = 1; yy < h - 1; yy += 1) for (let xx = 1; xx < w - 1; xx += 1) { const p = yy * w + xx; lap += Math.abs(4 * lum[p] - lum[p - w] - lum[p + w] - lum[p - 1] - lum[p + 1]); }
  return +(performance.now() - t0).toFixed(0);
}, png);
const evalRtt = [];
for (let i = 0; i < 3; i++) {
  const t = Date.now();
  await page.evaluate(() => document.getElementById('global-loading-status')?.hidden);
  evalRtt.push(Date.now() - t);
}

/* ② 触发一次真实失败批次，10ms 采样芯片可见窗 */
await page.evaluate(() => { const dm = window.__godsEyeView.dataManager; dm.toggle('flights'); });
const CHIP = () => {
  const chip = document.getElementById('global-loading-status');
  const label = document.getElementById('global-loading-label');
  if (!chip || !label) return { missing: true };
  const r = chip.getBoundingClientRect(); const lr = label.getBoundingClientRect();
  const host = label.querySelector('.gev-flap-cells');
  return {
    hidden: chip.hidden, state: chip.dataset.state || null, offsetW: chip.offsetWidth,
    rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    labelRect: [Math.round(lr.left), Math.round(lr.top), Math.round(lr.width), Math.round(lr.height)],
    text: String(label.textContent || '').trim(),
    cells: host ? [...host.children].map((c) => c.dataset.flapNext || '').join('') : '',
    flapActive: label.classList.contains('gev-flap-active'),
    labelStyleWidth: label.style.width || '',
    t: 0,
  };
};
const seq = [];
const shots = [];
const t0 = Date.now();
for (let i = 0; i < 700; i++) {
  const c = await page.evaluate(CHIP);
  c.t = Date.now() - t0;
  seq.push(c);
  if (!c.hidden && shots.length < 14 && (shots.length === 0 || c.t - shots[shots.length - 1].t > 30)) {
    const b64 = (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
    const name = `${TAG}-t${c.t}.png`;
    writeFileSync(`${OUT}/${name}`, Buffer.from(b64, 'base64'));
    shots.push({ t: c.t, name, text: c.text, state: c.state, labelRect: c.labelRect, cells: c.cells, flapActive: c.flapActive, labelStyleWidth: c.labelStyleWidth });
  }
  await sleep(10);
}
const vis = seq.filter((c) => !c.hidden);
const win = vis.length ? { from: vis[0].t, to: vis[vis.length - 1].t, lenMs: vis[vis.length - 1].t - vis[0].t, states: [...new Set(vis.map((c) => c.state))], texts: [...new Set(vis.map((c) => c.text))] } : null;
const transitions = seq.reduce((acc, c) => { const k = `${c.hidden}|${c.state}|${c.text}`; if (acc[acc.length - 1] !== k) acc.push(k); return acc; }, []);
console.log('pxStatsMs', pxStatsMs, '· evalRtt', JSON.stringify(evalRtt));
console.log('visible window', JSON.stringify(win));
console.log('transitions', JSON.stringify(transitions.slice(0, 20)));
console.log('shots', JSON.stringify(shots));
writeFileSync(`${OUT}/followup-${TAG}-failchip3.json`, JSON.stringify({ TAG, pxStatsMs, evalRtt, win, transitions, shots, seq: seq.filter((c, i) => i % 5 === 0) }, null, 2));
await browser.close();
