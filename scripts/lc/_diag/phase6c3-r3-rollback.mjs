#!/usr/bin/env node
/* Phase6C3-R3 回滚冒烟（评审 Round-2 ④）：把 /src/gev-boot-gate.js 的请求拦掉
   = 「删掉 index.html 那一行 script」的等价回滚。断言：
     ① window.__gevBoot === undefined（模块确实没跑）
     ② 页面无 pageerror（startupChrome / lc / autolocate 的降级分支没问题）
     ③ 遮罩仍然会收起（回到旧行为：恢复完就收）
     ④ 遮罩收起后 8s 内画面有影像（旧行为也能出图）
   自跑：node scripts/lc/_diag/phase6c3-r3-rollback.mjs */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', '--window-size=1372,934', '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--disable-background-timer-throttling',
    '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: 1348, height: 774, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 200)); });
await page.evaluateOnNewDocument(() => {
  try { localStorage.clear(); localStorage.setItem('gev.gfx', JSON.stringify({ pdb: true })); } catch (e) {}
  try { sessionStorage.setItem('gev.gl.armed', '1'); } catch (e) {}
});
const blocked = [];
await page.setRequestInterception(true);
page.on('request', (req) => {
  if (/gev-boot-gate\.js/.test(req.url())) { blocked.push(req.url()); req.abort(); return; }
  req.continue();
});
const t0 = Date.now();
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
let readyAt = null;
for (let i = 0; i < 600; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready)).catch(() => false);
  if (ok) { readyAt = Date.now() - t0; break; }
  await sleep(100);
}
await sleep(8000);
const st = await page.evaluate(() => {
  const el = document.getElementById('loading-screen');
  const cs = el ? getComputedStyle(el) : null;
  return { bootPresent: typeof window.__gevBoot !== 'undefined', maskOp: cs ? parseFloat(cs.opacity) : null,
    maskDisplay: cs ? cs.display : null, maskHiddenClass: el ? el.classList.contains('hidden') : null,
    ready: !!(window.__lc && window.__lc.api && window.__lc.api.ready),
    sched: window.Cesium ? { per: window.Cesium.RequestScheduler.maximumRequestsPerServer, all: window.Cesium.RequestScheduler.maximumRequests } : null };
});
const png = await page.screenshot({ encoding: 'base64' });
writeFileSync('.gev-logs/lc/phase6c3/r3-rollback-reveal+8s.png', Buffer.from(png, 'base64'));
const px = await page.evaluate(async (b64) => {
  const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + b64)).blob());
  const w = Math.min(640, bmp.width), h = Math.min(420, bmp.height);
  const x = Math.round((bmp.width - w) / 2), y = Math.round((bmp.height - h) / 2);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, x, y, w, h, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h).data;
  let sum = 0, sum2 = 0, n = 0; const uniq = new Set();
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    sum += l; sum2 += l * l; n += 1; uniq.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  }
  const m = sum / n;
  return { mean: +m.toFixed(2), std: +Math.sqrt(Math.max(0, sum2 / n - m * m)).toFixed(2), uniq: uniq.size };
}, png);
const out = { blockedRequests: blocked.length, readyAt, ...st, pxAfter8s: px, errs };
writeFileSync('.gev-logs/lc/phase6c3/r3-rollback.json', JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
await browser.close();
process.exit(st.bootPresent === false && st.maskHiddenClass === true && px.uniq >= 800 && errs.length === 0 ? 0 : 1);
