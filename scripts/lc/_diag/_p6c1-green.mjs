/* Phase6C1 探针7：缓冲→屏幕通路（手工 GL 填充绿）+ toDataURL + 上下文状态 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
const W = 1348, H = 774;
mkdirSync('.gev-logs/lc/phase6c1', { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  args: ['--no-sandbox', `--window-size=${W + 24},${H + 160}`, '--window-position=40,20', '--hide-scrollbars',
    '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion'],
  protocolTimeout: 900000, defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.bringToFront().catch(() => {});
await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} try { sessionStorage.setItem('gev.gl.armed', '1'); } catch {} });
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break; await sleep(400);
}
await sleep(4000);
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
const rect = await page.evaluate(() => { const b = document.getElementById('data-panel').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
const cdp = await page.createCDPSession();
const pxAt = async (x, y) => {
  const s = (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
  return page.evaluate(async (s, x, y) => {
    const blob = await (await fetch('data:image/png;base64,' + s)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, s, x, y);
};
const state = await page.evaluate(() => {
  const cv = document.getElementById('gev-edge-lens');
  const gl = cv.getContext('webgl2');
  return {
    cnt: document.querySelectorAll('#gev-edge-lens').length,
    sameCanvas: gl.canvas === cv,
    lost: gl.isContextLost(),
    err: gl.getError(),
    attrs: gl.getContextAttributes(),
    urlLen: (() => { try { return cv.toDataURL().length; } catch (e) { return 'err:' + e.message; } })(),
    ds: [cv.width, cv.height, cv.style.width, cv.style.height],
  };
});
console.log('state', JSON.stringify(state));
console.log('screen top-edge before:', await pxAt(rect.x + 160, rect.y + 2));

/* 关掉 lib 绘制 → 手工把整块缓冲涂纯绿 */
await page.evaluate(() => {
  window.__gevEdge.off();
  const cv = document.getElementById('gev-edge-lens');
  const gl = cv.getContext('webgl2');
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, cv.width, cv.height);
  gl.clearColor(0, 1, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
});
await sleep(350);
console.log('screen after green fill:', await pxAt(rect.x + 160, rect.y + 2), await pxAt(700, 30));
const url = await page.evaluate(() => { try { return document.getElementById('gev-edge-lens').toDataURL().length; } catch (e) { return 'err'; } });
console.log('toDataURL len after green:', url);
await browser.close();
