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
await sleep(4000);
await page.evaluate(() => window.__lc.api.dispatch({ type: 'ESC', id: 'data-panel' }));
await sleep(1200);
const cdp = await page.createCDPSession();
const px = async () => {
  const s = (await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data;
  return page.evaluate(async (s) => {
    const blob = await (await fetch('data:image/png;base64,' + s)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    const r = document.getElementById('data-panel').getBoundingClientRect();
    const d = cx.getImageData(Math.round(r.x + 4), Math.round(r.y + r.height * 0.5), 1, 1).data;
    const st = window.__gevEdge.stats();
    return { px: [d[0], d[1], d[2]], frames: st.frames, skip: st.skip, drawFps: st.drawFps, fps: st.fps, err: st.err, count: st.count, en: window.__gevEdge.cfg().enabled };
  }, s);
};
const a = await px(); console.log('t0   ', JSON.stringify(a));
await sleep(1500);
const b = await px(); console.log('t1.5 ', JSON.stringify(b), '+frames', b.frames - a.frames, '+skip', b.skip - a.skip);
await page.evaluate(() => window.__gevEdge.off()); await sleep(400);
const c = await px(); console.log('off  ', JSON.stringify(c));
await page.evaluate(() => window.__gevEdge.on()); await sleep(400);
const d1 = await px(); console.log('on   ', JSON.stringify(d1));
await page.evaluate(() => { window.__q = setInterval(() => window.__gevEdge.on(), 10); }); await sleep(800);
const e1 = await px(); console.log('on@10ms', JSON.stringify(e1));
await page.evaluate(() => clearInterval(window.__q)); await sleep(600);
const f1 = await px(); console.log('after  ', JSON.stringify(f1));
await browser.close();
