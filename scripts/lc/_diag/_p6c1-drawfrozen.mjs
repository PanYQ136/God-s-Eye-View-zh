/* Phase6C1：冻结状态下 draw() 是否还在跑？（不调用 on()，纯观察） */
import puppeteer from 'puppeteer';
const W = 1348, H = 774;
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
await page.goto('http://127.0.0.1:4173/?welcome=0&t=' + Date.now(), { waitUntil: 'load' });
for (let i = 0; i < 150; i++) {
  const ok = await page.evaluate(() => !!(window.__lc && window.__lc.api && window.__lc.api.ready && window.__gevEdge && window.__gevEdge.stats().count > 0)).catch(() => false);
  if (ok) break; await sleep(400);
}
await sleep(4500);
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(1500);
const snap = () => page.evaluate(() => { const s = window.__gevEdge.stats(); return { f: s.frames, k: s.skip, post: s.post, drawFps: s.drawFps, fps: s.fps, err: s.err, tex: s.tex }; });
const a = await snap();
/* 冻结前：不加 on()，看 grab 是否被 draw 消费 */
await page.evaluate(() => { window.__gevEdgeGrab = { x: 60, y: 100, w: 6 }; window.__gevEdgeGrabOut = null; });
let hit = false;
for (let i = 0; i < 25; i++) { if (await page.evaluate(() => !!window.__gevEdgeGrabOut)) { hit = true; break; } await sleep(60); }
const b = await snap();
console.log('LIVE   grabFired', hit, 'frames+', b.f - a.f, 'skip+', b.k - a.k, 'post+', b.post - a.post, 'tex', b.tex, 'err', b.err);
await page.evaluate(() => { const v = (window.__godsEyeView && window.__godsEyeView.viewer) || window.__gevViewer; window.__v = v; if (v) v.useDefaultRenderLoop = false; });
await sleep(1200);
const c = await snap();
await page.evaluate(() => { window.__gevEdgeGrab = { x: 60, y: 100, w: 6 }; window.__gevEdgeGrabOut = null; });
let hit2 = false;
for (let i = 0; i < 25; i++) { if (await page.evaluate(() => !!window.__gevEdgeGrabOut)) { hit2 = true; break; } await sleep(60); }
const d = await snap();
console.log('FROZEN grabFired', hit2, 'frames+', d.f - c.f, 'skip+', d.k - c.k, 'post+', d.post - c.post, 'drawFps', d.drawFps, 'fps', d.fps, 'err', d.err);
await browser.close();
