// Chrome (puppeteer) 同 URL 同视口对照：验证 60fps 是否可达，以及 Ego 27fps 是不是浏览器合成器导致
import puppeteer from 'puppeteer';
const URL = 'http://127.0.0.1:4173/';
const W = 1360, H = 782;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--force_high_performance_gpu',
    '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000,
  defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
for (let i = 0; i < 240; i++) {
  const ok = await page.evaluate(() => !!(window.__gevViewer && window.__gevEdge && window.__gevEdge.stats && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break;
  await sleep(400);
}
await sleep(7000);
const gpu = await page.evaluate(() => {
  const c = document.createElement('canvas'); const gl = c.getContext('webgl2');
  const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : null, tfq: window.__gevViewer && window.__gevViewer.targetFrameRate, rs: window.__gevViewer && window.__gevViewer.resolutionScale, canvas: [window.__gevViewer.canvas.width, window.__gevViewer.canvas.height] };
});
const stat = async (ms) => page.evaluate(async (dur) => {
  const ts = []; let stop = false; const tick = (t) => { ts.push(t); if (!stop) requestAnimationFrame(tick); };
  requestAnimationFrame(tick); await new Promise((r) => setTimeout(r, dur)); stop = true;
  const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
  const sum = d.reduce((a, b) => a + b, 0);
  return { fps: +((d.length / sum) * 1000).toFixed(1), p50: +d[Math.floor(d.length * .5)].toFixed(2), p95: +d[Math.floor(d.length * .95)].toFixed(2), n: d.length };
}, ms);
const out = { gpu, limiterOn: await stat(8000) };
await page.evaluate(() => { window.__gevViewer.targetFrameRate = undefined; });
await sleep(400);
out.uncapped = await stat(8000);
await page.evaluate(() => { window.__gevViewer.targetFrameRate = 60; });
console.log(JSON.stringify(out));
await browser.close();
